// DADDY HOME Campus Environment Patrol & Space Education
// DingTalk Long-Lived Teacher Auth (90 Days Persistence) & Direct Identity Record

const SESSION_STORAGE_KEY = 'dh_patrol_teacher_session_v2';
const DEFAULT_EXPIRY_DAYS = 90;

let AppState = {
  config: null,
  area: null,
  isTeacher: false,
  currentTeacher: null,
  selectedItems: new Set(),
  uploadedPhotos: [],
  ratings: { safety: 5, hygiene: 5, supplies: 5, experience: 5 }
};

document.addEventListener('DOMContentLoaded', async function() {
  await initApp();
});

async function initApp() {
  try {
    const res = await fetch('/api/config');
    AppState.config = await res.json();

    const ua = navigator.userAgent || '';
    const isDingTalkEnv = /DingTalk/i.test(ua);
    const hostname = window.location.hostname || '';
    const isInternalDomain = hostname.includes('daddyhome.club');

    const urlParams = new URLSearchParams(window.location.search);
    const explicitRole = urlParams.get('role');

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

    // 2. Check Saved Long-Lived Teacher Session
    const savedSession = loadTeacherSession();

    // 3. Role Decision:
    if (isDingTalkEnv || isInternalDomain || explicitRole === 'teacher' || savedSession) {
      AppState.isTeacher = true;
      document.body.classList.add('teacher-mode-body');
      document.getElementById('parent-pure-image-flow').style.display = 'none';
      document.getElementById('teacher-workspace').style.display = 'block';

      if (savedSession && savedSession.user) {
        AppState.currentTeacher = savedSession.user;
      }

      // If in DingTalk App, trigger silent auto-login to refresh / verify identity
      if (isDingTalkEnv) {
        await handleDingTalkAutoLogin();
      } else if (!AppState.currentTeacher && AppState.config.staff && AppState.config.staff.length > 0) {
        // Fallback default teacher
        AppState.currentTeacher = AppState.config.staff[0];
        saveTeacherSession(AppState.currentTeacher, DEFAULT_EXPIRY_DAYS);
      }

      renderTeacherWorkspace();
      setupEventListeners();
    } else {
      // PURE PARENT VIEW: strictly 7 images
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
// Long-Lived Session Helpers (90 Days Persistence)
// -------------------------------------------------------------
function saveTeacherSession(user, days) {
  const expiry = Date.now() + (days || DEFAULT_EXPIRY_DAYS) * 24 * 3600 * 1000;
  const sessionData = {
    user: user,
    expiresAt: expiry
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
    if (data && data.expiresAt && data.expiresAt > Date.now()) {
      return data;
    }
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch(e) {}
  return null;
}

// -------------------------------------------------------------
// DingTalk JSAPI Silent Auth
// -------------------------------------------------------------
async function handleDingTalkAutoLogin() {
  if (window.dd && window.dd.runtime && window.dd.runtime.permission) {
    try {
      window.dd.ready(function() {
        window.dd.runtime.permission.requestAuthCode({
          corpId: AppState.config.corpId || 'dingfdcd647054eb40beee0f45d8e4f7c288',
          onSuccess: async function(result) {
            const res = await fetch('/api/dingtalk-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ authCode: result.code })
            });
            const data = await res.json();
            if (data.success && data.user) {
              AppState.currentTeacher = data.user;
              saveTeacherSession(data.user, DEFAULT_EXPIRY_DAYS);
              updateTeacherCard();
              showToast('👩‍🏫 钉钉免登已识别：' + data.user.name + ' 老师');
            }
          },
          onFail: function(err) {
            console.log('[DingTalk JSAPI Code Fail]', err);
          }
        });
      });
    } catch(e) {
      console.log('[DingTalk JSAPI Error]', e);
    }
  }
}

function renderTeacherWorkspace() {
  updateTeacherCard();
  updateAreaBanner();
  renderChecklist();
  renderStars();
}

function updateTeacherCard() {
  const teacher = AppState.currentTeacher || { name: '负责老师', title: '巡检教师', dept: '托育教学部' };
  document.getElementById('current-teacher-name').textContent = teacher.name;
  document.getElementById('current-teacher-dept').textContent = (teacher.dept || '教学部') + ' · ' + (teacher.title || '主班教师');
  
  const submitBtnText = document.getElementById('submit-btn-text');
  if (submitBtnText) {
    submitBtnText.textContent = '确认并以【' + teacher.name + '】老师身份提交打卡';
  }

  const avatarBox = document.getElementById('teacher-avatar-box');
  if (avatarBox) {
    if (teacher.avatar) {
      avatarBox.innerHTML = '<img src="' + teacher.avatar + '" alt="' + teacher.name + '" />';
    } else {
      avatarBox.innerHTML = '<span>' + (teacher.name.charAt(0) || '师') + '</span>';
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
      '<div class="check-text-content">' + item + '</div>' +
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

  for (let i = 0; i < files.length; i++) {
    const reader = new FileReader();
    reader.onload = function(e) {
      compressImage(e.target.result, 1200, 0.8, function(compressedB64) {
        AppState.uploadedPhotos.push(compressedB64);
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
      '<img src="' + p + '" />' +
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
}

async function submitPatrol() {
  const area = AppState.area;
  const teacher = AppState.currentTeacher || { userid: '015018644521509971', name: '周士顶' };
  
  const remarks = document.getElementById('patrol-remarks').value.trim();
  const checkItemsList = Array.from(AppState.selectedItems);

  const submitBtn = document.getElementById('submit-patrol-btn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>⏳ 正在以【' + teacher.name + '】老师身份写入钉钉AI表格...</span>';

  const payload = {
    areaId: area.id,
    sheetId: area.sheetId,
    areaName: area.name,
    patrolType: '每日巡检',
    userId: teacher.userid,
    userName: teacher.name,
    checkItems: checkItemsList,
    ratings: AppState.ratings,
    remarks: remarks,
    photos: AppState.uploadedPhotos
  };

  try {
    const res = await fetch('/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (result.success) {
      showSuccessModal(result, teacher);
    } else {
      alert('打卡失败: ' + (result.error || '未知错误'));
    }
  } catch (err) {
    alert('网络异常，打卡提交失败，请重试');
  } finally {
    submitBtn.disabled = false;
    updateTeacherCard();
  }
}

function showSuccessModal(data, teacher) {
  const modal = document.getElementById('success-modal');
  document.getElementById('success-time').textContent = data.timestamp;
  document.getElementById('success-user').textContent = (data.userName || teacher.name) + ' 老师 (ID: ' + (teacher.userid || '') + ')';
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
function openSwitchTeacherModal() {
  const modal = document.getElementById('switch-teacher-modal');
  const list = document.getElementById('staff-switch-list');
  const staff = AppState.config.staff || [];
  
  list.innerHTML = staff.map(function(s) {
    return '<div class="staff-switch-option" onclick="selectTeacher(\'' + s.userid + '\')">' +
      '<div>' +
        '<div style="font-weight:700; color:#222;">' + s.name + ' 老师</div>' +
        '<div style="font-size:11px; color:#777;">' + (s.title || '教师') + ' · ' + (s.dept || '教学部') + '</div>' +
      '</div>' +
      '<div style="color:var(--primary); font-weight:700; font-size:12px;">选择并保持免登 →</div>' +
    '</div>';
  }).join('');

  modal.classList.add('active');
}

function closeSwitchTeacherModal() {
  document.getElementById('switch-teacher-modal').classList.remove('active');
}

function selectTeacher(userid) {
  const found = (AppState.config.staff || []).find(function(s) { return s.userid === userid; });
  if (found) {
    AppState.currentTeacher = found;
    saveTeacherSession(found, DEFAULT_EXPIRY_DAYS);
    updateTeacherCard();
    closeSwitchTeacherModal();
    showToast('已切换为：' + found.name + ' 老师 (90天免登有效)');
  }
}

function renderParentView() {
  const container = document.getElementById('parent-pure-image-flow');
  const area = AppState.area;
  if (!container || !area) return;

  if (area.detailImages && area.detailImages.length > 0) {
    container.innerHTML = area.detailImages.map(function(imgUrl, idx) {
      return '<img src="' + imgUrl + '" alt="' + area.name + ' 空间教育解读 ' + (idx + 1) + '" class="parent-pure-img" loading="' + (idx === 0 ? 'eager' : 'lazy') + '" />';
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
