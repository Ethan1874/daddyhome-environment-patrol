// DADDY HOME Environment Patrol & Education Web App
// Role Separation: 
// - DingTalk Scan OR Internal Domain (*.daddyhome.club) -> Internal Teacher Patrol Mode (Auto-Login & Auto-Checkin)
// - WeChat Scan OR External Domain (*.daddyhome.love) -> Pure Parent Educational Rationale (No Passwords / No Clutter)

let AppState = {
  config: null,
  currentArea: null,
  isTeacher: false,
  currentTeacher: null,
  currentTab: 'edu',
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
    const isExternalDomain = hostname.includes('daddyhome.love');

    const urlParams = new URLSearchParams(window.location.search);
    const targetAreaId = urlParams.get('area') || urlParams.get('sheet') || urlParams.get('id');
    const explicitRole = urlParams.get('role');

    // Match Area
    let matched = null;
    if (targetAreaId) {
      matched = AppState.config.areas.find(function(a) {
        return a.id === targetAreaId || a.sheetId === targetAreaId || a.shortCode === targetAreaId;
      });
    }
    if (!matched && AppState.config.areas.length > 0) {
      matched = AppState.config.areas[0];
    }
    AppState.currentArea = matched;

    // Role Routing:
    // 1. If scanned in DingTalk App -> Teacher Mode with Auto-Login
    if (isDingTalkEnv) {
      AppState.isTeacher = true;
      AppState.currentTab = 'patrol';
      await handleDingTalkAutoLogin();
    } 
    // 2. If accessed via Internal Domain (*.daddyhome.club) or ?role=teacher -> Teacher Mode
    else if (isInternalDomain || explicitRole === 'teacher') {
      AppState.isTeacher = true;
      AppState.currentTab = 'patrol';
    } 
    // 3. If accessed via WeChat, External Domain (*.daddyhome.love), or standard browser -> Pure Parent View
    else {
      AppState.isTeacher = false;
      AppState.currentTab = 'edu';
    }

    renderApp();
    setupEventListeners();
  } catch (err) {
    console.error('Failed to init app:', err);
    showToast('数据加载失败，请刷新重试');
  }
}

async function handleDingTalkAutoLogin() {
  if (window.dd && window.dd.runtime && window.dd.runtime.permission) {
    try {
      window.dd.ready(function() {
        window.dd.runtime.permission.requestAuthCode({
          corpId: AppState.config.corpId || 'dingfdcd647054eb40beee0f45d8e4f7c288',
          onSuccess: async function(result) {
            const authCode = result.code;
            const res = await fetch('/api/dingtalk-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ authCode: authCode })
            });
            const data = await res.json();
            if (data.success && data.user) {
              AppState.currentTeacher = data.user;
              renderPatrolForm(AppState.currentArea);
              showToast('👩‍🏫 钉钉免登已识别：' + data.user.name + ' 老师');
            }
          },
          onFail: function(err) {
            console.log('[DingTalk JSAPI Fail]', err);
          }
        });
      });
    } catch(e) {
      console.log('[DingTalk JSAPI Error]', e);
    }
  }
}

function renderApp() {
  const area = AppState.currentArea;
  if (!area) return;

  const idx = AppState.config.areas.findIndex(function(a) { return a.id === area.id; });
  const serialNo = 'ZONE · 0' + (idx >= 0 ? idx + 1 : 1);

  document.getElementById('current-area-btn-text').textContent = area.name;

  document.getElementById('hero-serial').textContent = serialNo;
  document.getElementById('hero-title-cn').textContent = area.name;
  document.getElementById('hero-title-en').textContent = area.enName + ' · ' + area.shortCode;
  document.getElementById('hero-doodle').textContent = area.doodle || area.icon || '🏡';
  document.getElementById('hero-handwritten').textContent = area.handwrittenNote || '「让孩子在真实环境中建构独立与专注」';
  
  const tagsContainer = document.getElementById('hero-tags');
  tagsContainer.innerHTML = (area.tags || []).map(function(t) {
    return '<span class="badge-tag-pill">[ ' + t + ' ]</span>';
  }).join('');

  // Update Role UI Visibility
  const teacherTabs = document.getElementById('teacher-view-tabs');
  const teacherBadge = document.getElementById('teacher-role-badge');
  const headerSubtitle = document.getElementById('header-role-subtitle');

  if (AppState.isTeacher) {
    teacherTabs.style.display = 'flex';
    teacherBadge.style.display = 'flex';
    if (AppState.currentTeacher && AppState.currentTeacher.name) {
      teacherBadge.innerHTML = '<span>👩‍🏫 ' + AppState.currentTeacher.name + ' 老师</span>';
    }
    headerSubtitle.textContent = '钉钉巡检工作台 · 自动同步';
  } else {
    teacherTabs.style.display = 'none';
    teacherBadge.style.display = 'none';
    headerSubtitle.textContent = '空间教育解读 · 蒙氏环境';
  }

  renderEducationView(area);
  renderPatrolForm(area);
  switchTab(AppState.currentTab);
}

