// DADDY HOME Campus Environment Patrol & Space Education
// DingTalk Official OAuth2 + JSAPI Auth Flow & 90-day Long Session

const SESSION_STORAGE_KEY = 'dh_patrol_teacher_session_v2';
const OAUTH_STATE_STORAGE_KEY = 'dh_patrol_oauth_state_v1';
const DINGTALK_CLIENT_ID = 'dingh5hmtyjgs4klkcdu';

let AppState = {
  config: null,
  area: null,
  isTeacher: false,
  currentTeacher: null,
  sessionToken: '',
  manualPasscode: '',
  selectedItems: new Set(),
  uploadedPhotos: [],
  ratings: { safety: 5, hygiene: 5, supplies: 5, experience: 5 }
};

document.addEventListener('DOMContentLoaded', async function() {
  await initApp();
});

async function initApp() {
  try {
    const savedSession = loadTeacherSession();
    const configHeaders = savedSession && savedSession.token
      ? { 'Authorization': 'Bearer ' + savedSession.token }
      : {};
    const res = await fetch('/api/config', { headers: configHeaders });
    if (!res.ok) throw new Error('配置加载失败');
    AppState.config = await res.json();

    const ua = navigator.userAgent || '';
    const isDingTalkEnv = /DingTalk/i.test(ua);
    const hostname = window.location.hostname || '';
    const isInternalDomain = hostname === 'patrol.daddyhome.club' || hostname.endsWith('.patrol.daddyhome.club');

    const urlParams = new URLSearchParams(window.location.search);
    const explicitRole = urlParams.get('role');
    const authCode = urlParams.get('authCode') || urlParams.get('code');

    // 1. Resolve Target Area from Sub-route Path or Query (e.g. /life-farm, /woodworking, etc.)
    const pathname = window.location.pathname.replace(/^\/+|\/+$/g, '');
    const pathParts = pathname.split('/');
    const subRouteKey = pathParts.length > 0 ? (pathParts[0] === 'areas' && pathParts[1] ? pathParts[1] : pathParts[0]) : '';
    const queryKey = urlParams.get('area') || urlParams.get('sheet') || urlParams.get('id');

    const searchKey = (queryKey || subRouteKey || 'life-farm').toLowerCase();

    let matched = AppState.config.areas.find(function(a) {
      if (!a) return false;
      if (a.id && a.id.toLowerCase() === searchKey) return true;
      if (a.sheetId && a.sheetId.toLowerCase() === searchKey) return true;
      if (a.shortCode && a.shortCode.toLowerCase() === searchKey) return true;
      if (a.slug && a.slug.toLowerCase() === searchKey) return true;
      if (a.aliases && a.aliases.some(function(alias) { return alias.toLowerCase() === searchKey; })) return true;
      return false;
    });

    if (!matched && AppState.config.areas.length > 0) {
      matched = AppState.config.areas.find(function(a) { return a.slug === 'life-farm' || a.id === '2tr0bHx'; }) || AppState.config.areas[0];
    }
    AppState.area = matched;

    // 3. Handle OAuth Code if redirected from DingTalk Auth
    if (authCode) {
      const returnedState = urlParams.get('state') || '';
      const expectedState = sessionStorage.getItem(OAUTH_STATE_STORAGE_KEY) || '';
      const stateValid = Boolean(returnedState && expectedState && returnedState === expectedState);
      sessionStorage.removeItem(OAUTH_STATE_STORAGE_KEY);
      if (stateValid) await exchangeDingTalkCode(authCode);
      if (!stateValid) showToast('钉钉登录状态校验失败，请重新授权');
      const cleanUrl = new URL(window.location);
      cleanUrl.searchParams.delete('code');
      cleanUrl.searchParams.delete('authCode');
      cleanUrl.searchParams.delete('state');
      window.history.replaceState({}, '', cleanUrl.pathname + (cleanUrl.search ? cleanUrl.search : ''));
    }

    // 4. Role & Auth Decision
    if (isDingTalkEnv || isInternalDomain || explicitRole === 'teacher' || savedSession) {
      AppState.isTeacher = true;
      document.body.classList.add('teacher-mode-body');
      document.getElementById('parent-pure-image-flow').style.display = 'none';
      document.getElementById('teacher-workspace').style.display = 'block';

      if (savedSession && savedSession.token && AppState.config.hasTeacherAuth && AppState.config.user) {
        AppState.currentTeacher = AppState.config.user;
        AppState.sessionToken = savedSession.token;
      } else if (savedSession) {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }

      // If in DingTalk App and no saved session -> trigger DingTalk OAuth / JSAPI
      if (isDingTalkEnv && !AppState.currentTeacher) {
        // Try JSAPI silent auth first
        const silentOk = await handleDingTalkAutoLogin();
        if (!silentOk) {
          // If silent JSAPI didn't resolve, show the OAuth login prompt card
          showDingTalkLoginPrompt();
          return;
        }
      } else if (!AppState.currentTeacher) {
        showDingTalkLoginPrompt();
        return;
      }

      renderTeacherWorkspace();
      setupEventListeners();
    } else {
      // PURE PARENT VIEW: strictly 8 images
      AppState.isTeacher = false;
      document.body.classList.remove('teacher-mode-body');
      document.getElementById('parent-pure-image-flow').style.display = 'flex';
      document.getElementById('teacher-workspace').style.display = 'none';

      renderParentView();
    }
  } catch (err) {
    console.error('Init error:', err);
  }
}

