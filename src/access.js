const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const permissionRank = { view: 1, edit: 2, manage: 3 };
const roleRank = { viewer: 1, editor: 2, manager: 3 };

async function authenticate(req, res, next) {
  try {
    const token = jwt.verify(req.cookies.session, process.env.JWT_SECRET);
    const { rows } = await pool.query(
      'SELECT id,username,department,position,role,is_admin,is_active FROM users WHERE id=$1',
      [token.sub]
    );
    if (!rows[0]?.is_active) return res.status(401).json({ error: 'Tài khoản không hoạt động' });
    req.user = rows[0];
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Phiên đăng nhập hết hạn' });
    }
    next(error);
  }
}

function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Bạn không có quyền quản trị' });
  next();
}

function hasRole(user, required) {
  return Boolean(user?.is_admin || roleRank[user?.role] >= roleRank[required]);
}

function requireRole(user, required, res) {
  if (hasRole(user, required)) return true;
  const messages = {
    editor: 'Vai trò Editor trở lên mới có quyền tạo hoặc sửa',
    manager: 'Chỉ vai trò Manager trở lên mới có quyền xóa'
  };
  res.status(403).json({ error: messages[required] || 'Bạn không có quyền thực hiện thao tác này' });
  return false;
}

function permissionSql(alias = 'p') {
  return `(
    (${alias}.subject_type='user' AND ${alias}.user_id=$1) OR
    (${alias}.subject_type='department' AND $2::text IS NOT NULL AND lower(${alias}.subject_value)=lower($2)) OR
    (${alias}.subject_type='position' AND $3::text IS NOT NULL AND lower(${alias}.subject_value)=lower($3))
  )`;
}

async function getPermissionMap(user, entryIds) {
  if (user.is_admin) return new Map((entryIds || []).map(id => [id, 'manage']));
  if (entryIds && !entryIds.length) return new Map();
  const { rows } = await pool.query(
    `WITH RECURSIVE ancestry AS (
      SELECT e.id AS item_id,e.id AS ancestor_id,e.parent_id
      FROM entries e
      WHERE $4::uuid[] IS NULL OR e.id=ANY($4::uuid[])
      UNION ALL
      SELECT a.item_id,p.id,p.parent_id
      FROM ancestry a JOIN entries p ON p.id=a.parent_id
    )
    SELECT item_id,
      CASE
        WHEN granted_rank=3 THEN 'manage'
        WHEN granted_rank=2 THEN 'edit'
        WHEN granted_rank=1 THEN 'view'
        WHEN is_catalog_public OR acl_count=0 THEN 'view'
        ELSE NULL
      END AS permission
    FROM (
      SELECT a.item_id,current_entry.is_catalog_public,
        MAX(CASE
          WHEN a.item_id=a.ancestor_id AND current_entry.is_catalog_public AND $5::text='manager' THEN 3
          WHEN ${permissionSql('ep')} THEN CASE ep.permission
            WHEN 'manage' THEN 3 WHEN 'edit' THEN 2 WHEN 'view' THEN 1 ELSE 0
          END
          ELSE 0
        END) AS granted_rank,
        COUNT(ep.id) AS acl_count
      FROM ancestry a
      JOIN entries current_entry ON current_entry.id=a.item_id
      LEFT JOIN entry_permissions ep ON ep.entry_id=a.ancestor_id
      GROUP BY a.item_id,current_entry.is_catalog_public
    ) effective_permissions`,
    [user.id, user.department, user.position, entryIds || null, user.role || 'viewer']
  );
  return new Map(rows.filter(row => row.permission).map(row => [row.item_id, row.permission]));
}

async function getEntryPermission(user, entryId) {
  if (user.is_admin) return 'manage';
  return (await getPermissionMap(user, [entryId])).get(entryId) || null;
}

function can(permission, required) {
  return permissionRank[permission] >= permissionRank[required];
}

async function authorizeEntry(user, entryId, required) {
  if (user.is_admin) return true;
  return can(await getEntryPermission(user, entryId), required);
}

async function filterAccessible(user, entries, required = 'view') {
  if (user.is_admin) return entries.map(entry => ({ ...entry, access_level: 'manage' }));
  const permissions = await getPermissionMap(user, entries.map(entry => entry.id));
  return entries
    .filter(entry => can(permissions.get(entry.id), required))
    .map(entry => ({ ...entry, access_level: permissions.get(entry.id) }));
}

module.exports = { authenticate, requireAdmin, requireRole, hasRole, getEntryPermission, authorizeEntry, filterAccessible, can };
