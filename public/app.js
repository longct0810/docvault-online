const $ = selector => document.querySelector(selector);
const api = '/api';
let current = null;
let entries = [];
let folders = [];
const selectedIds = new Set();
let selectionAnchor = null;
let clipboard = null;
let dragSelection = null;
let grid = false;
let homeMode = true;
let searchResults = null;
let searchTimer;
let history = [{ id: null, home: true }];
let historyIndex = 0;
let previewObjectUrl = null;
let previewController = null;
let activityOffset = 0;
let activityTotal = 0;
let activityLoading = false;
let currentUser = null;
let passwordChangeForced = false;
let permissionEntryId = null;
let permissionData = null;
let userRows = [];
let toastTimer;
let catalogKind = null;
let catalogItems = [];
let catalogDetail = null;
let catalogObjectId = null;
let catalogSearchTimer;
let catalogListRequest = 0;
let catalogDetailRequest = 0;
const roleRank = { viewer: 1, editor: 2, manager: 3 };

function hasRole(required) {
  return Boolean(currentUser?.isAdmin || roleRank[currentUser?.role] >= roleRank[required]);
}

function isPersonalFolder(folderId) {
  let folder = folders.find(item => item.id === folderId);
  while (folder) {
    if (folder.is_personal) return true;
    folder = folders.find(item => item.id === folder.parent_id);
  }
  return false;
}

function canEditEntry(item) {
  return (hasRole('editor') || isPersonalFolder(item.kind === 'folder' ? item.id : item.parent_id))
    && ['edit', 'manage'].includes(item.access_level);
}

function canCopyEntry(item) {
  return (hasRole('editor') || isPersonalFolder(item.kind === 'folder' ? item.id : item.parent_id))
    && ['view', 'edit', 'manage'].includes(item.access_level);
}

function canDeleteEntry(item) {
  return (hasRole('manager') || isPersonalFolder(item.kind === 'folder' ? item.id : item.parent_id))
    && ['edit', 'manage'].includes(item.access_level);
}

$('#connection-warning').classList.toggle(
  'hidden',
  location.protocol === 'https:' || ['localhost', '127.0.0.1', '::1'].includes(location.hostname)
);

async function request(url, options = {}) {
  const headers = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {})
  };
  const response = await fetch(api + url, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const body = await response.text();
    if (response.status === 401) showLogin();
    const message = response.ok
      ? 'Máy chủ trả về trang HTML thay vì dữ liệu API. Kiểm tra cấu hình proxy và khởi động lại dịch vụ IFC_Doc.'
      : `API trả về phản hồi không hợp lệ (${response.status}). Kiểm tra cấu hình proxy và phiên bản dịch vụ IFC_Doc.`;
    throw new Error(body.startsWith('<!doctype') || body.startsWith('<html') || !body
      ? message
      : `${message} ${body.slice(0, 160)}`);
  }
  if (!response.ok) {
    const data = await response.json();
    if (response.status === 401) showLogin();
    if (data.code === 'PASSWORD_CHANGE_REQUIRED') {
      if (currentUser) currentUser.mustChangePassword = true;
      showPasswordChangeDialog(true);
    }
    throw new Error(data.error || 'Có lỗi xảy ra');
  }
  return response.status === 204 ? null : response.json();
}

async function boot() {
  try {
    const user = await request('/auth/me');
    currentUser = user;
    $('#app').classList.toggle('read-only', !hasRole('editor'));
    $('#user-name').textContent = user.username;
    $('#start-user-name').textContent = user.username;
    $('#nav-activity').classList.toggle('hidden', !user.isAdmin);
    $('#nav-users').classList.toggle('hidden', !user.isAdmin);
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    if (user.mustChangePassword) {
      showPasswordChangeDialog(true);
      return;
    }
    if ($('#password-change-dialog').open) $('#password-change-dialog').close();
    await loadFolders();
    await openFolder(null, true, false);
  } catch {
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');
  }
}

function showLogin() {
  currentUser = null;
  if ($('#password-change-dialog').open) $('#password-change-dialog').close();
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

function showPasswordChangeDialog(forced = false) {
  passwordChangeForced = forced;
  const form = $('#password-change-form');
  form.reset();
  $('#password-change-error').textContent = '';
  $('#password-change-hint').textContent = forced
    ? 'Tài khoản đang sử dụng mật khẩu mặc định. Hãy đổi mật khẩu để tiếp tục.'
    : 'Nhập mật khẩu hiện tại và mật khẩu mới (ít nhất 12 ký tự).';
  $('#password-change-cancel').classList.toggle('hidden', forced);
  if (!$('#password-change-dialog').open) $('#password-change-dialog').showModal();
  form.elements.currentPassword.focus();
}

$('#password-change-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const newPassword = form.elements.newPassword.value;
  if (newPassword !== form.elements.confirmPassword.value) {
    $('#password-change-error').textContent = 'Mật khẩu mới nhập lại không khớp';
    return;
  }
  $('#password-change-error').textContent = '';
  $('#password-change-submit').disabled = true;
  try {
    await request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: form.elements.currentPassword.value,
        newPassword
      })
    });
    if (currentUser) currentUser.mustChangePassword = false;
    $('#password-change-dialog').close();
    toast('Đã đổi mật khẩu thành công');
    if (passwordChangeForced) {
      await loadFolders();
      await openFolder(null, true, false);
    }
  } catch (error) {
    $('#password-change-error').textContent = error.message;
  } finally {
    $('#password-change-submit').disabled = false;
  }
});

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#login-error').textContent = '';
  try {
    const form = new FormData(event.currentTarget);
    await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(form))
    });
    await boot();
  } catch (error) {
    $('#login-error').textContent = error.message;
  }
});

$('#nav-home').onclick = () => openFolder(null, true);
$('#nav-all').onclick = $('#nav-drive').onclick = () => openFolder(null, false);
$('#nav-activity').onclick = openActivityLog;
$('#nav-users').onclick = openUsersDialog;
$('#new-folder').onclick = $('#new-folder-side').onclick = () => showFolderDialog();
$('#empty-create').onclick = showFolderDialog;
$('#quick-view').onclick = () => openFolder(null, false);
$('#home-upload').onclick = () => $('#upload-input').click();
$('#folder-form').addEventListener('submit', async event => {
  const form = event.currentTarget;
  if (event.submitter?.value === 'cancel') {
    event.preventDefault();
    $('#folder-dialog').close();
    return;
  }
  event.preventDefault();
  const name = new FormData(form).get('name').trim();
  if (!name) return;
  try {
    await request('/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parent: current })
    });
    form.reset();
    $('#folder-dialog').close();
    await refreshFolder();
    toast('Đã tạo thư mục');
  } catch (error) {
    toast(error.message);
  }
});

async function loadFolders() {
  folders = await request('/folders');
  renderTree();
  updateSelectionActions();
}

async function openActivityLog() {
  $('#activity-dialog').showModal();
  await loadActivityLog(true);
}

async function openUsersDialog() {
  $('#users-dialog').showModal();
  resetUserForm();
  await loadUsers();
}

async function loadUsers() {
  $('#users-refresh').disabled = true;
  try {
    userRows = await request('/admin/users');
    renderUsers();
    const departments = [...new Set(userRows.map(user => user.department).filter(Boolean))];
    const positions = [...new Set(userRows.map(user => user.position).filter(Boolean))];
    fillDatalist($('#department-options'), departments);
    fillDatalist($('#position-options'), positions);
  } catch (error) {
    $('#users-message').textContent = error.message;
  } finally {
    $('#users-refresh').disabled = false;
  }
}

function fillDatalist(list, values) {
  list.replaceChildren();
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    list.append(option);
  }
}

function renderUsers() {
  const body = $('#users-entries');
  body.replaceChildren();
  for (const user of userRows) {
    const row = document.createElement('tr');
    for (const value of [
      user.username,
      user.department || '—',
      user.position || '—',
      user.is_admin ? 'Quản trị viên · Manager' : ({ viewer: 'Viewer', editor: 'Editor', manager: 'Manager' }[user.role] || 'Viewer'),
      user.is_active ? 'Đang hoạt động' : 'Đã vô hiệu hóa'
    ]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    const actions = document.createElement('td');
    const edit = document.createElement('button');
    edit.className = 'view-all';
    edit.textContent = 'Sửa';
    edit.onclick = () => editUser(user);
    actions.append(edit);
    const reset = document.createElement('button');
    reset.className = 'view-all';
    reset.textContent = 'Reset mật khẩu';
    reset.onclick = () => resetUserPassword(user);
    actions.append(reset);
    if (!user.is_admin) {
      const toggle = document.createElement('button');
      toggle.className = 'view-all';
      toggle.textContent = user.is_active ? 'Vô hiệu hóa' : 'Kích hoạt';
      toggle.onclick = () => toggleUser(user);
      actions.append(toggle);
    }
    row.append(actions);
    body.append(row);
  }
  $('#users-message').textContent = `${userRows.length} tài khoản`;
}

function editUser(user) {
  const form = $('#user-form');
  form.elements.userId.value = user.id;
  form.elements.username.value = user.username;
  form.elements.password.value = '';
  form.elements.password.required = false;
  $('#user-password-label').classList.remove('hidden');
  $('#user-default-password').classList.add('hidden');
  form.elements.department.value = user.department || '';
  form.elements.position.value = user.position || '';
  form.elements.role.value = user.is_admin ? 'manager' : user.role;
  form.elements.role.disabled = user.is_admin;
  form.elements.isActive.checked = user.is_active;
  $('.user-active-field').classList.remove('hidden');
  $('#user-submit').textContent = 'Lưu thay đổi';
  $('#user-cancel-edit').classList.remove('hidden');
  form.elements.username.focus();
}

function resetUserForm() {
  const form = $('#user-form');
  form.reset();
  form.elements.userId.value = '';
  form.elements.password.required = false;
  $('#user-password-label').classList.add('hidden');
  $('#user-default-password').classList.remove('hidden');
  form.elements.role.disabled = false;
  $('.user-active-field').classList.add('hidden');
  $('#user-submit').textContent = 'Tạo tài khoản';
  $('#user-cancel-edit').classList.add('hidden');
}

$('#user-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const userId = form.elements.userId.value;
  const payload = {
    username: form.elements.username.value.trim(),
    department: form.elements.department.value.trim(),
    position: form.elements.position.value.trim(),
    role: form.elements.role.value
  };
  if (userId) {
    payload.isActive = form.elements.isActive.checked;
    payload.password = form.elements.password.value || undefined;
  }
  try {
    await request(userId ? `/admin/users/${userId}` : '/admin/users', {
      method: userId ? 'PATCH' : 'POST',
      body: JSON.stringify(payload)
    });
    resetUserForm();
    await loadUsers();
    toast(userId ? 'Đã cập nhật tài khoản' : 'Đã tạo tài khoản');
  } catch (error) {
    $('#users-message').textContent = error.message;
  }
});