// -------------------------------------------------------------
// DingTalk Code Exchange
// -------------------------------------------------------------
async function exchangeDingTalkCode(code) {
  try {
    showToast('⏳ 正在进行钉钉身份免登验证...');
    const res = await fetch('/api/dingtalk-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authCode: code })
    });
    const data = await res.json();
    if (data.success && data.user) {
      AppState.currentTeacher = data.user;
      AppState.sessionToken = data.session && data.session.token ? data.session.token : '';
      if (!AppState.sessionToken) return false;
      saveTeacherSession(data.user, data.session);
      await refreshTeacherDirectory();
      showToast('👩‍🏫 钉钉免登已识别：' + data.user.name + ' 老师 (90天有效)');
      return true;
    }
  } catch(e) {
    console.error('Code exchange failed:', e);
  }
  return false;
}

// -------------------------------------------------------------
// Trigger DingTalk Official OAuth2 Login
// -------------------------------------------------------------
function triggerDingTalkOAuth() {
  const currentUrl = window.location.origin + window.location.pathname;
  const redirectUri = encodeURIComponent(currentUrl);
  const randomBytes = new Uint8Array(24);
  crypto.getRandomValues(randomBytes);
  const state = Array.from(randomBytes, function(byte) { return byte.toString(16).padStart(2, '0'); }).join('');
  sessionStorage.setItem(OAUTH_STATE_STORAGE_KEY, state);
  const oauthUrl = 'https://login.dingtalk.com/oauth2/auth?client_id=' + DINGTALK_CLIENT_ID + '&response_type=code&scope=openid%20corpid&state=' + encodeURIComponent(state) + '&redirect_uri=' + redirectUri + '&prompt=consent';
  window.location.href = oauthUrl;
}

// -------------------------------------------------------------
// Long-Lived Session Helpers (90 Days Persistence)
// -------------------------------------------------------------
function saveTeacherSession(user, session) {
  if (!session || !session.token || !session.expiresAt) return;
  const sessionData = {
    user: user,
    token: session.token,
    expiresAt: session.expiresAt
  };
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionData));
  } catch(e) {}
}

function loadTeacherSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && data.token && data.expiresAt && data.expiresAt > Date.now()) {
      return data;
    }
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch(e) {}
  return null;
}

function authorizedHeaders(extra) {
  const headers = Object.assign({}, extra || {});
  if (AppState.sessionToken) headers.Authorization = 'Bearer ' + AppState.sessionToken;
  return headers;
}

