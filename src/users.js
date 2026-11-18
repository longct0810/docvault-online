const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('./db');
const { authenticate, requirePasswordChangeComplete, requireAdmin } = require('./access');
const { writeAudit } = require('./audit');

const router = express.Router();
const defaultPassword = '123456';
router.use(authenticate, requirePasswordChangeComplete, requireAdmin);

router.get('/users', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id,username,department,position,role,is_admin,is_active,created_at
     FROM users ORDER BY lower(username)`
  );
  res.json(rows);
});

router.post('/users', async (req, res) => {
  const username = cleanText(req.body.username, 80);
  const department = cleanText(req.body.department, 120);
  const position = cleanText(req.body.position, 120);
  const role = req.body.role === undefined ? 'viewer' : req.body.role;
  if (!username || !/^[\p{L}\p{N}._@-]+$/u.test(username)) {
    return res.status(400).json({ error: 'Tên tài khoản không hợp lệ' });
  }
  if (!['viewer', 'editor', 'manager'].includes(role)) {
    return res.status(400).json({ error: 'Role không hợp lệ' });
  }
  const hash = await bcrypt.hash(defaultPassword, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO users(username,password_hash,department,position,role,must_change_password)
       VALUES($1,$2,$3,$4,$5,true)
       RETURNING id,username,department,position,role,is_admin,is_active,created_at`,
      [username, hash, department, position, role]
    );
    const folderId = crypto.randomUUID();
    const { rows: folder } = await client.query(
      `INSERT INTO entries(id,parent_id,name,kind,owner_user_id,is_private)
       VALUES($1,NULL,$2,'folder',$3,true) RETURNING id`,
      [folderId, `${username} - Cá nhân`, rows[0].id]
    );
    await client.query(
      `INSERT INTO entry_permissions(entry_id,subject_type,user_id,permission)
       VALUES($1,'user',$2,'manage')`,
      [folder[0].id, rows[0].id]
    );
    const { rows: created } = await client.query(
      `SELECT id,username,department,position,role,is_admin,is_active,created_at
       FROM users WHERE id=$1`,
      [rows[0].id]
    );
    await writeAudit(client, req, {
      action: 'user_create',
      entityType: 'user',
      entityName: username,
      details: { userId: rows[0].id, username, department, position, role, isActive: true, initialPassword: true }
    });
    await client.query('COMMIT');
    res.status(201).json(created[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Tên tài khoản đã tồn tại' });
    throw error;
  } finally {
    client.release();
  }
});

router.patch('/users/:id', async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Tài khoản không hợp lệ' });
  }
  const username = cleanText(req.body.username, 80);
  const department = cleanText(req.body.department, 120);
  const position = cleanText(req.body.position, 120);
  const requestedRole = req.body.role;
  const active = req.body.isActive;
  const { password } = req.body;
  if (!username || !/^[\p{L}\p{N}._@-]+$/u.test(username)) {
    return res.status(400).json({ error: 'Tên tài khoản không hợp lệ' });
  }
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'Trạng thái tài khoản không hợp lệ' });
  if (requestedRole !== undefined && !['viewer', 'editor', 'manager'].includes(requestedRole)) {
    return res.status(400).json({ error: 'Role không hợp lệ' });
  }
  if (password !== undefined && (
    typeof password !== 'string'
    || password.length < 12
    || Buffer.byteLength(password, 'utf8') > 72
  )) {
    return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 12 ký tự và tối đa 72 byte UTF-8' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(657586)');
    const { rows } = await client.query(
      `SELECT id,username,department,position,role,is_admin,is_active
       FROM users WHERE id=$1 FOR UPDATE`,
      [userId]
    );
    const previous = rows[0];
    if (!previous) {
      await client.query('ROLLBACK');
      return res.sendStatus(404);
    }
    const role = previous.is_admin ? 'manager' : (requestedRole || previous.role);
    if (String(previous.id) === String(req.user.id) && !active) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Không thể vô hiệu hóa tài khoản đang đăng nhập' });
    }
    if (previous.is_admin && !active) {
      const { rows: admins } = await client.query(
        'SELECT count(*)::int AS active_count FROM users WHERE is_admin=true AND is_active=true'
      );
      if (admins[0].active_count <= 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Không thể vô hiệu hóa quản trị viên đang hoạt động cuối cùng' });
      }
    }
    const hash = password === undefined ? null : await bcrypt.hash(password, 12);
    const { rows: updated } = await client.query(
      `UPDATE users SET username=$1,department=$2,position=$3,role=$4,is_active=$5,
       password_hash=COALESCE($6,password_hash),
       must_change_password=CASE WHEN $6 IS NULL THEN must_change_password ELSE true END
       WHERE id=$7
       RETURNING id,username,department,position,role,is_admin,is_active,created_at`,
      [username, department, position, role, active, hash, userId]
    );
    const next = updated[0];
    await client.query(
      "UPDATE entries SET name=$1,updated_at=now() WHERE owner_user_id=$2 AND is_private=true",
      [`${username} - Cá nhân`, userId]
    );
    const changed = previous.username !== next.username
      || previous.department !== next.department
      || previous.position !== next.position
      || previous.role !== next.role
      || previous.is_active !== next.is_active
      || password !== undefined;
    if (changed) {
      await writeAudit(client, req, {
        action: 'user_update',
        entityType: 'user',
        entityName: next.username,
        details: {
          userId: next.id,
          previousUsername: previous.username,
          username: next.username,
          previousRole: previous.role,
          role: next.role,
          department,
          position,
          isActive: active,
          passwordChanged: password !== undefined
        }
      });
    }
    await client.query('COMMIT');
    res.json(next);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Tên tài khoản đã tồn tại' });
    throw error;
  } finally {
    client.release();
  }
});

router.post('/users/:id/reset-password', async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Tài khoản không hợp lệ' });
  }
  const hash = await bcrypt.hash(defaultPassword, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id,username FROM users WHERE id=$1 FOR UPDATE',
      [userId]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.sendStatus(404);
    }
    await client.query(
      'UPDATE users SET password_hash=$1,must_change_password=true WHERE id=$2',
      [hash, userId]
    );
    await writeAudit(client, req, {
      action: 'user_password_reset',
      entityType: 'user',
      entityId: null,
      entityName: rows[0].username,
      details: { userId, passwordReset: true }
    });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().slice(0, maxLength);
  return cleaned || null;
}

module.exports = router;
