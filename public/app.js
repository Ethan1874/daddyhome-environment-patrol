// DADDY HOME 生命场 (LIFE FARM)
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
    const ua = navigator.userAgent || '';
    const isDingTalkEnv = /DingTalk/i.test(ua);
    const hostname = window.location.hostname || '';
    const isInternalDomain = hostname.includes('daddyhome.club');

    const urlParams = new URLSearchParams(window.location.search);
    const explicitRole = urlParams.get('role');

    // 1. Role Decision:
    // If DingTalk scan OR internal domain (*.daddyhome.club) OR ?role=teacher -> Teacher Patrol Workspace
    // Otherwise -> Pure 4-Image Presentation (Nothing else!)
    if (isDingTalkEnv || isInternalDomain || explicitRole === 'teacher') {
      AppState.isTeacher = true;
      document.body.classList.add('teacher-mode-body');
      document.getElementById('parent-pure-image-flow').style.display = 'none';
      document.getElementById('teacher-workspace').style.display = 'block';

      const res = await fetch('/api/config');
      AppState.config = await res.json();
      AppState.area = AppState.config.areas.find(function(a) { return a.id === '2tr0bHx'; }) || AppState.config.areas[0];

      if (isDingTalkEnv) {
        await handleDingTalkAutoLogin();
      }
      renderTeacherForm();
      setupEventListeners();
    } else {
      // PURE PARENT VIEW: Keep only the 4 images, zero JS processing needed
      AppState.isTeacher = false;
      document.getElementById('parent-pure-image-flow').style.display = 'flex';
      document.getElementById('teacher-workspace').style.display = 'none';
    }
  } catch (err) {
    console.error('Init error:', err);
  }
}

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
              document.getElementById('teacher-name-badge').textContent = '👩‍🏫 ' + data.user.name + ' 老师';
              const staffSelect = document.getElementById('staff-select');
              if (staffSelect) staffSelect.value = data.user.userid;
              showToast('👩‍🏫 钉钉免登已识别：' + data.user.name + ' 老师');
            }
          }
        });
      });
    } catch(e) {}
  }
}

function renderTeacherForm() {
  const staffSelect = document.getElementById('staff-select');
  staffSelect.innerHTML = (AppState.config.staff || []).map(function(s) {
    return '<option value="' + s.userid + '" data-name="' + s.name + '">' + s.name + ' (' + (s.title || '教师') + ')</option>';
  }).join('');

  if (AppState.currentTeacher && AppState.currentTeacher.userid) {
    staffSelect.value = AppState.currentTeacher.userid;
  }

  AppState.selectedItems.clear();
  const checklistContainer = document.getElementById('patrol-checklist');
  const items = AppState.area ? (AppState.area.checkItems || []) : [];
  
  checklistContainer.innerHTML = items.map(function(item, idx) {
    return '<label class="check-item-label" data-idx="' + idx + '" onclick="toggleCheckItem(' + idx + ', this)">' +
      '<div class="custom-checkbox">✓</div>' +
      '<div class="check-item-text">' + item + '</div>' +
    '</label>';
  }).join('');

  selectAllCheckItems();
  renderStars();
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
  const staffSelect = document.getElementById('staff-select');
  const userId = staffSelect.value;
  const selectedOption = staffSelect.options[staffSelect.selectedIndex];
  const userName = selectedOption ? selectedOption.getAttribute('data-name') : '负责老师';

  const patrolType = document.getElementById('patrol-type-select').value;
  const remarks = document.getElementById('patrol-remarks').value.trim();
  const checkItemsList = Array.from(AppState.selectedItems);

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
    alert('网络异常，打卡提交失败，请重试');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>✅ 确认并提交巡检记录</span>';
  }
}

function showSuccessModal(data) {
  const modal = document.getElementById('success-modal');
  document.getElementById('success-time').textContent = data.timestamp;
  document.getElementById('success-user').textContent = data.userName;
  document.getElementById('success-record-id').textContent = data.recordId;
  modal.classList.add('active');
}

function closeSuccessModal() {
  document.getElementById('success-modal').classList.remove('active');
}

function setupEventListeners() {
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