async function refreshTeacherDirectory() {
  if (!AppState.sessionToken) return false;
  const res = await fetch('/api/config', { headers: authorizedHeaders() });
  if (!res.ok) return false;
  const config = await res.json();
  AppState.config.staff = config.staff || [];
  AppState.config.hasTeacherAuth = Boolean(config.hasTeacherAuth);
  if (config.user) AppState.currentTeacher = config.user;
  return AppState.config.hasTeacherAuth;
}

async function unlockTeacherDirectory() {
  const input = document.getElementById('manual-passcode-input');
  const passcode = input ? input.value : '';
  if (!passcode) {
    showToast('请先输入教师名录访问口令');
    return;
  }

  try {
    const res = await fetch('/api/config', {
      headers: { 'X-Teacher-Passcode': passcode }
    });
    const data = await res.json();
    if (!res.ok || !data.directoryUnlocked) {
      showToast('教师名录访问口令无效');
      return;
    }
    AppState.manualPasscode = passcode;
    AppState.config.staff = data.staff || [];
    renderQuickStaffList('');
    showToast('教师名录已解锁，请选择本人身份');
  } catch (error) {
    showToast('教师名录加载失败，请稍后重试');
  }
}

// -------------------------------------------------------------
// DingTalk JSAPI Silent Auth
// -------------------------------------------------------------
function handleDingTalkAutoLogin() {
  return new Promise(function(resolve) {
    if (window.dd && window.dd.runtime && window.dd.runtime.permission) {
      try {
        window.dd.ready(function() {
          window.dd.runtime.permission.requestAuthCode({
            corpId: AppState.config.corpId || 'dingfdcd647054eb40beee0f45d8e4f7c288',
            onSuccess: async function(result) {
              const ok = await exchangeDingTalkCode(result.code);
              resolve(ok);
            },
            onFail: function(err) {
              console.log('[DingTalk JSAPI Code Fail]', err);
              resolve(false);
            }
          });
        });
      } catch(e) {
        resolve(false);
      }
    } else {
      resolve(false);
    }
  });
}