async function resetUserPassword(user) {
  if (!window.confirm(`Đặt lại mật khẩu của “${user.username}” về 123456? Người dùng sẽ phải đổi mật khẩu ở lần đăng nhập tiếp theo.`)) return;
  try {
    await request(`/admin/users/${user.id}/reset-password`, { method: 'POST' });
    if (user.username === currentUser?.username) {
      currentUser.mustChangePassword = true;
      showPasswordChangeDialog(true);
    }
    toast(`Đã reset mật khẩu tài khoản “${user.username}” về 123456`);
  } catch (error) {
    toast(error.message);
  }
}

function toggleUser(user) {
  const action = user.is_active ? 'vô hiệu hóa' : 'kích hoạt';
  if (!window.confirm(`Bạn có chắc muốn ${action} tài khoản “${user.username}”?`)) return;
  request(`/admin/users/${user.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      username: user.username,
      department: user.department,
      position: user.position,
      isActive: !user.is_active
    })
  }).then(loadUsers).catch(error => toast(error.message));
}

async function openPermissions(item) {
  permissionEntryId = item.id;
  permissionData = null;
  $('#permissions-summary').textContent = 'Đang tải quyền truy cập…';
  $('#permission-form button[type="submit"]').disabled = true;
  $('#permission-entries').replaceChildren();
  $('#permissions-dialog').showModal();
  await loadPermissions();
}

async function loadPermissions() {
  if (!permissionEntryId) return;
  try {
    permissionData = await request(`/entries/${permissionEntryId}/permissions`);
    $('#permissions-summary').textContent = `${permissionData.entry.kind === 'folder' ? 'Thư mục' : 'Tệp'}: ${permissionData.entry.name}`;
    renderPermissionTargets();
    renderPermissions();
  } catch (error) {
    $('#permissions-summary').textContent = error.message;
  }
}

function renderPermissionTargets() {
  const type = $('#permission-form').elements.subjectType.value;
  const target = $('#permission-form').elements.target;
  const label = { user: 'Tài khoản', department: 'Phòng ban', position: 'Chức vụ' }[type];
  $('#permission-target-label').firstChild.textContent = `${label}`;
  target.replaceChildren();
  const values = type === 'user'
    ? permissionData.users.map(user => ({ value: user.id, label: user.username }))
    : (type === 'department' ? permissionData.departments : permissionData.positions).map(value => ({ value, label: value }));
  for (const item of values) {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    target.append(option);
  }
  target.disabled = values.length === 0;
  $('#permission-form button[type="submit"]').disabled = values.length === 0;
}

function renderPermissions() {
  const body = $('#permission-entries');
  body.replaceChildren();
  for (const grant of permissionData.permissions) {
    const row = document.createElement('tr');
    const target = grant.subject_type === 'user'
      ? grant.username
      : `${grant.subject_type === 'department' ? 'Phòng ban' : 'Chức vụ'}: ${grant.subject_value}`;
    const targetCell = document.createElement('td');
    targetCell.textContent = target;
    const levelCell = document.createElement('td');
    levelCell.textContent = { view: 'Xem', edit: 'Sửa', manage: 'Quản lý quyền' }[grant.permission];
    const actionCell = document.createElement('td');
    const revoke = document.createElement('button');
    revoke.className = 'view-all';
    revoke.textContent = 'Thu hồi';
    revoke.onclick = () => revokePermission(grant);
    actionCell.append(revoke);
    row.append(targetCell, levelCell, actionCell);
    body.append(row);
  }
  $('#permissions-empty').classList.toggle('hidden', permissionData.permissions.length > 0);
}

async function revokePermission(grant) {
  try {
    await request(`/entries/${permissionEntryId}/permissions/${grant.id}`, { method: 'DELETE' });
    await loadPermissions();
    await loadFolders();
    toast('Đã thu hồi quyền');
  } catch (error) {
    toast(error.message);
  }
}

$('#permission-form').elements.subjectType.onchange = renderPermissionTargets;
$('#permission-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const subjectType = form.elements.subjectType.value;
  const target = form.elements.target.value;
  const payload = { subjectType, permission: form.elements.permission.value };
  if (subjectType === 'user') payload.userId = Number(target);
  else payload.subjectValue = target;
  try {
    await request(`/entries/${permissionEntryId}/permissions`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    await loadPermissions();
    await loadFolders();
    toast('Đã cập nhật quyền truy cập');
  } catch (error) {
    toast(error.message);
  }
});

async function loadActivityLog(reset = false) {
  if (activityLoading) return;
  activityLoading = true;
  if (reset) {
    activityOffset = 0;
    activityTotal = 0;
    $('#activity-entries').replaceChildren();
    $('#activity-summary').textContent = 'Đang tải nhật ký…';
  }
  $('#activity-refresh').disabled = true;
  $('#activity-more').disabled = true;
  try {
    const data = await request(`/activity?limit=50&offset=${activityOffset}`);
    activityTotal = data.total;
    for (const item of data.items) $('#activity-entries').append(createActivityRow(item));
    activityOffset += data.items.length;
    $('#activity-summary').textContent = `Ghi lại thao tác tạo, tải lên, sao chép, đổi tên, di chuyển và xóa.`;
    $('#activity-count').textContent = `Hiển thị ${activityOffset} / ${activityTotal} hoạt động`;
    $('#activity-empty').classList.toggle('hidden', activityTotal > 0);
    $('#activity-more').classList.toggle('hidden', activityOffset >= activityTotal);
  } catch (error) {
    $('#activity-summary').textContent = `Không tải được nhật ký: ${error.message}`;
    toast(error.message);
  } finally {
    activityLoading = false;
    $('#activity-refresh').disabled = false;
    $('#activity-more').disabled = false;
  }
}

function createActivityRow(item) {
  const labels = {
    create: 'Tạo thư mục',
    upload: 'Tải lên',
    copy: 'Sao chép',
    rename: 'Đổi tên',
    move: 'Di chuyển',
    delete: 'Xóa',
    permission_grant: 'Cấp quyền',
    permission_revoke: 'Thu hồi quyền',
    user_create: 'Tạo tài khoản',
    user_update: 'Cập nhật tài khoản',
    user_password_reset: 'Đặt lại mật khẩu',
    password_change: 'Đổi mật khẩu'
  };
  const row = document.createElement('tr');
  const values = [
    new Date(item.created_at).toLocaleString('vi-VN'),
    item.actor_username,
    labels[item.action] || item.action,
    `${item.entity_name} (${item.entity_type === 'folder' ? 'Thư mục' : item.entity_type === 'user' ? 'Tài khoản' : 'Tệp'})`,
    formatActivityDetails(item.details),
    item.ip_address || '—'
  ];
  for (const value of values) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
  }
  row.cells[0].title = new Date(item.created_at).toISOString();
  row.cells[3].title = item.entity_id;
  return row;
}

function formatActivityDetails(details = {}) {
  if (details.previousName !== undefined) return `${details.previousName} → ${details.newName}`;
  if (details.sizeBytes !== undefined) return `${details.parentName || 'Thư mục gốc'} · ${formatSize(details.sizeBytes)}${details.mimeType ? ` · ${details.mimeType}` : ''}`;
  if (details.passwordReset) return 'Đã đặt lại về mật khẩu mặc định; yêu cầu đổi khi đăng nhập';
  if (details.initialPassword) return 'Mật khẩu mặc định; yêu cầu đổi ở lần đăng nhập đầu tiên';
  if (details.passwordChanged) return 'Đã đổi mật khẩu';
  if (details.sourceName) return `Từ “${details.sourceName}” đến ${details.destinationParentName || 'thư mục gốc'}`;
  if (details.previousParentName !== undefined) return `${details.previousParentName || 'Thư mục gốc'} → ${details.destinationParentName || 'Thư mục gốc'}`;
  if (details.parentName !== undefined) return `Thư mục cha: ${details.parentName || 'Thư mục gốc'}`;
  if (details.subjectName) {
    const level = { view: 'Xem', edit: 'Sửa', manage: 'Quản lý quyền' }[details.permission] || details.permission;
    return `${details.subjectName} · ${level || ''}`.trim();
  }
  if (details.userId !== undefined) {
    const values = [];
    if (details.previousUsername && details.username && details.previousUsername !== details.username) {
      values.push(`${details.previousUsername} → ${details.username}`);
    }
    values.push(details.department || 'Không có phòng ban', details.position || 'Không có chức vụ');
    if (details.role) values.push(`Role: ${details.role}`);
    if (details.previousRole && details.previousRole !== details.role) values.push(`Role cũ: ${details.previousRole}`);
    if (details.isActive !== undefined) values.push(details.isActive ? 'Đang hoạt động' : 'Đã vô hiệu hóa');
    if (details.passwordChanged) values.push('Đã đổi mật khẩu');
    return values.join(' · ');
  }
  return '—';
}

function renderTree() {
  const host = $('#folder-tree');
  host.replaceChildren();
  for (const folder of folders) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'tree-node' + (folder.id === current ? ' active' : '');
    node.style.paddingLeft = `${16 + depth(folder.id) * 12}px`;
    node.innerHTML = `<span aria-hidden="true">${folder.is_personal ? '🔒' : '📁'}</span><span></span>`;
    node.lastChild.textContent = folder.name;
    node.onclick = () => openFolder(folder.id);
    node.oncontextmenu = event => {
      event.preventDefault();
      event.stopPropagation();
      showContextMenu(event.clientX, event.clientY, { ...folder, kind: 'folder' });
    };
    host.append(node);
  }
}

function depth(id) {
  let count = 0;
  let folder = folders.find(item => item.id === id);
  while (folder?.parent_id && count < 10) {
    count++;
    folder = folders.find(item => item.id === folder.parent_id);
  }
  return count;
}

async function openFolder(id, showHome = false, addHistory = true) {
  current = id;
  $('#app').classList.toggle('read-only', !hasRole('editor') && !isPersonalFolder(id));
  homeMode = showHome && !id;
  searchResults = null;
  $('#search').value = '';
  selectedIds.clear();
  selectionAnchor = null;
  const query = id ? `?parent=${encodeURIComponent(id)}` : '';
  entries = homeMode ? await request('/recent') : await request(`/entries${query}`);
  $('#folder-title').textContent = id
    ? folders.find(folder => folder.id === id)?.name || 'Thư mục'
    : homeMode ? 'Trang chủ' : 'IFC_Doc (C:)';
  $('#files-heading').textContent = homeMode ? 'Tệp gần đây' : 'Tệp';
  $('#home-recommended').classList.toggle('hidden', !homeMode);
  $('#nav-home').classList.toggle('active', homeMode);
  $('#nav-all').classList.toggle('active', !homeMode && !id);
  $('#nav-drive').classList.toggle('active', !homeMode && !id);
  $('#item-count').textContent = `${entries.length} mục`;
  renderTree();
  renderQuickFolders();
  renderCrumbs();
  renderEntries();
  updatePasteButton();
  updateSelectionActions();
  if (addHistory) {
    history = history.slice(0, historyIndex + 1);
    history.push({ id, home: homeMode });
    historyIndex = history.length - 1;
  }
}

async function refreshFolder() {
  await loadFolders();
  await openFolder(current, homeMode, false);
}

function renderCrumbs() {
  const chain = [];
  let folder = folders.find(item => item.id === current);
  while (folder) {
    chain.unshift(folder);
    folder = folders.find(item => item.id === folder.parent_id);
  }
  const host = $('#breadcrumbs');
  host.replaceChildren();
  const root = document.createElement('button');
  root.textContent = homeMode ? 'Trang chủ' : 'IFC_Doc (C:)';
  root.onclick = () => openFolder(null, homeMode);
  host.append(root);
  for (const item of chain) {
    host.append(' / ');
    const button = document.createElement('button');
    button.textContent = item.name;
    button.onclick = () => openFolder(item.id, false);
    host.append(button);
  }
}

function renderQuickFolders() {
  const host = $('#quick-folders');
  host.replaceChildren();
  const rootFolders = folders.filter(folder => !folder.parent_id);
  const personal = rootFolders.find(folder => folder.is_personal);
  const roots = [...(personal ? [personal] : []), ...rootFolders.filter(folder => !folder.is_personal)].slice(0, 6);
  if (!roots.length) {
    const hint = document.createElement('span');
    hint.className = 'quick-empty';
    hint.textContent = 'Các thư mục thường dùng sẽ xuất hiện ở đây';
    host.append(hint);
    return;
  }
  for (const folder of roots) {
    const button = document.createElement('button');
    button.className = 'quick-folder';
    button.innerHTML = '<span class="quick-art" aria-hidden="true">📁</span><span class="quick-name"></span><span class="quick-meta">Thư mục</span>';
    button.querySelector('.quick-name').textContent = folder.name;
    button.onclick = () => openFolder(folder.id);
    host.append(button);
  }
}

function renderEntries() {
  const query = $('#search').value.trim().toLocaleLowerCase('vi');
  const rows = searchResults || entries.filter(item => item.name.toLocaleLowerCase('vi').includes(query));
  const sort = homeMode && !searchResults ? 'date' : $('#sort').value;
  rows.sort((a, b) => sort === 'date'
    ? new Date(b.updated_at) - new Date(a.updated_at)
    : sort === 'size'
      ? Number(b.size_bytes) - Number(a.size_bytes)
      : a.name.localeCompare(b.name, 'vi'));
  const visibleIds = new Set(rows.map(item => item.id));
  for (const id of selectedIds) {
    if (!visibleIds.has(id)) selectedIds.delete(id);
  }
  if (!selectedIds.has(selectionAnchor)) selectionAnchor = null;

  const body = $('#entries');
  body.replaceChildren();
  for (const item of rows) {
    const row = document.createElement('tr');
    row.dataset.id = item.id;
    row.tabIndex = 0;
    row.setAttribute('aria-selected', String(selectedIds.has(item.id)));
    row.classList.toggle('selected', selectedIds.has(item.id));
    row.innerHTML = `<td><div class="entry-name"><span class="file-icon ${item.kind}" aria-hidden="true">${item.kind === 'folder' ? '📁' : '▤'}</span><span class="entry-label"><span class="entry-label-name"></span><small class="entry-location"></small></span></div></td><td>${new Date(item.updated_at).toLocaleDateString('vi-VN')}</td><td>${item.kind === 'folder' ? 'Thư mục' : (item.name.split('.').pop() || 'Tệp').toUpperCase()}</td><td>${item.kind === 'folder' ? '—' : formatSize(item.size_bytes)}</td><td class="row-menu"><button class="menu-btn" aria-label="Mở menu thao tác">⋯</button></td>`;
    row.querySelector('.entry-label-name').textContent = item.name;
    row.querySelector('.entry-location').textContent = (searchResults || homeMode) ? item.full_path || '' : '';
    row.title = (searchResults || homeMode) ? item.full_path || item.name : item.name;
    row.onclick = event => {
      selectEntry(item, event);
      if (window.matchMedia('(max-width: 620px)').matches) openEntry(item);
    };
    row.ondblclick = () => {
      if (!window.matchMedia('(max-width: 620px)').matches) openEntry(item);
    };
    row.onkeydown = event => {
      if (event.key === 'Enter') openEntry(item);
      if (event.key === ' ') {
        event.preventDefault();
        selectEntry(item);
      }
    };
    row.oncontextmenu = event => {
      event.preventDefault();
      if (!selectedIds.has(item.id)) selectEntry(item);
      renderEntries();
      updateSelectionActions();
      showContextMenu(event.clientX, event.clientY, item);
    };
    row.querySelector('.menu-btn').onclick = event => {
      event.stopPropagation();
      const bounds = event.currentTarget.getBoundingClientRect();
      selectEntry(item);
      renderEntries();
      updateSelectionActions();
      showContextMenu(bounds.right, bounds.bottom, item);
    };
    body.append(row);
  }
  $('#empty').classList.toggle('hidden', rows.length > 0);
  $('#item-count').textContent = `${rows.length} mục`;
  $('#status-count').textContent = `${rows.length} mục`;
  updateSelectionSummary();
  updateSelectionActions();
  $('#empty').querySelector('b').textContent = query ? 'Không tìm thấy mục phù hợp' : 'Thư mục này đang trống';
  $('#empty').querySelector('span').textContent = query ? 'Thử từ khóa khác để tìm trong IFC_Doc.' : 'Tải tệp lên hoặc tạo thư mục mới để bắt đầu.';
}

function selectEntry(item, event = {}) {
  const visible = [...$('#entries').rows].map(row => row.dataset.id);
  if (event.shiftKey && selectionAnchor) {
    const start = visible.indexOf(selectionAnchor);
    const end = visible.indexOf(item.id);
    if (start !== -1 && end !== -1) {
      if (!event.ctrlKey && !event.metaKey) selectedIds.clear();
      for (const id of visible.slice(Math.min(start, end), Math.max(start, end) + 1)) selectedIds.add(id);
    }
  } else if (event.ctrlKey || event.metaKey) {
    if (selectedIds.has(item.id)) selectedIds.delete(item.id);
    else selectedIds.add(item.id);
    selectionAnchor = item.id;
  } else {
    selectedIds.clear();
    selectedIds.add(item.id);
    selectionAnchor = item.id;
  }
  updateRenderedSelection();
  updateSelectionSummary();
  updateSelectionActions();
  updateDetails(getSelectedEntries().length === 1 ? item : null);
}

function updateRenderedSelection() {
  for (const row of $('#entries').rows) {
    const active = selectedIds.has(row.dataset.id);
    row.setAttribute('aria-selected', String(active));
    row.classList.toggle('selected', active);
  }
}

function updateSelectionSummary() {
  const count = selectedIds.size;
  const label = count ? `${count} mục đã chọn` : '';
  $('#status-selection').textContent = label;
  $('#selection-label').textContent = label;
}

const tableWrap = $('.table-wrap');
const selectionMarquee = document.createElement('div');
selectionMarquee.className = 'selection-marquee';
selectionMarquee.hidden = true;
tableWrap.append(selectionMarquee);
tableWrap.addEventListener('mousedown', event => {
  if (event.button !== 0 || event.target.closest('tr, button, input, select, a')) return;
  event.preventDefault();
  const preserve = event.ctrlKey || event.metaKey;
  dragSelection = {
    startX: event.clientX,
    startY: event.clientY,
    initial: preserve ? new Set(selectedIds) : new Set(),
    moved: false
  };
  document.body.classList.add('selecting-entries');
  if (!preserve) {
    selectedIds.clear();
    selectionAnchor = null;
    updateRenderedSelection();
    updateSelectionSummary();
    updateSelectionActions();
    updateDetails(null);
  }
});
document.addEventListener('mousemove', event => {
  if (!dragSelection) return;
  const left = Math.min(dragSelection.startX, event.clientX);
  const top = Math.min(dragSelection.startY, event.clientY);
  const width = Math.abs(event.clientX - dragSelection.startX);
  const height = Math.abs(event.clientY - dragSelection.startY);
  if (width + height < 4) return;
  dragSelection.moved = true;
  const bounds = tableWrap.getBoundingClientRect();
  selectionMarquee.hidden = false;
  selectionMarquee.style.left = `${left - bounds.left + tableWrap.scrollLeft}px`;
  selectionMarquee.style.top = `${top - bounds.top + tableWrap.scrollTop}px`;
  selectionMarquee.style.width = `${width}px`;
  selectionMarquee.style.height = `${height}px`;
  const selectionBounds = { left, top, right: left + width, bottom: top + height };
  selectedIds.clear();
  for (const id of dragSelection.initial) selectedIds.add(id);
  for (const row of $('#entries').rows) {
    const rowBounds = row.getBoundingClientRect();
    if (rowBounds.left < selectionBounds.right && rowBounds.right > selectionBounds.left
      && rowBounds.top < selectionBounds.bottom && rowBounds.bottom > selectionBounds.top) {
      selectedIds.add(row.dataset.id);
    }
  }
  updateRenderedSelection();
  updateSelectionSummary();
  updateSelectionActions();
  updateDetails(null);
});
document.addEventListener('mouseup', () => {
  if (!dragSelection) return;
  selectionMarquee.hidden = true;
  document.body.classList.remove('selecting-entries');
  if (dragSelection.moved) selectionAnchor = Array.from(selectedIds).pop() || null;
  dragSelection = null;
});
window.addEventListener('blur', () => {
  if (!dragSelection) return;
  selectionMarquee.hidden = true;
  document.body.classList.remove('selecting-entries');
  dragSelection = null;
});

function openEntry(item) {
  if (item.kind === 'folder') openFolder(item.id);
  else if (isPreviewable(item.name)) {
    if (window.matchMedia('(max-width: 620px)').matches) openMobilePreview(item);
    else openPreview(item);
  }
  else window.location.href = `${api}/entries/${item.id}/download`;
}

function openMobilePreview(item) {
  const url = `${api}/entries/${item.id}/preview`;
  const previewWindow = window.open('about:blank', '_blank');
  if (!previewWindow) {
    window.location.href = url;
    return;
  }
  previewWindow.opener = null;
  previewWindow.location.replace(url);
}

function isPreviewable(name) {
  return /\.(pdf|docx?|odt|rtf|xlsx?|ods|pptx?|odp)$/i.test(name);
}

async function openPreview(item) {
  previewController?.abort();
  previewController = new AbortController();
  $('#preview-title').textContent = item.name;
  $('#preview-download').onclick = () => {
    window.location.href = `${api}/entries/${item.id}/download`;
  };
  $('#preview-frame').hidden = true;
  $('#preview-frame').removeAttribute('src');
  $('#preview-loading').classList.remove('hidden');
  $('#preview-loading').textContent = 'Đang mở tài liệu…';
  $('#preview-dialog').showModal();
  try {
    const response = await fetch(`${api}/entries/${item.id}/preview`, {
      signal: previewController.signal
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Không thể xem trước tài liệu này');
    }
    const blob = await response.blob();
    if (previewController.signal.aborted) return;
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(blob);
    const frame = $('#preview-frame');
    frame.onload = () => {
      $('#preview-loading').classList.add('hidden');
      frame.hidden = false;
    };
    frame.src = previewObjectUrl;
  } catch (error) {
    if (error.name === 'AbortError') return;
    $('#preview-loading').textContent = error.message;
  }
}

function closePreview() {
  previewController?.abort();
  previewController = null;
  $('#preview-frame').removeAttribute('src');
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = null;
  $('#preview-dialog').close();
}

$('#preview-close').onclick = closePreview;
$('#preview-dialog').addEventListener('close', () => {
  if (previewController || previewObjectUrl) closePreview();
});
$('#preview-dialog').addEventListener('click', event => {
  if (event.target === $('#preview-dialog')) closePreview();
});

$('#activity-close').onclick = () => $('#activity-dialog').close();
$('#activity-refresh').onclick = () => loadActivityLog(true);
$('#activity-more').onclick = () => loadActivityLog();
$('#activity-dialog').addEventListener('click', event => {
  if (event.target === $('#activity-dialog')) $('#activity-dialog').close();
});
$('#users-close').onclick = () => $('#users-dialog').close();
$('#users-refresh').onclick = loadUsers;
$('#user-cancel-edit').onclick = resetUserForm;
$('#start-change-password').onclick = () => {
  $('#start-menu').classList.add('hidden');
  showPasswordChangeDialog();
};
$('#password-change-cancel').onclick = () => $('#password-change-dialog').close();
$('#password-change-dialog').addEventListener('cancel', event => {
  if (passwordChangeForced) event.preventDefault();
});
$('#users-dialog').addEventListener('click', event => {
  if (event.target === $('#users-dialog')) $('#users-dialog').close();
});
$('#users-dialog').addEventListener('close', () => {
  resetUserForm();
  $('#users-message').textContent = '';
});
$('#permissions-close').onclick = () => $('#permissions-dialog').close();
$('#permissions-dialog').addEventListener('click', event => {
  if (event.target === $('#permissions-dialog')) $('#permissions-dialog').close();
});
$('#permissions-dialog').addEventListener('close', () => {
  permissionEntryId = null;
  permissionData = null;
});

function showFolderDialog() {
  $('#folder-form').reset();
  $('#folder-dialog').showModal();
  $('#folder-form input[name="name"]').focus();
}

function showRenameDialog(item) {
  const dialog = $('#rename-dialog');
  const form = $('#rename-form');
  form.elements.name.value = item.name;
  dialog.showModal();
  form.elements.name.focus();
  form.elements.name.select();
  form.onsubmit = async event => {
    if (event.submitter?.value === 'cancel') {
      event.preventDefault();
      dialog.close();
      return;
    }
    event.preventDefault();
    const name = form.elements.name.value.trim();
    if (!name) return;
    try {
      await request(`/entries/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name })
      });
      dialog.close();
      await refreshFolder();
      toast('Đã đổi tên');
    } catch (error) {
      toast(error.message);
    }
  };
}

