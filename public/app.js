// DADDY HOME Campus Environment Patrol & Space Education
// Clean Sub-route Resolution (e.g. /life-farm, /woodworking, /hall, /areas/:id, or ?area=...)

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

    // 1. Resolve Target Area from Sub-route Path or Query
    // Path examples: /life-farm, /woodworking, /areas/2tr0bHx, /areas/life-farm
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

    console.log('[Sub-route Resolved]', { searchKey: searchKey, areaName: matched.name, areaId: matched.id, slug: matched.slug });

    // 2. Role Decision:
    if (isDingTalkEnv || isInternalDomain || explicitRole === 'teacher') {
      AppState.isTeacher = true;
      document.body.classList.add('teacher-mode-body');
      document.getElementById('parent-pure-image-flow').style.display = 'none';
      document.getElementById('teacher-workspace').style.display = 'block';

      if (isDingTalkEnv) {
        await handleDingTalkAutoLogin();
      }
      renderTeacherForm();
      setupEventListeners();
    } else {
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

function renderParentView() {
  const container = document.getElementById('parent-pure-image-flow');
  const area = AppState.area;
  if (!container || !area) return;

  // If area has dedicated detail images (e.g. 生命场 4 images from 你的段落文字)
  if (area.detailImages && area.detailImages.length > 0) {
    container.innerHTML = area.detailImages.map(function(imgUrl, idx) {
      return '<img src="' + imgUrl + '" alt="' + area.name + ' 空间教育解读 ' + (idx + 1) + '" class="parent-pure-img" loading="' + (idx === 0 ? 'eager' : 'lazy') + '" />';
    }).join('');
  } else {
    // Fallback presentation for other areas
    container.innerHTML = '<div style="background: #fff; padding: 24px 20px; line-height: 1.6; font-size: 15px;">' +
      '<h1 style="font-size: 22px; font-weight: 800; color: #654096; margin-bottom: 8px;">' + area.name + '</h1>' +
      '<p style="color: #666; font-size: 14px; margin-bottom: 16px;">' + (area.handwrittenNote || '') + '</p>' +
      '<p style="color: #333; line-height: 1.8;">' + (area.educationIntro || '') + '</p>' +
      (area.image ? '<img src="' + area.image + '" style="width: 100%; border-radius: 8px; margin-top: 14px;" />' : '') +
      '</div>';
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
  const area = AppState.area;
  if (!area) return;

  document.getElementById('teacher-area-title').textContent = area.name + ' 巡检标准核验';
  document.getElementById('header-area-subtitle').textContent = '钉钉巡检工作台 · ' + area.name;

  const staffSelect = document.getElementById('staff-select');
  staffSelect.innerHTML = (AppState.config.staff || []).map(function(s) {
    return '<option value="' + s.userid + '" data-name="' + s.name + '">' + s.name + ' (' + (s.title || '教师') + ')</option>';
  }).join('');

  if (AppState.currentTeacher && AppState.currentTeacher.userid) {
    staffSelect.value = AppState.currentTeacher.userid;
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
  document.getElementById('success-area-name').textContent = data.areaName;
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