function renderTeacherWorkspace() {
  updateTeacherCard();
  updateAreaBanner();
  renderChecklist();
  renderStars();
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function updateTeacherCard() {
  const teacher = AppState.currentTeacher || { name: '负责老师', title: '巡检教师', dept: '托育教学部' };
  document.getElementById('current-teacher-name').textContent = teacher.name;
  document.getElementById('current-teacher-dept').textContent = (teacher.dept || '教学部') + ' · ' + (teacher.title || '主班教师');
  const sessionStatus = document.getElementById('session-status-text');
  if (sessionStatus) {
    sessionStatus.textContent = AppState.sessionToken
      ? '教师身份已认证 · 90天免登有效'
      : '等待教师身份认证';
  }
  
  const submitBtnText = document.getElementById('submit-btn-text');
  if (submitBtnText) {
    submitBtnText.textContent = '确认并以【' + teacher.name + '】老师身份提交打卡';
  }

  const avatarBox = document.getElementById('teacher-avatar-box');
  if (avatarBox) {
    avatarBox.textContent = '';
    if (teacher.avatar) {
      const image = document.createElement('img');
      image.src = teacher.avatar;
      image.alt = teacher.name;
      avatarBox.appendChild(image);
    } else {
      const initial = document.createElement('span');
      initial.textContent = teacher.name.charAt(0) || '师';
      avatarBox.appendChild(initial);
    }
  }
}

function updateAreaBanner() {
  const area = AppState.area;
  if (!area) return;
  document.getElementById('area-icon-box').textContent = area.doodle || area.icon || '🐑';
  document.getElementById('area-title-text').textContent = area.name;
  document.getElementById('area-code-text').textContent = area.shortCode + ' · ' + (area.enName || 'AREA');
}

function renderChecklist() {
  const area = AppState.area;
  if (!area) return;

  AppState.selectedItems.clear();
  const container = document.getElementById('patrol-checklist');
  const items = area.checkItems || [];

  container.innerHTML = items.map(function(item, idx) {
    return '<div class="check-item-row" data-idx="' + idx + '" onclick="toggleCheckItem(' + idx + ', this)">' +
      '<div class="check-box-icon">✓</div>' +
      '<div class="check-text-content">' + escapeHtml(item) + '</div>' +
    '</div>';
  }).join('');

  selectAllCheckItems();
}

function toggleCheckItem(idx, element) {
  const itemText = AppState.area.checkItems[idx];
  if (AppState.selectedItems.has(itemText)) {
    AppState.selectedItems.delete(itemText);
    element.classList.remove('checked');
  } else {
    AppState.selectedItems.add(itemText);
    element.classList.add('checked');
  }
}

function selectAllCheckItems() {
  const items = AppState.area ? (AppState.area.checkItems || []) : [];
  AppState.selectedItems = new Set(items);
  const rows = document.querySelectorAll('.check-item-row');
  rows.forEach(function(r) { r.classList.add('checked'); });
  showToast('已一键全选所有巡检标准项 ✅');
}

function renderStars() {
  const dims = ['safety', 'hygiene', 'supplies', 'experience'];
  dims.forEach(function(dim) {
    const starContainer = document.getElementById('stars-' + dim);
    if (!starContainer) return;
    const currentVal = AppState.ratings[dim] || 5;
    let html = '';
    for (let i = 1; i <= 5; i++) {
      html += '<span onclick="setRating(\'' + dim + '\', ' + i + ')" style="cursor:pointer;">' + (i <= currentVal ? '★' : '☆') + '</span>';
    }
    starContainer.innerHTML = html;
  });
}

function setRating(dim, value) {
  AppState.ratings[dim] = value;
  renderStars();
}

function handlePhotoCapture(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  const availableSlots = 5 - AppState.uploadedPhotos.length;
  if (availableSlots <= 0) {
    showToast('现场照片最多 5 张');
    event.target.value = '';
    return;
  }

  for (let i = 0; i < Math.min(files.length, availableSlots); i++) {
    if (!/^image\/(?:jpeg|png|webp)$/i.test(files[i].type || '')) {
      showToast('仅支持 JPEG、PNG 或 WebP 图片');
      continue;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
      compressImage(e.target.result, 1200, 0.8, function(compressedB64) {
        AppState.uploadedPhotos.push({ data: compressedB64, reference: '' });
        renderPhotoPreviews();
        showToast('照片已添加 📸');
      });
    };
    reader.readAsDataURL(files[i]);
  }
}

function renderPhotoPreviews() {
  const container = document.getElementById('photo-previews');
  container.innerHTML = AppState.uploadedPhotos.map(function(p, idx) {
    return '<div class="photo-thumb-item">' +
      '<img src="' + escapeHtml(p.data) + '" alt="现场照片 ' + (idx + 1) + '" />' +
      '<div class="photo-thumb-remove" onclick="removePhoto(' + idx + ')">×</div>' +
    '</div>';
  }).join('');
}

function removePhoto(idx) {
  AppState.uploadedPhotos.splice(idx, 1);
  renderPhotoPreviews();
}

function compressImage(base64Data, maxDimension, quality, callback) {
  const img = new Image();
  img.src = base64Data;
  img.onload = function() {
    let width = img.width;
    let height = img.height;
    if (width > height) {
      if (width > maxDimension) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      }
    } else {
      if (height > maxDimension) {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    callback(canvas.toDataURL('image/jpeg', quality));
  };
  img.onerror = function() {
    showToast('图片读取失败，请重新选择');
  };
}

async function uploadPendingPhotos() {
  for (let i = 0; i < AppState.uploadedPhotos.length; i += 1) {
    const photo = AppState.uploadedPhotos[i];
    if (photo.reference) continue;
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: authorizedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ image: photo.data })
    });
    const result = await res.json();
    if (!res.ok || !result.reference) {
      throw new Error(result.error || '照片上传失败');
    }
    photo.reference = result.reference;
  }
  return AppState.uploadedPhotos.map(function(photo) { return photo.reference; });
}