async function deleteEntry(items = getSelectedEntries()) {
  items = getTopLevelEntries(items);
  if (!items.length) return;
  const noun = items.length === 1
    ? (items[0].kind === 'folder' ? 'thư mục và toàn bộ nội dung bên trong' : 'tệp')
    : `${items.length} mục`;
  if (!window.confirm(`Xóa ${noun}? Thao tác này không thể hoàn tác.`)) return;
  let parentAfterDelete = null;
  let deletedCurrentFolder = false;
  let folder = folders.find(entry => entry.id === current);
  while (folder && items.some(item => item.id === folder.id)) {
    parentAfterDelete = folder.parent_id || null;
    deletedCurrentFolder = true;
    folder = folders.find(entry => entry.id === folder.parent_id);
  }
  let deleted = 0;
  try {
    for (const item of items) {
      await request(`/entries/${item.id}`, { method: 'DELETE' });
      deleted++;
      if (clipboard) {
        clipboard.items = clipboard.items.filter(entry => entry.id !== item.id);
        if (!clipboard.items.length) clipboard = null;
      }
    }
    if (deletedCurrentFolder) current = parentAfterDelete;
    selectedIds.clear();
    selectionAnchor = null;
    await refreshFolder();
    toast(`Đã xóa ${deleted} mục`);
  } catch (error) {
    selectedIds.clear();
    await refreshFolder();
    toast(deleted ? `Đã xóa ${deleted} mục; lỗi: ${error.message}` : error.message);
  }
}