function renderEducationView(area) {
  document.getElementById('edu-intro-text').textContent = area.educationIntro;

  const principlesList = document.getElementById('edu-principles-list');
  if (area.montessoriPrinciples && area.montessoriPrinciples.length > 0) {
    principlesList.innerHTML = area.montessoriPrinciples.map(function(p) {
      return '<div class="principle-item">' +
        '<div class="principle-title">✨ ' + p.title + '</div>' +
        '<div class="principle-desc">' + p.desc + '</div>' +
      '</div>';
    }).join('');
  } else {
    principlesList.innerHTML = '';
  }

  const photoImg = document.getElementById('edu-photo-img');
  if (area.image) {
    photoImg.src = area.image;
    document.getElementById('edu-photo-wrap').style.display = 'block';
  } else {
    document.getElementById('edu-photo-wrap').style.display = 'none';
  }
}

function renderPatrolForm(area) {
  const staffSelect = document.getElementById('staff-select');
  staffSelect.innerHTML = (AppState.config.staff || []).map(function(s) {
    return '<option value="' + s.userid + '" data-name="' + s.name + '">' + s.name + ' (' + (s.title || '教师') + ')</option>';
  }).join('');

  if (AppState.currentTeacher && AppState.currentTeacher.userid) {
    staffSelect.value = AppState.currentTeacher.userid;
  } else {
    const savedStaffId = localStorage.getItem('last_patrol_staff_id');
    if (savedStaffId) {
      staffSelect.value = savedStaffId;
    }
  }

  AppState.selectedItems.clear();
  const checklistContainer = document.getElementById('patrol-checklist');
  const items = area.checkItems || [];
  
  checklistContainer.innerHTML = items.map(function(item, idx) {
    return '<label class="check-item-label" data-idx="' + idx + '" onclick="toggleCheckItem(' + idx + ', this)">' +
      '<div class="custom-checkbox">✓</div>' +
      '<div class="check-item-text">' + item + '</div>' +
    '</label>';
  }).join('');

  selectAllCheckItems();
  renderStars();

  AppState.uploadedPhotos = [];
  renderPhotoPreviews();
}

function toggleCheckItem(idx, element) {
  const itemText = AppState.currentArea.checkItems[idx];
  if (AppState.selectedItems.has(itemText)) {
    AppState.selectedItems.delete(itemText);
    element.classList.remove('checked');
  } else {
    AppState.selectedItems.add(itemText);
    element.classList.add('checked');
  }
}

function selectAllCheckItems() {
  const items = AppState.currentArea.checkItems || [];
  AppState.selectedItems = new Set(items);
  const labels = document.querySelectorAll('.check-item-label');
  labels.forEach(function(l) { l.classList.add('checked'); });
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

function renderPhotoPreviews() {
  const container = document.getElementById('photo-previews');
  container.innerHTML = AppState.uploadedPhotos.map(function(p, idx) {
    return '<div class="thumb-wrap">' +
      '<img src="' + p + '" class="preview-thumb" />' +
      '<div class="thumb-remove" onclick="removePhoto(' + idx + ')">×</div>' +
    '</div>';
  }).join('');
}

function removePhoto(idx) {
  AppState.uploadedPhotos.splice(idx, 1);
  renderPhotoPreviews();
}

function handlePhotoCapture(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const reader = new FileReader();
    reader.onload = function(e) {
      compressImage(e.target.result, 1200, 0.8, function(compressedB64) {
        AppState.uploadedPhotos.push(compressedB64);
        renderPhotoPreviews();
        showToast('照片已添加 📸');
      });
    };
    reader.readAsDataURL(file);
  }
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
    const result = canvas.toDataURL('image/jpeg', quality);
    callback(result);
  };
}