async function submitPatrol() {
  const area = AppState.area;
  const teacher = AppState.currentTeacher;
  if (!teacher || !AppState.sessionToken) {
    showDingTalkLoginPrompt();
    showToast('请先完成教师身份认证');
    return;
  }
  
  const remarks = document.getElementById('patrol-remarks').value.trim();
  const checkItemsList = Array.from(AppState.selectedItems);

  const submitBtn = document.getElementById('submit-patrol-btn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>⏳ 正在以【' + escapeHtml(teacher.name) + '】老师身份写入钉钉AI表格...</span>';

  try {
    const photoReferences = await uploadPendingPhotos();
    const payload = {
      areaId: area.id,
      patrolType: '每日巡检',
      checkItems: checkItemsList,
      ratings: AppState.ratings,
      remarks: remarks,
      photos: photoReferences
    };
    const res = await fetch('/api/checkin', {
      method: 'POST',
      headers: authorizedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (res.ok && result.success) {
      showSuccessModal(result, teacher);
    } else {
      if (res.status === 401) {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        AppState.sessionToken = '';
        AppState.currentTeacher = null;
        showDingTalkLoginPrompt();
      }
      alert('打卡失败: ' + (result.error || '未知错误'));
    }
  } catch (err) {
    alert(err && err.message ? err.message : '网络异常，打卡提交失败，请重试');
  } finally {
    submitBtn.disabled = false;
    updateTeacherCard();
  }
}

function showSuccessModal(data, teacher) {
  const modal = document.getElementById('success-modal');
  document.getElementById('success-time').textContent = data.timestamp;
  document.getElementById('success-user').textContent = (data.userName || teacher.name) + ' 老师';
  document.getElementById('success-record-id').textContent = data.recordId;
  document.getElementById('success-area-name').textContent = data.areaName;
  modal.classList.add('active');
}

function closeSuccessModal() {
  document.getElementById('success-modal').classList.remove('active');
}

// -------------------------------------------------------------
// Switch Teacher Modal
// -------------------------------------------------------------
async function openSwitchTeacherModal() {
  const modal = document.getElementById('switch-teacher-modal');
  const list = document.getElementById('staff-switch-list');
  if ((!AppState.config.staff || AppState.config.staff.length === 0) && AppState.sessionToken) {
    await refreshTeacherDirectory();
  }
  const staff = AppState.config.staff || [];

  if (staff.length === 0) {
    showToast('教师名录暂不可用，请重新登录');
    return;
  }
  
  list.innerHTML = staff.map(function(s) {
    const encodedUserId = encodeURIComponent(s.userid);
    return '<div class="staff-switch-option" onclick="selectTeacher(decodeURIComponent(\'' + encodedUserId + '\'))">' +
      '<div>' +
        '<div style="font-weight:700; color:#222;">' + escapeHtml(s.name) + ' 老师</div>' +
        '<div style="font-size:11px; color:#777;">' + escapeHtml(s.title || '教师') + ' · ' + escapeHtml(s.dept || '教学部') + '</div>' +
      '</div>' +
      '<div style="color:var(--primary); font-weight:700; font-size:12px;">选择并保持免登 →</div>' +
    '</div>';
  }).join('');

  modal.classList.add('active');
}

function closeSwitchTeacherModal() {
  document.getElementById('switch-teacher-modal').classList.remove('active');
}

async function selectTeacher(userid) {
  const success = await authenticateManualTeacher(userid);
  if (success) closeSwitchTeacherModal();
}

function renderParentView() {
  const container = document.getElementById('parent-pure-image-flow');
  const area = AppState.area;
  if (!container || !area) return;

  if (area.detailImages && area.detailImages.length > 0) {
    container.innerHTML = area.detailImages.map(function(imgUrl, idx) {
      return '<img src="' + escapeHtml(imgUrl) + '" alt="' + escapeHtml(area.name) + ' 空间教育解读 ' + (idx + 1) + '" class="parent-pure-img" loading="' + (idx === 0 ? 'eager' : 'lazy') + '" />';
    }).join('');
  }
}

function setupEventListeners() {
  const photoInput = document.getElementById('photo-input');
  if (photoInput) photoInput.addEventListener('change', handlePhotoCapture);
}

function showToast(msg) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'toast-msg';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(function() {
    toast.classList.remove('show');
  }, 2500);
}


function showDingTalkLoginPrompt() {
  const modal = document.getElementById('login-prompt-modal');
  if (modal) {
    renderQuickStaffList('');
    modal.classList.add('active');
  }
}

function renderQuickStaffList(filterText) {
  const container = document.getElementById('quick-login-staff-list');
  if (!container) return;
  const staff = AppState.config ? (AppState.config.staff || []) : [];
  const keyword = (filterText || '').trim().toLowerCase();

  const filtered = staff.filter(function(s) {
    if (!keyword) return true;
    return (s.name && s.name.toLowerCase().includes(keyword)) ||
           (s.dept && s.dept.toLowerCase().includes(keyword)) ||
           (s.title && s.title.toLowerCase().includes(keyword));
  });

  if (staff.length === 0) {
    container.innerHTML = '<div style="font-size:12px; color:#666; text-align:center; padding:16px;">输入教师名录访问口令后，才会显示在册人员。</div>';
    return;
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div style="font-size:12px; color:#888; text-align:center; padding:16px;">未找到匹配教师</div>';
    return;
  }

  container.innerHTML = filtered.map(function(s) {
    const encodedUserId = encodeURIComponent(s.userid);
    return '<div class="staff-switch-option" onclick="quickLoginAsTeacher(decodeURIComponent(\'' + encodedUserId + '\'))" style="padding:8px 10px;">' +
      '<div>' +
        '<div style="font-weight:700; color:#222; font-size:13px;">' + escapeHtml(s.name) + ' <span style="font-size:11px; font-weight:normal; color:#666;">老师</span></div>' +
        '<div style="font-size:11px; color:#888;">' + escapeHtml(s.dept || '教学部') + ' · ' + escapeHtml(s.title || '教师') + '</div>' +
      '</div>' +
      '<div style="color:var(--primary); font-weight:700; font-size:12px;">确认绑定 →</div>' +
    '</div>';
  }).join('');
}

function filterStaffList(text) {
  renderQuickStaffList(text);
}

async function authenticateManualTeacher(userid) {
  let passcode = AppState.manualPasscode;
  if (!passcode) {
    const input = document.getElementById('manual-passcode-input');
    passcode = input ? input.value : '';
  }
  if (!passcode) passcode = window.prompt('请输入教师名录访问口令') || '';
  if (!passcode) return false;

  try {
    const res = await fetch('/api/dingtalk-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userid, passcode: passcode })
    });
    const data = await res.json();
    if (!res.ok || !data.success || !data.user || !data.session || !data.session.token) {
      showToast(data.error || '教师身份认证失败');
      return false;
    }
    AppState.manualPasscode = passcode;
    AppState.currentTeacher = data.user;
    AppState.sessionToken = data.session.token;
    saveTeacherSession(data.user, data.session);
    AppState.manualPasscode = '';
    const passcodeInput = document.getElementById('manual-passcode-input');
    if (passcodeInput) passcodeInput.value = '';
    updateTeacherCard();
    showToast('已认证为：' + data.user.name + ' 老师 (90天免登有效)');
    return true;
  } catch (error) {
    showToast('教师身份认证失败，请稍后重试');
    return false;
  }
}

async function quickLoginAsTeacher(userid) {
  const success = await authenticateManualTeacher(userid);
  if (!success) return;
  const modal = document.getElementById('login-prompt-modal');
  if (modal) modal.classList.remove('active');
  renderTeacherWorkspace();
  setupEventListeners();
}