function setClipboard(items, operation) {
  if (!Array.isArray(items)) items = [items];
  items = getTopLevelEntries(items);
  clipboard = { items: items.map(({ id, name, kind }) => ({ id, name, kind })), operation };
  renderEntries();
  updatePasteButton();
  updateSelectionActions();
  toast(`${operation === 'cut' ? 'Đã cắt' : 'Đã sao chép'} ${items.length} mục`);
}

function getTopLevelEntries(items) {
  const selected = new Set(items.map(item => item.id));
  return items.filter(item => {
    let parent = folders.find(folder => folder.id === item.parent_id);
    while (parent) {
      if (selected.has(parent.id)) return false;
      parent = folders.find(folder => folder.id === parent.parent_id);
    }
    return true;
  });
}

async function pasteEntry(destination = current) {
  if (!clipboard?.items.length) return;
  const isDescendantOf = (folderId, descendantId) => {
    let folder = folders.find(entry => entry.id === descendantId);
    while (folder) {
      if (folder.id === folderId) return true;
      folder = folders.find(entry => entry.id === folder.parent_id);
    }
    return false;
  };
  if (clipboard.operation === 'cut' && clipboard.items.some(item =>
    item.kind === 'folder' && destination && isDescendantOf(item.id, destination)
  )) {
    toast('Không thể chuyển thư mục vào bên trong chính nó');
    return;
  }
  let pasted = 0;
  try {
    for (const item of [...clipboard.items]) {
      if (clipboard.operation === 'copy') {
        await request(`/entries/${item.id}/copy`, {
          method: 'POST',
          body: JSON.stringify({ parent: destination })
        });
      } else {
        await request(`/entries/${item.id}/move`, {
          method: 'PATCH',
          body: JSON.stringify({ parent: destination })
        });
        clipboard.items = clipboard.items.filter(entry => entry.id !== item.id);
      }
      pasted++;
    }
    await refreshFolder();
    if (clipboard.operation === 'cut' && !clipboard.items.length) clipboard = null;
    updatePasteButton();
    toast(`Đã dán ${pasted} mục`);
  } catch (error) {
    await refreshFolder();
    updatePasteButton();
    toast(pasted ? `Đã dán ${pasted} mục; lỗi: ${error.message}` : error.message);
  }
}

function updatePasteButton() {
  const button = $('#paste-button');
  button.disabled = !clipboard?.items.length || !canEditDestination(current);
  button.title = clipboard?.items.length
    ? `Dán ${clipboard.items.length} mục đã ${clipboard.operation === 'cut' ? 'cắt' : 'sao chép'}`
    : 'Chưa có mục để dán';
}

function updateSelectionActions() {
  const count = selectedIds.size;
  const selected = getSelectedEntries();
  const canEditAll = selected.length === count && selected.every(canEditEntry);
  const canCopyAll = selected.length === count && selected.every(canCopyEntry);
  const canDeleteAll = selected.length === count && selected.every(canDeleteEntry);
  $('#copy-button').disabled = count === 0 || !canCopyAll;
  $('#cut-button').disabled = count === 0 || !canEditAll;
  $('#delete-button').disabled = count === 0 || !canDeleteAll;
  $('#rename-button').disabled = count !== 1 || !canEditAll;
  const canEditCurrent = canEditDestination(current);
  for (const selector of ['#new-folder', '#new-folder-side', '#empty-create', '#home-upload']) {
    $(selector).disabled = !canEditCurrent;
  }
  $('#upload-input').disabled = !canEditCurrent;
}

function canEditDestination(folderId) {
  if (currentUser?.isAdmin) return true;
  const folder = folders.find(item => item.id === folderId);
  return Boolean(folder && (hasRole('editor') || isPersonalFolder(folderId))
    && ['edit', 'manage'].includes(folder.access_level));
}

function getSelectedEntries() {
  return (searchResults || entries).filter(entry => selectedIds.has(entry.id));
}

function getSelectedEntry() {
  return getSelectedEntries()[0] || null;
}

function updateDetails(item) {
  if ($('#details-pane').classList.contains('hidden')) return;
  $('#details-name').textContent = item?.name || 'Chọn tệp để xem chi tiết';
  $('#details-meta').textContent = item
    ? `${item.kind === 'folder' ? 'Thư mục' : formatSize(item.size_bytes)}${item.full_path ? ` · ${item.full_path}` : ''}`
    : 'Thông tin mục sẽ hiển thị tại đây';
}