async function submitPatrol() {
  const area = AppState.currentArea;
  const staffSelect = document.getElementById('staff-select');
  const userId = staffSelect.value;
  const selectedOption = staffSelect.options[staffSelect.selectedIndex];
  const userName = selectedOption ? selectedOption.getAttribute('data-name') : '负责老师';
  
  localStorage.setItem('last_patrol_staff_id', userId);

  const patrolType = document.getElementById('patrol-type-select').value;
  const remarks = document.getElementById('patrol-remarks').value.trim();
  const checkItemsList = Array.from(AppState.selectedItems);

  if (checkItemsList.length === 0) {
    if (!confirm('当前未勾选任何巡检项，确认直接提交吗？')) {
      return;
    }
  }

  const submitBtn = document.getElementById('submit-patrol-btn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>⏳ 正在同步写入钉钉AI表格...</span>';

  const payload = {
    areaId: area.id,
    sheetId: area.sheetId,
    areaName: area.name,
    patrolType: patrolType,
    userId: userId,
    userName: userName,
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
      showSuccessModal(result);
    } else {
      alert('打卡失败: ' + (result.error || '未知错误'));
    }
  } catch (err) {
    console.error('Submit error:', err);
    alert('网络异常，打卡提交失败，请重试');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>✅ 确认并提交巡检记录</span>';
  }
}

function showSuccessModal(data) {
  const modal = document.getElementById('success-modal');
  document.getElementById('success-area-name').textContent = data.areaName;
  document.getElementById('success-time').textContent = data.timestamp;
  document.getElementById('success-user').textContent = data.userName;
  document.getElementById('success-record-id').textContent = data.recordId;
  modal.classList.add('active');
}

function closeSuccessModal() {
  document.getElementById('success-modal').classList.remove('active');
  switchTab('edu');
}

function switchTab(tab) {
  AppState.currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.view-panel').forEach(function(p) { p.classList.remove('active'); });

  if (tab === 'edu') {
    const eduBtn = document.getElementById('tab-edu-btn');
    if (eduBtn) eduBtn.classList.add('active');
    document.getElementById('view-edu-panel').classList.add('active');
  } else {
    const patrolBtn = document.getElementById('tab-patrol-btn');
    if (patrolBtn) patrolBtn.classList.add('active');
    document.getElementById('view-patrol-panel').classList.add('active');
  }
}

function openAreaSelector() {
  const modal = document.getElementById('area-selector-modal');
  const list = document.getElementById('modal-areas-list');
  list.innerHTML = (AppState.config.areas || []).map(function(a) {
    return '<div class="area-modal-item ' + (a.id === AppState.currentArea.id ? 'active' : '') + '" onclick="selectArea(\'' + a.id + '\')">' +
      '<div class="modal-item-icon">' + (a.doodle || a.icon || '🏡') + '</div>' +
      '<div>' +
        '<div class="modal-item-title">' + a.name + '</div>' +
        '<div class="modal-item-sub">' + a.enName + ' · ' + a.shortCode + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  modal.classList.add('active');
}

function closeAreaSelector() {
  document.getElementById('area-selector-modal').classList.remove('active');
}

function selectArea(areaId) {
  const target = AppState.config.areas.find(function(a) { return a.id === areaId; });
  if (target) {
    AppState.currentArea = target;
    const url = new URL(window.location);
    url.searchParams.set('area', target.id);
    window.history.pushState({}, '', url);
    renderApp();
    closeAreaSelector();
  }
}

function setupEventListeners() {
  document.getElementById('tab-edu-btn').addEventListener('click', function() { switchTab('edu'); });
  document.getElementById('tab-patrol-btn').addEventListener('click', function() { switchTab('patrol'); });
  document.getElementById('area-switch-btn').addEventListener('click', openAreaSelector);
  document.getElementById('modal-close-btn').addEventListener('click', closeAreaSelector);
  document.getElementById('photo-input').addEventListener('change', handlePhotoCapture);
  document.getElementById('submit-patrol-btn').addEventListener('click', submitPatrol);
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