function showContextMenu(x, y, item = null) {
  const menu = $('#context-menu');
  menu.replaceChildren();
  const selectedItems = getSelectedEntries();
  const contextItems = item && !selectedItems.some(entry => entry.id === item.id)
    ? [item]
    : selectedItems;
  const multiple = contextItems.length > 1;
  const destination = item
    ? item.kind === 'folder' ? item.id : item.parent_id
    : current;
  const addAction = (label, action, options = {}) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'context-action' + (options.danger ? ' danger' : '');
    button.disabled = Boolean(options.disabled);
    button.innerHTML = `<span class="context-icon" aria-hidden="true">${options.icon || ''}</span><span></span><kbd></kbd>`;
    button.querySelector('span:nth-child(2)').textContent = label;
    button.querySelector('kbd').textContent = options.shortcut || '';
    button.onclick = () => {
      closeContextMenu();
      action();
    };
    menu.append(button);
  };

  if (item) {
    if (!multiple) addAction('Mở', () => openEntry(item), { icon: '↵' });
    if (contextItems.every(canEditEntry)) {
      addAction('Cắt', () => setClipboard(contextItems, 'cut'), { icon: '✂', shortcut: 'Ctrl+X' });
      if (!multiple) addAction('Đổi tên', () => showRenameDialog(item), { icon: '✎', shortcut: 'F2' });
    }
    if (contextItems.every(canCopyEntry)) {
      addAction('Sao chép', () => setClipboard(contextItems, 'copy'), { icon: '▢', shortcut: 'Ctrl+C' });
    }
    if (clipboard?.items.length && canEditDestination(destination)) {
      addAction('Dán', () => pasteEntry(destination), { icon: '▣', shortcut: 'Ctrl+V' });
    }
    if (!multiple && (item.access_level === 'manage' || currentUser?.isAdmin)) {
      addAction('Quyền truy cập', () => openPermissions(item), { icon: '♙' });
    }
    if (!multiple && item.kind === 'file') {
      addAction('Tải xuống', () => openEntry(item), { icon: '↓' });
    }
    if (contextItems.every(canDeleteEntry)) {
      addAction('Xóa', () => deleteEntry(contextItems), { icon: '⌫', shortcut: 'Del', danger: true });
    }
  } else if (hasRole('editor') || isPersonalFolder(current)) {
    if (clipboard?.items.length && canEditDestination(current)) {
      addAction('Dán', () => pasteEntry(current), { icon: '▣', shortcut: 'Ctrl+V' });
    }
    addAction('Thư mục mới', showFolderDialog, { icon: '📁', disabled: !canEditDestination(current) });
    addAction('Tải lên', () => $('#upload-input').click(), { icon: '↑', disabled: !canEditDestination(current) });
  }
  menu.hidden = false;
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - bounds.height - 8))}px`;
}

function closeContextMenu() {
  $('#context-menu').hidden = true;
}

document.addEventListener('click', event => {
  if (!event.target.closest('#context-menu')) closeContextMenu();
});
document.addEventListener('keydown', event => {
  const typing = event.target.matches('input, textarea, select, [contenteditable="true"]');
  if (event.key === 'Escape') closeContextMenu();
  if (typing || event.altKey) return;
  const items = getSelectedEntries();
  const item = items.length === 1 ? items[0] : null;
  const selectedCanEdit = items.length > 0 && items.every(canEditEntry);
  const selectedCanCopy = items.length > 0 && items.every(canCopyEntry);
  const selectedCanDelete = items.length > 0 && items.every(canDeleteEntry);
  const shortcut = event.key.toLowerCase();
  if ((event.key === 'F2' && !selectedCanEdit)
    || ((event.ctrlKey || event.metaKey) && shortcut === 'x' && !selectedCanEdit)
    || ((event.ctrlKey || event.metaKey) && shortcut === 'c' && !selectedCanCopy)
    || ((event.ctrlKey || event.metaKey) && shortcut === 'v' && !canEditDestination(current))
    || (event.key === 'Delete' && !selectedCanDelete)) {
    event.preventDefault();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    const visibleEntries = searchResults || entries;
    for (const entry of visibleEntries) selectedIds.add(entry.id);
    selectionAnchor = visibleEntries.at(-1)?.id || null;
    updateRenderedSelection();
    updateSelectionSummary();
    updateSelectionActions();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && items.length) {
    event.preventDefault();
    setClipboard(items, 'copy');
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x' && items.length) {
    event.preventDefault();
    setClipboard(items, 'cut');
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && clipboard?.items.length) {
    event.preventDefault();
    pasteEntry();
  } else if (event.key === 'F2' && item) {
    event.preventDefault();
    showRenameDialog(item);
  } else if (event.key === 'Delete' && items.length) {
    event.preventDefault();
    deleteEntry(items);
  } else if (event.key === 'F2' && !item) {
    event.preventDefault();
    showFolderDialog();
  }
});

$('#main-content').oncontextmenu = event => {
  if (event.target.closest('tr, button, input, select, a, .actions')) return;
  event.preventDefault();
  selectedIds.clear();
  selectionAnchor = null;
  renderEntries();
  updateSelectionActions();
  updateDetails(null);
  showContextMenu(event.clientX, event.clientY);
};

$('#upload-input').onchange = async event => {
  if (!event.target.files.length) return;
  const form = new FormData();
  for (const file of event.target.files) form.append('files', file);
  if (current) form.append('parent', current);
  try {
    await request('/upload', { method: 'POST', body: form });
    await openFolder(current, homeMode);
    toast('Tải lên thành công');
  } catch (error) {
    toast(error.message);
  }
  event.target.value = '';
};

$('#search').oninput = () => {
  clearTimeout(searchTimer);
  const query = $('#search').value.trim();
  if (!query) {
    searchResults = null;
    $('#folder-title').textContent = current
      ? folders.find(folder => folder.id === current)?.name || 'Thư mục'
      : homeMode ? 'Trang chủ' : 'IFC_Doc (C:)';
    $('#files-heading').textContent = homeMode ? 'Tệp gần đây' : 'Tệp';
    $('#home-recommended').classList.toggle('hidden', !homeMode);
    renderCrumbs();
    renderEntries();
    return;
  }
  $('#folder-title').textContent = 'Kết quả tìm kiếm';
  $('#home-recommended').classList.add('hidden');
  $('#files-heading').textContent = `Kết quả cho “${query}”`;
  searchTimer = setTimeout(async () => {
    try {
      searchResults = await request(`/search?q=${encodeURIComponent(query)}`);
      renderEntries();
    } catch (error) {
      toast(error.message);
    }
  }, 180);
};
$('#sort').onchange = renderEntries;
$('#view-toggle').onclick = () => {
  grid = !grid;
  $('.table-wrap').classList.toggle('grid-view', grid);
  $('#view-toggle').setAttribute('aria-pressed', String(grid));
  $('#view-toggle-secondary').textContent = grid ? '☷' : '▦';
};
$('#view-toggle-secondary').onclick = () => $('#view-toggle').click();
$('#paste-button').onclick = pasteEntry;
$('#copy-button').onclick = () => {
  const items = getSelectedEntries();
  if (items.length) setClipboard(items, 'copy');
};
$('#cut-button').onclick = () => {
  const items = getSelectedEntries();
  if (items.length) setClipboard(items, 'cut');
};
$('#rename-button').onclick = () => {
  const item = getSelectedEntry();
  if (item) showRenameDialog(item);
};
$('#delete-button').onclick = () => {
  const items = getSelectedEntries();
  if (items.length) deleteEntry(items);
};
$('#details-toggle').onclick = () => {
  const pane = $('#details-pane');
  pane.classList.toggle('hidden');
  updateDetails(getSelectedEntry());
};
$('#details-close').onclick = () => $('#details-pane').classList.add('hidden');
$('#refresh-button').onclick = () => refreshFolder();
$('#up-button').onclick = () => {
  const folder = folders.find(item => item.id === current);
  openFolder(folder?.parent_id || null, !folder?.parent_id);
};
$('#back-button').onclick = () => {
  if (historyIndex <= 0) return;
  historyIndex--;
  const target = history[historyIndex];
  openFolder(target.id, target.home, false);
};
$('#forward-button').onclick = () => {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  const target = history[historyIndex];
  openFolder(target.id, target.home, false);
};
$('#new-tab').onclick = () => openFolder(null, true);

function showExplorer() {
  $('#explorer-window').classList.remove('hidden');
  $('#explorer-window').classList.remove('minimized');
  $('#task-explorer').classList.add('active');
}

function toggleStartMenu() {
  $('#start-menu').classList.toggle('hidden');
}

$('#window-minimize').onclick = () => {
  $('#explorer-window').classList.add('hidden');
  $('#task-explorer').classList.remove('active');
};
$('#window-close').onclick = () => {
  $('#explorer-window').classList.add('hidden');
  $('#task-explorer').classList.remove('active');
};
$('#window-maximize').onclick = () => {
  const window = $('#explorer-window');
  window.classList.toggle('maximized');
  $('#window-maximize').textContent = window.classList.contains('maximized') ? '❐' : '□';
};
$('#task-explorer').onclick = () => {
  if ($('#explorer-window').classList.contains('hidden')) showExplorer();
  else {
    $('#explorer-window').classList.toggle('hidden');
    $('#task-explorer').classList.toggle('active');
  }
  $('#start-menu').classList.add('hidden');
};
$('#task-vault').onclick = () => showExplorer();
$('#desktop-pc').ondblclick = $('#desktop-vault').ondblclick = () => showExplorer();
$('#desktop-solutions').ondblclick = () => openCatalog('solutions');
$('#desktop-devices').ondblclick = () => openCatalog('devices');
$('#start-explorer').onclick = $('#start-vault').onclick = () => {
  showExplorer();
  $('#start-menu').classList.add('hidden');
};
$('#task-start').onclick = toggleStartMenu;
$('#start-search').oninput = () => {
  $('#search').value = $('#start-search').value;
  $('#search').dispatchEvent(new Event('input'));
  showExplorer();
};
$('#task-search').onclick = () => {
  showExplorer();
  $('#search').focus();
};
$('#all-apps').onclick = () => {
  showExplorer();
  $('#start-menu').classList.add('hidden');
};
$('#logout').onclick = async () => {
  try {
    await request('/auth/logout', { method: 'POST' });
    $('#start-menu').classList.add('hidden');
    showLogin();
  } catch (error) {
    toast(error.message);
  }
};
$('#start-logout').onclick = $('#logout').onclick;
document.addEventListener('click', event => {
  if (!event.target.closest('#start-menu, #task-start')) $('#start-menu').classList.add('hidden');
});

const titlebar = $('#window-titlebar');
titlebar.addEventListener('pointerdown', event => {
  if (event.target.closest('button') || $('#explorer-window').classList.contains('maximized')) return;
  const window = $('#explorer-window');
  const bounds = window.getBoundingClientRect();
  const offsetX = event.clientX - bounds.left;
  const offsetY = event.clientY - bounds.top;
  titlebar.setPointerCapture(event.pointerId);
  const move = moveEvent => {
    window.style.left = `${Math.max(0, Math.min(innerWidth - 180, moveEvent.clientX - offsetX))}px`;
    window.style.top = `${Math.max(0, Math.min(innerHeight - 100, moveEvent.clientY - offsetY))}px`;
    window.style.transform = 'none';
  };
  const stop = () => {
    titlebar.removeEventListener('pointermove', move);
    titlebar.removeEventListener('pointerup', stop);
    titlebar.removeEventListener('pointercancel', stop);
  };
  titlebar.addEventListener('pointermove', move);
  titlebar.addEventListener('pointerup', stop, { once: true });
  titlebar.addEventListener('pointercancel', stop, { once: true });
});

function formatSize(bytes) {
  let size = Number(bytes);
  if (!size) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
}

const catalogLabels = {
  solutions: {
    title: 'Tra cứu Giải pháp',
    singular: 'Giải pháp',
    icon: '◇',
    categories: { technical: 'Tài liệu kỹ thuật', presentation: 'Slide trình bày' }
  },
  devices: {
    title: 'Tra cứu Thiết bị',
    singular: 'Thiết bị',
    icon: '▣',
    categories: {
      design: 'Tài liệu thiết kế',
      legal_test: 'Pháp lý / đo kiểm',
      catalog: 'Catalog thiết bị'
    }
  }
};

function setCatalogMode(enabled) {
  const normalContent = [
    '.content-heading', '#home-recommended', '.files-section',
    '#details-pane', '.status-bar'
  ];
  for (const selector of normalContent) $(selector).classList.toggle('hidden', enabled);
  $('#catalog-view').classList.toggle('hidden', !enabled);
  $('#command-bar').classList.toggle('hidden', enabled);
  $('#explorer-navigation').classList.toggle('hidden', enabled);
  if (!enabled) {
    $('#nav-solutions').classList.remove('active');
    $('#nav-devices').classList.remove('active');
  }
}

async function openCatalog(kind) {
  catalogKind = kind;
  catalogDetail = null;
  catalogListRequest++;
  catalogDetailRequest++;
  $('#catalog-search').value = '';
  $('#catalog-title').textContent = catalogLabels[kind].title;
  $('#catalog-add').classList.toggle('hidden', !hasRole('editor'));
  $('#nav-solutions').classList.toggle('active', kind === 'solutions');
  $('#nav-devices').classList.toggle('active', kind === 'devices');
  $('#nav-home').classList.remove('active');
  $('#nav-all').classList.remove('active');
  $('#nav-drive').classList.remove('active');
  setCatalogMode(true);
  showExplorer();
  await loadCatalogItems();
}

function leaveCatalog() {
  if (!catalogKind) return;
  catalogKind = null;
  catalogDetail = null;
  catalogListRequest++;
  catalogDetailRequest++;
  setCatalogMode(false);
}

async function loadCatalogItems(query = '') {
  if (!catalogKind) return;
  const kind = catalogKind;
  const requestId = ++catalogListRequest;
  try {
    catalogItems = await request(`/catalog/${kind}?q=${encodeURIComponent(query)}`);
    if (catalogKind === kind && requestId === catalogListRequest && !catalogDetail) renderCatalogItems();
  } catch (error) {
    if (catalogKind === kind && requestId === catalogListRequest) {
      toast(error.message);
      $('#catalog-count').textContent = `Không tải được danh mục: ${error.message}`;
    }
  }
}

function renderCatalogItems() {
  if (!catalogKind) return;
  const host = $('#catalog-items');
  host.replaceChildren();
  $('#catalog-detail').classList.add('hidden');
  host.classList.remove('hidden');
  const label = catalogLabels[catalogKind];
  $('#catalog-count').textContent = `${catalogItems.length} ${label.singular.toLocaleLowerCase('vi')}`;
  $('#catalog-empty').classList.toggle('hidden', catalogItems.length > 0);
  for (const item of catalogItems) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'catalog-card';
    if (item.avatar_url) {
      const avatar = document.createElement('img');
      avatar.className = 'catalog-card-avatar';
      avatar.src = item.avatar_url;
      avatar.alt = `Ảnh đại diện ${item.name}`;
      avatar.loading = 'lazy';
      avatar.onerror = () => {
        const fallback = document.createElement('span');
        fallback.className = 'catalog-card-icon';
        fallback.textContent = label.icon;
        avatar.replaceWith(fallback);
      };
      card.append(avatar);
    } else {
      const icon = document.createElement('span');
      icon.className = 'catalog-card-icon';
      icon.textContent = label.icon;
      card.append(icon);
    }
    const name = document.createElement('strong');
    name.textContent = item.name;
    const description = document.createElement('p');
    description.textContent = catalogKind === 'devices'
      ? [item.manufacturer, item.model, item.description].filter(Boolean).join(' · ') || 'Chưa có mô tả'
      : item.description || 'Chưa có mô tả';
    const meta = document.createElement('small');
    meta.textContent = catalogKind === 'solutions'
      ? `${item.device_count} thiết bị liên kết`
      : `${item.solution_count} giải pháp sử dụng`;
    card.append(name, description, meta);
    card.onclick = () => openCatalogDetail(item.id);
    host.append(card);
  }
}

async function openCatalogDetail(id) {
  const kind = catalogKind;
  if (!kind) return;
  catalogListRequest++;
  const requestId = ++catalogDetailRequest;
  try {
    const detail = await request(`/catalog/${kind}/${id}`);
    if (catalogKind !== kind || requestId !== catalogDetailRequest) return;
    catalogDetail = detail;
    renderCatalogDetail();
  } catch (error) {
    toast(error.message);
  }
}

function renderCatalogDetail() {
  const detail = catalogDetail;
  if (!detail || !catalogKind) return;
  const host = $('#catalog-detail');
  host.replaceChildren();
  host.classList.remove('hidden');
  host.classList.add('catalog-detail-split');
  $('#catalog-items').classList.add('hidden');
  $('#catalog-empty').classList.add('hidden');
  $('#catalog-count').textContent = `Chi tiết ${catalogLabels[catalogKind].singular.toLocaleLowerCase('vi')}`;

  const layout = document.createElement('div');
  layout.className = 'catalog-detail-layout';
  const main = document.createElement('div');
  main.className = 'catalog-detail-main';
  layout.append(main, renderCatalogRelationshipDiagram(catalogKind, detail));
  host.append(layout);

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'catalog-back';
  back.textContent = '‹ Quay lại danh sách';
  back.onclick = () => {
    catalogDetail = null;
    loadCatalogItems($('#catalog-search').value.trim());
  };
  main.append(back);

  const header = document.createElement('header');
  header.className = 'catalog-detail-head';
  const titleWrap = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = detail.name;
  titleWrap.append(title);
  if (catalogKind === 'devices') {
    const meta = [detail.manufacturer, detail.model].filter(Boolean).join(' · ');
    if (meta) {
      const subtitle = document.createElement('p');
      subtitle.textContent = meta;
      titleWrap.append(subtitle);
    }
  }
  const actions = document.createElement('div');
  actions.className = 'catalog-detail-actions';
  if (hasRole('editor')) {
    actions.append(
      makeCatalogButton('＋ Liên kết tài liệu', () => openCatalogDocumentDialog()),
      makeCatalogButton(catalogKind === 'solutions' ? '＋ Thêm thiết bị' : '＋ Thêm giải pháp', openCatalogRelatedDialog),
      makeCatalogButton('Sửa thông tin', () => openCatalogObjectDialog(detail))
    );
  }
  if (hasRole('manager')) actions.append(makeCatalogButton('Xóa', () => deleteCatalogObject(detail), true));
  header.append(titleWrap, actions);
  main.append(header);
  if (detail.description) {
    const description = document.createElement('p');
    description.className = 'catalog-description';
    description.textContent = detail.description;
    main.append(description);
  }

  main.append(renderCatalogImages(detail.images || []));
  if (catalogKind === 'solutions') {
    main.append(renderSolutionDevices(
      'Thiết bị có thể sử dụng',
      detail.related
    ));
  }

  for (const [category, categoryName] of Object.entries(catalogLabels[catalogKind].categories)) {
    const docs = detail.documents.filter(document => document.category === category);
    main.append(renderCatalogSection(
      categoryName,
      docs,
      document => removeCatalogDocument(document),
      false,
      input => uploadCatalogDocuments(category, input)
    ));
  }
  if (catalogKind === 'devices') {
    main.append(renderCatalogSection(
      'Giải pháp có thể sử dụng thiết bị này',
      detail.related,
      related => removeCatalogRelation(related),
      true
    ));
  }
}

function renderCatalogRelationshipDiagram(kind, detail) {
  const related = detail.related || [];
  const isSolution = kind === 'solutions';
  const panel = document.createElement('aside');
  panel.className = 'catalog-relationship-panel';

  const heading = document.createElement('h3');
  heading.textContent = 'Sơ đồ liên kết';
  const description = document.createElement('p');
  description.className = 'catalog-relationship-description';
  description.textContent = isSolution
    ? 'Thiết bị có thể sử dụng trong giải pháp này'
    : 'Giải pháp có thể sử dụng thiết bị này';
  panel.append(heading, description);

  const graph = document.createElement('div');
  graph.className = `catalog-relationship-graph${related.length ? '' : ' is-empty'}`;
  const hub = document.createElement('div');
  hub.className = 'catalog-relationship-node catalog-relationship-hub';
  hub.title = detail.name;
  if (detail.avatar_url) {
    const avatar = document.createElement('img');
    avatar.className = 'catalog-relationship-avatar';
    avatar.src = detail.avatar_url;
    avatar.alt = '';
    avatar.loading = 'lazy';
    hub.append(avatar);
  }
  const hubType = document.createElement('small');
  hubType.textContent = isSolution ? 'GIẢI PHÁP' : 'THIẾT BỊ';
  const hubName = document.createElement('strong');
  hubName.textContent = detail.name;
  hub.append(hubType, hubName);
  graph.append(hub);

  if (related.length) {
    const rowHeight = 84;
    const rowGap = 12;
    const graphHeight = related.length * rowHeight + (related.length - 1) * rowGap;
    const firstCenter = rowHeight / 2;
    const lastCenter = graphHeight - rowHeight / 2;
    const hubCenter = graphHeight / 2;
    const connector = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    connector.classList.add('catalog-relationship-connectors');
    connector.setAttribute('viewBox', `0 0 100 ${graphHeight}`);
    connector.setAttribute('preserveAspectRatio', 'none');
    connector.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', [
      `M 34 ${hubCenter} H 38`,
      `M 38 ${firstCenter} V ${lastCenter}`,
      ...related.map((_, index) => {
        const center = firstCenter + index * (rowHeight + rowGap);
        return `M 38 ${center} H 42`;
      })
    ].join(' '));
    connector.append(path);
    graph.append(connector);

    const relatedNodes = document.createElement('div');
    relatedNodes.className = 'catalog-relationship-related';
    for (const item of related) {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'catalog-relationship-node catalog-relationship-link';
      node.title = item.name;
      const avatarUrl = item.avatar_url;
      if (avatarUrl) {
        const avatar = document.createElement('img');
        avatar.className = 'catalog-relationship-avatar';
        avatar.src = avatarUrl;
        avatar.alt = '';
        avatar.loading = 'lazy';
        node.append(avatar);
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'catalog-relationship-avatar catalog-relationship-avatar-placeholder';
        placeholder.textContent = catalogLabels[isSolution ? 'devices' : 'solutions'].icon;
        node.append(placeholder);
      }
      const label = document.createElement('span');
      label.className = 'catalog-relationship-link-label';
      const type = document.createElement('small');
      type.textContent = isSolution ? 'THIẾT BỊ' : 'GIẢI PHÁP';
      const name = document.createElement('strong');
      name.textContent = item.name;
      name.title = item.name;
      label.append(type, name);
      if (isSolution && (item.manufacturer || item.model)) {
        const meta = document.createElement('span');
        meta.textContent = [item.manufacturer, item.model].filter(Boolean).join(' · ');
        meta.title = meta.textContent;
        label.append(meta);
      }
      node.append(label);
      node.onclick = () => openCatalog(isSolution ? 'devices' : 'solutions').then(() => openCatalogDetail(item.id));
      relatedNodes.append(node);
    }
    graph.append(relatedNodes);
  } else {
    const empty = document.createElement('p');
    empty.className = 'catalog-relationship-empty';
    empty.textContent = isSolution ? 'Chưa liên kết thiết bị nào.' : 'Chưa liên kết giải pháp nào.';
    graph.append(empty);
  }

  panel.append(graph);
  const count = document.createElement('small');
  count.className = 'catalog-relationship-count';
  count.textContent = `${related.length} ${isSolution ? 'thiết bị' : 'giải pháp'}`;
  panel.append(count);
  return panel;
}

function renderCatalogImages(images) {
  const section = document.createElement('section');
  section.className = 'catalog-section device-images-section';
  const head = document.createElement('div');
  head.className = 'catalog-section-head';
  const heading = document.createElement('h3');
  const singular = catalogKind === 'solutions' ? 'giải pháp' : 'thiết bị';
  heading.textContent = `Hình ảnh ${singular} (${images.length})`;
  head.append(heading);
  if (hasRole('editor')) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp,image/avif';
    input.multiple = true;
    input.hidden = true;
    input.addEventListener('change', () => uploadCatalogImages(input));
    const upload = makeCatalogButton('↑ Tải ảnh lên', () => input.click());
    upload.className = 'catalog-upload-button';
    head.append(upload, input);
  }
  section.append(head);
  if (!images.length) {
    const empty = document.createElement('div');
    empty.className = 'catalog-placeholder';
    empty.textContent = `Chưa có hình ảnh. Ảnh đầu tiên tải lên sẽ tự động làm ảnh đại diện ${singular}.`;
    section.append(empty);
    return section;
  }
  const gallery = document.createElement('div');
  gallery.className = 'device-image-gallery';
  for (const image of images) {
    const figure = document.createElement('figure');
    figure.className = 'device-image-item';
    const photo = document.createElement('img');
    photo.src = image.url;
    photo.alt = image.original_name;
    photo.loading = 'lazy';
    photo.title = image.original_name;
    photo.tabIndex = 0;
    photo.setAttribute('role', 'button');
    photo.setAttribute('aria-label', `Xem ảnh ${image.original_name}`);
    photo.onclick = () => openCatalogImage(image);
    photo.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openCatalogImage(image);
      }
    };
    figure.append(photo);
    const caption = document.createElement('figcaption');
    caption.textContent = image.original_name;
    figure.append(caption);
    if (image.is_avatar) {
      const badge = document.createElement('span');
      badge.className = 'device-avatar-badge';
      badge.textContent = 'Ảnh đại diện';
      figure.append(badge);
    }
    if (hasRole('editor')) {
      const actions = document.createElement('div');
      actions.className = 'device-image-actions';
      if (!image.is_avatar) {
        actions.append(makeCatalogButton('Đặt làm đại diện', () => setCatalogAvatar(image)));
      }
      if (hasRole('manager')) actions.append(makeCatalogButton('Xóa', () => deleteCatalogImage(image), true));
      figure.append(actions);
    }
    gallery.append(figure);
  }
  section.append(gallery);
  return section;
}

function openCatalogImage(image) {
  $('#catalog-image-lightbox-photo').src = image.url;
  $('#catalog-image-lightbox-photo').alt = image.original_name;
  $('#catalog-image-lightbox-caption').textContent = image.original_name;
  $('#catalog-image-lightbox').showModal();
}

$('#catalog-image-lightbox-close').addEventListener('click', () => {
  $('#catalog-image-lightbox').close();
});
$('#catalog-image-lightbox').addEventListener('click', event => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
$('#catalog-image-lightbox').addEventListener('close', () => {
  $('#catalog-image-lightbox-photo').removeAttribute('src');
});

function renderSolutionDevices(title, devices) {
  const section = document.createElement('section');
  section.className = 'catalog-section solution-devices-section';
  const head = document.createElement('div');
  head.className = 'catalog-section-head';
  const heading = document.createElement('h3');
  heading.textContent = `${title} (${devices.length})`;
  head.append(heading);
  if (hasRole('editor')) {
    head.append(makeCatalogButton('＋ Thêm thiết bị', openCatalogRelatedDialog));
  }
  section.append(head);
  if (!devices.length) {
    const empty = document.createElement('div');
    empty.className = 'catalog-placeholder';
    empty.textContent = 'Chưa có thiết bị liên kết.';
    section.append(empty);
    return section;
  }
  const grid = document.createElement('div');
  grid.className = 'solution-device-grid';
  for (const device of devices) {
    const card = document.createElement('article');
    card.className = 'solution-device-card';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'solution-device-open';
    open.title = [device.name, device.manufacturer, device.model].filter(Boolean).join(' · ');
    if (device.avatar_url) {
      const avatar = document.createElement('img');
      avatar.className = 'solution-device-avatar';
      avatar.src = device.avatar_url;
      avatar.alt = '';
      avatar.loading = 'lazy';
      avatar.onerror = () => {
        const fallback = document.createElement('span');
        fallback.className = 'solution-device-placeholder';
        fallback.textContent = catalogLabels.devices.icon;
        avatar.replaceWith(fallback);
      };
      open.append(avatar);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'solution-device-placeholder';
      placeholder.textContent = catalogLabels.devices.icon;
      open.append(placeholder);
    }
    const name = document.createElement('strong');
    name.textContent = device.name;
    open.append(name);
    if (device.model) {
      const model = document.createElement('small');
      model.textContent = device.model;
      open.append(model);
    }
    open.onclick = () => openCatalog('devices').then(() => openCatalogDetail(device.id));
    card.append(open);
    if (hasRole('manager')) {
      const remove = makeCatalogButton('×', () => removeCatalogRelation(device), true);
      remove.className = 'solution-device-remove catalog-remove';
      remove.title = `Bỏ liên kết ${device.name}`;
      card.append(remove);
    }
    grid.append(card);
  }
  section.append(grid);
  return section;
}

function makeCatalogButton(text, handler, danger = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  if (danger) button.classList.add('catalog-remove');
  button.onclick = handler;
  return button;
}

function renderCatalogSection(title, items, removeHandler, related = false, onUpload = null) {
  const section = document.createElement('section');
  section.className = 'catalog-section';
  const head = document.createElement('div');
  head.className = 'catalog-section-head';
  const uploadAllowed = Boolean(onUpload && hasRole('editor'));
  const heading = document.createElement(uploadAllowed ? 'button' : 'h3');
  if (uploadAllowed) heading.type = 'button';
  heading.className = uploadAllowed ? 'catalog-section-title' : '';
  heading.textContent = title;
  head.append(heading);
  if (uploadAllowed) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.hidden = true;
    input.addEventListener('change', () => onUpload(input));
    heading.title = `Bấm để tải tài liệu vào nhóm “${title}”`;
    heading.onclick = () => input.click();
    const uploadButton = makeCatalogButton('↑ Tải lên', () => input.click());
    uploadButton.classList.add('catalog-upload-button');
    head.append(uploadButton, input);
  }
  section.append(head);
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'catalog-placeholder';
    empty.textContent = related ? 'Chưa có liên kết.' : 'Chưa có tài liệu thuộc nhóm này.';
    section.append(empty);
    return section;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'catalog-row';
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'catalog-row-main catalog-row-open';
    main.style.border = '0';
    main.style.background = 'transparent';
    main.style.textAlign = 'left';
    const name = document.createElement('strong');
    name.textContent = item.name;
    main.append(name);
    if (related && item.model) {
      const model = document.createElement('small');
      model.textContent = [item.manufacturer, item.model].filter(Boolean).join(' · ');
      main.append(model);
    } else if (!related) {
      const fileMeta = document.createElement('small');
      fileMeta.textContent = `${item.name.split('.').pop().toUpperCase()} · ${formatSize(item.size_bytes)}`;
      main.append(fileMeta);
    }
    main.onclick = () => {
      if (related) openCatalog(catalogKind === 'solutions' ? 'devices' : 'solutions').then(() => openCatalogDetail(item.id));
      else openEntry(item);
    };
    row.append(main);
    if (hasRole('manager')) {
      const remove = makeCatalogButton('Bỏ liên kết', () => removeHandler(item), true);
      remove.classList.add('catalog-remove');
      row.append(remove);
    }
    section.append(row);
  }
  return section;
}

async function uploadCatalogDocuments(category, input) {
  const files = [...input.files];
  if (!files.length) return;
  const id = catalogDetail?.id;
  if (!id || !catalogKind) return;
  const kind = catalogKind;
  const form = new FormData();
  form.append('category', category);
  for (const file of files) form.append('files', file);
  try {
    await request(`/catalog/${kind}/${id}/documents/upload`, {
      method: 'POST',
      body: form
    });
    await openCatalogDetail(id);
    await loadCatalogItems($('#catalog-search').value.trim());
    toast(`Đã tải lên ${files.length} tài liệu`);
  } catch (error) {
    toast(error.message);
  } finally {
    input.value = '';
  }
}

async function uploadCatalogImages(input) {
  const files = [...input.files];
  if (!files.length || !catalogDetail || !['solutions', 'devices'].includes(catalogKind)) return;
  const entityId = catalogDetail.id;
  const form = new FormData();
  for (const file of files) form.append('images', file);
  try {
    await request(`/catalog/${catalogKind}/${entityId}/images`, { method: 'POST', body: form });
    await openCatalogDetail(entityId);
    await loadCatalogItems($('#catalog-search').value.trim());
    toast(`Đã tải lên ${files.length} ảnh ${catalogLabels[catalogKind].singular.toLocaleLowerCase('vi')}`);
  } catch (error) {
    toast(error.message);
  } finally {
    input.value = '';
  }
}

async function setCatalogAvatar(image) {
  if (!catalogDetail || !['solutions', 'devices'].includes(catalogKind)) return;
  const entityId = catalogDetail.id;
  try {
    await request(`/catalog/${catalogKind}/${entityId}/images/${image.id}/avatar`, { method: 'PATCH' });
    await openCatalogDetail(entityId);
    await loadCatalogItems($('#catalog-search').value.trim());
    toast(`Đã cập nhật ảnh đại diện ${catalogLabels[catalogKind].singular.toLocaleLowerCase('vi')}`);
  } catch (error) {
    toast(error.message);
  }
}

async function deleteCatalogImage(image) {
  if (!catalogDetail || !['solutions', 'devices'].includes(catalogKind)) return;
  if (!window.confirm(`Xóa ảnh “${image.original_name}” khỏi ${catalogLabels[catalogKind].singular.toLocaleLowerCase('vi')}?`)) return;
  const entityId = catalogDetail.id;
  try {
    await request(`/catalog/${catalogKind}/${entityId}/images/${image.id}`, { method: 'DELETE' });
    await openCatalogDetail(entityId);
    await loadCatalogItems($('#catalog-search').value.trim());
    toast(`Đã xóa ảnh ${catalogLabels[catalogKind].singular.toLocaleLowerCase('vi')}`);
  } catch (error) {
    toast(error.message);
  }
}

function openCatalogObjectDialog(item = null) {
  catalogObjectId = item?.id || null;
  const form = $('#catalog-object-form');
  form.reset();
  $('#catalog-object-title').textContent = `${item ? 'Sửa' : 'Thêm'} ${catalogLabels[catalogKind].singular.toLocaleLowerCase('vi')}`;
  $('#catalog-model-field').classList.toggle('hidden', catalogKind !== 'devices');
  $('#catalog-manufacturer-field').classList.toggle('hidden', catalogKind !== 'devices');
  if (item) {
    form.elements.name.value = item.name || '';
    form.elements.model.value = item.model || '';
    form.elements.manufacturer.value = item.manufacturer || '';
    form.elements.description.value = item.description || '';
  }
  $('#catalog-object-dialog').showModal();
  form.elements.name.focus();
}

$('#catalog-object-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') {
    $('#catalog-object-dialog').close();
    return;
  }
  const form = event.currentTarget;
  const payload = {
    name: form.elements.name.value.trim(),
    description: form.elements.description.value.trim()
  };
  if (catalogKind === 'devices') {
    payload.model = form.elements.model.value.trim();
    payload.manufacturer = form.elements.manufacturer.value.trim();
  }
  try {
    const path = `/catalog/${catalogKind}${catalogObjectId ? `/${catalogObjectId}` : ''}`;
    const result = await request(path, {
      method: catalogObjectId ? 'PATCH' : 'POST',
      body: JSON.stringify(payload)
    });
    $('#catalog-object-dialog').close();
    await loadCatalogItems($('#catalog-search').value.trim());
    if (catalogObjectId) await openCatalogDetail(catalogObjectId);
    else await openCatalogDetail(result.id);
    toast('Đã lưu thông tin danh mục');
  } catch (error) {
    toast(error.message);
  }
});

async function deleteCatalogObject(item) {
  if (!window.confirm(`Xóa ${catalogLabels[catalogKind].singular.toLocaleLowerCase('vi')} “${item.name}”? Các liên kết tài liệu và thiết bị cũng sẽ bị gỡ.`)) return;
  try {
    await request(`/catalog/${catalogKind}/${item.id}`, { method: 'DELETE' });
    catalogDetail = null;
    await loadCatalogItems($('#catalog-search').value.trim());
    toast('Đã xóa khỏi danh mục');
  } catch (error) {
    toast(error.message);
  }
}

async function openCatalogDocumentDialog() {
  try {
    const files = await request('/catalog/files');
    if (!files.length) {
      toast('Chưa có tệp nào trong IFC_Doc để liên kết');
      return;
    }
    const form = $('#catalog-document-form');
    const category = form.elements.category;
    const entryId = form.elements.entryId;
    category.replaceChildren();
    entryId.replaceChildren();
    for (const [value, label] of Object.entries(catalogLabels[catalogKind].categories)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      category.append(option);
    }
    for (const file of files) {
      const option = document.createElement('option');
      option.value = file.id;
      option.textContent = file.name;
      entryId.append(option);
    }
    $('#catalog-document-dialog').showModal();
  } catch (error) {
    toast(error.message);
  }
}

$('#catalog-document-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') {
    $('#catalog-document-dialog').close();
    return;
  }
  const form = event.currentTarget;
  try {
    await request(`/catalog/${catalogKind}/${catalogDetail.id}/documents`, {
      method: 'POST',
      body: JSON.stringify({
        category: form.elements.category.value,
        entryId: form.elements.entryId.value
      })
    });
    $('#catalog-document-dialog').close();
    await openCatalogDetail(catalogDetail.id);
    toast('Đã liên kết tài liệu');
  } catch (error) {
    toast(error.message);
  }
});

async function removeCatalogDocument(document) {
  if (!window.confirm(`Bỏ liên kết tài liệu “${document.name}”? Tệp vẫn được giữ trong IFC_Doc.`)) return;
  try {
    await request(`/catalog/${catalogKind}/${catalogDetail.id}/documents/${document.id}/${document.category}`, {
      method: 'DELETE'
    });
    await openCatalogDetail(catalogDetail.id);
    toast('Đã bỏ liên kết tài liệu');
  } catch (error) {
    toast(error.message);
  }
}

async function openCatalogRelatedDialog() {
  try {
    const relatedKind = catalogKind === 'solutions' ? 'devices' : 'solutions';
    const related = await request(`/catalog/${relatedKind}`);
    const existing = new Set(catalogDetail.related.map(item => item.id));
    const options = related.filter(item => !existing.has(item.id));
    if (!options.length) {
      toast(`Không còn ${relatedKind === 'devices' ? 'thiết bị' : 'giải pháp'} nào để liên kết`);
      return;
    }
    const form = $('#catalog-related-form');
    const select = form.elements.relatedId;
    select.replaceChildren();
    for (const item of options) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      select.append(option);
    }
    $('#catalog-related-title').textContent = `Liên kết ${relatedKind === 'devices' ? 'thiết bị' : 'giải pháp'}`;
    $('#catalog-related-label').firstChild.textContent = relatedKind === 'devices' ? 'Thiết bị' : 'Giải pháp';
    $('#catalog-related-dialog').showModal();
  } catch (error) {
    toast(error.message);
  }
}

$('#catalog-related-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') {
    $('#catalog-related-dialog').close();
    return;
  }
  const relatedId = event.currentTarget.elements.relatedId.value;
  const solutionId = catalogKind === 'solutions' ? catalogDetail.id : relatedId;
  const deviceId = catalogKind === 'devices' ? catalogDetail.id : relatedId;
  try {
    await request(`/catalog/solutions/${solutionId}/devices`, {
      method: 'POST',
      body: JSON.stringify({ deviceId })
    });
    $('#catalog-related-dialog').close();
    await openCatalogDetail(catalogDetail.id);
    await loadCatalogItems($('#catalog-search').value.trim());
    toast('Đã liên kết giải pháp và thiết bị');
  } catch (error) {
    toast(error.message);
  }
});

async function removeCatalogRelation(related) {
  const solutionId = catalogKind === 'solutions' ? catalogDetail.id : related.id;
  const deviceId = catalogKind === 'devices' ? catalogDetail.id : related.id;
  const relatedName = related.name;
  if (!window.confirm(`Bỏ liên kết với “${relatedName}”?`)) return;
  try {
    await request(`/catalog/solutions/${solutionId}/devices/${deviceId}`, { method: 'DELETE' });
    await openCatalogDetail(catalogDetail.id);
    await loadCatalogItems($('#catalog-search').value.trim());
    toast('Đã bỏ liên kết');
  } catch (error) {
    toast(error.message);
  }
}

$('#catalog-add').onclick = () => openCatalogObjectDialog();
$('#catalog-search').oninput = () => {
  clearTimeout(catalogSearchTimer);
  catalogDetail = null;
  catalogSearchTimer = setTimeout(() => loadCatalogItems($('#catalog-search').value.trim()), 180);
};
$('#nav-solutions').onclick = () => openCatalog('solutions');
$('#nav-devices').onclick = () => openCatalog('devices');
$('#nav-home').onclick = () => { leaveCatalog(); openFolder(null, true); };
$('#nav-all').onclick = $('#nav-drive').onclick = () => { leaveCatalog(); openFolder(null, false); };
$('#quick-view').onclick = () => { leaveCatalog(); openFolder(null, false); };

boot();
