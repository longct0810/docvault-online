const express = require('express');
const { pool } = require('./db');
const { authenticate, requirePasswordChangeComplete, hasRole } = require('./access');
const { writeAudit } = require('./audit');

const router = express.Router();
const types = {
  departments: { table: 'departments', column: 'department', label: 'phòng ban' },
  positions: { table: 'positions', column: 'position', label: 'chức vụ' }
};

router.use(authenticate, requirePasswordChangeComplete);

for (const [type, config] of Object.entries(types)) {
  router.get(`/${type}`, async (req, res) => {
    const filterPositions = type === 'positions' && typeof req.query.department === 'string';
    const departmentName = filterPositions ? req.query.department.trim() : '';
    const { rows } = await pool.query(
      filterPositions
        ? `SELECT p.id,p.name FROM positions p
           WHERE NOT EXISTS (
             SELECT 1 FROM department_positions dp WHERE dp.position_id=p.id
           ) OR EXISTS (
             SELECT 1 FROM department_positions dp
             JOIN departments d ON d.id=dp.department_id
             WHERE dp.position_id=p.id AND $1::text<>'' AND lower(d.name)=lower($1)
           )
           ORDER BY lower(p.name)`
        : `SELECT id,name FROM ${config.table} ORDER BY lower(name)`,
      filterPositions ? [departmentName] : []
    );
    res.json(rows);
  });

  router.post(`/${type}`, async (req, res) => {
    if (!requireManager(req, res)) return;
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: `Tên ${config.label} không hợp lệ` });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO ${config.table}(name) VALUES($1) RETURNING id,name`,
        [name]
      );
      await writeAudit(client, req, {
        action: 'organization_create',
        entityType: type.slice(0, -1),
        entityId: null,
        entityName: name,
        details: { organizationId: rows[0].id }
      });
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: `Tên ${config.label} đã tồn tại` });
      throw error;
    } finally {
      client.release();
    }
  });

  router.patch(`/${type}/:id`, async (req, res) => {
    if (!requireManager(req, res)) return;
    const id = parseId(req.params.id);
    const name = cleanName(req.body?.name);
    if (!id) return res.status(400).json({ error: `${config.label} không hợp lệ` });
    if (!name) return res.status(400).json({ error: `Tên ${config.label} không hợp lệ` });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id,name FROM ${config.table} WHERE id=$1 FOR UPDATE`,
        [id]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.sendStatus(404);
      }
      const previousName = rows[0].name;
      if (config.column === 'department') {
        await renameDepartmentReferences(client, previousName, name);
      } else {
        await renamePositionReferences(client, previousName, name);
      }
      const { rows: updated } = await client.query(
        `UPDATE ${config.table} SET name=$1,updated_at=now() WHERE id=$2 RETURNING id,name`,
        [name, id]
      );
      await writeAudit(client, req, {
        action: 'organization_update',
        entityType: type.slice(0, -1),
        entityId: null,
        entityName: name,
        details: { organizationId: id, previousName, name }
      });
      await client.query('COMMIT');
      res.json(updated[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: `Tên ${config.label} đã tồn tại` });
      throw error;
    } finally {
      client.release();
    }
  });

  router.delete(`/${type}/:id`, async (req, res) => {
    if (!requireManager(req, res)) return;
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: `${config.label} không hợp lệ` });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id,name FROM ${config.table} WHERE id=$1 FOR UPDATE`,
        [id]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.sendStatus(404);
      }
      const linked = await countReferences(client, config.column, rows[0].name);
      if (linked) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Không thể xóa ${config.label} đang được gán cho tài khoản hoặc quyền truy cập`
        });
      }
      await client.query(`DELETE FROM ${config.table} WHERE id=$1`, [id]);
      await writeAudit(client, req, {
        action: 'organization_delete',
        entityType: type.slice(0, -1),
        entityId: null,
        entityName: rows[0].name,
        details: { organizationId: id }
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
}

function requireManager(req, res) {
  if (hasRole(req.user, 'manager')) return true;
  res.status(403).json({ error: 'Chỉ vai trò Manager trở lên mới có quyền quản lý phòng ban và chức vụ' });
  return false;
}

function cleanName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= 120 ? name : null;
}

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function renameDepartmentReferences(client, previousName, name) {
  if (previousName.toLocaleLowerCase() === name.toLocaleLowerCase()) {
    await client.query('UPDATE users SET department=$1 WHERE lower(department)=lower($2)', [name, previousName]);
    await client.query(
      `UPDATE entry_permissions SET subject_value=$1
       WHERE subject_type='department' AND lower(subject_value)=lower($2)`,
      [name, previousName]
    );
    await client.query(
      `UPDATE device_document_departments SET department=$1
       WHERE lower(department)=lower($2)`,
      [name, previousName]
    );
    return;
  }
  await client.query(
    `INSERT INTO entry_permissions(entry_id,subject_type,subject_value,permission,created_by)
     SELECT entry_id,'department',$1,permission,created_by FROM entry_permissions
     WHERE subject_type='department' AND lower(subject_value)=lower($2)
     ON CONFLICT (entry_id,subject_type,lower(subject_value))
       WHERE subject_type IN ('department','position')
     DO UPDATE SET permission=CASE
       WHEN entry_permissions.permission='manage' OR EXCLUDED.permission='manage' THEN 'manage'
       WHEN entry_permissions.permission='edit' OR EXCLUDED.permission='edit' THEN 'edit'
       ELSE 'view'
     END`,
    [name, previousName]
  );
  await client.query(
    `INSERT INTO device_document_departments(device_id,category,department)
     SELECT device_id,category,$1 FROM device_document_departments
     WHERE lower(department)=lower($2)
     ON CONFLICT DO NOTHING`,
    [name, previousName]
  );
  await client.query(
    `UPDATE users SET department=$1 WHERE lower(department)=lower($2)`,
    [name, previousName]
  );
  await client.query(
    `DELETE FROM entry_permissions WHERE subject_type='department' AND lower(subject_value)=lower($1)`,
    [previousName]
  );
  await client.query(
    `DELETE FROM device_document_departments WHERE lower(department)=lower($1)`,
    [previousName]
  );
}

async function renamePositionReferences(client, previousName, name) {
  if (previousName.toLocaleLowerCase() === name.toLocaleLowerCase()) {
    await client.query('UPDATE users SET position=$1 WHERE lower(position)=lower($2)', [name, previousName]);
    await client.query(
      `UPDATE entry_permissions SET subject_value=$1
       WHERE subject_type='position' AND lower(subject_value)=lower($2)`,
      [name, previousName]
    );
    return;
  }
  await client.query(
    `INSERT INTO entry_permissions(entry_id,subject_type,subject_value,permission,created_by)
     SELECT entry_id,'position',$1,permission,created_by FROM entry_permissions
     WHERE subject_type='position' AND lower(subject_value)=lower($2)
     ON CONFLICT (entry_id,subject_type,lower(subject_value))
       WHERE subject_type IN ('department','position')
     DO UPDATE SET permission=CASE
       WHEN entry_permissions.permission='manage' OR EXCLUDED.permission='manage' THEN 'manage'
       WHEN entry_permissions.permission='edit' OR EXCLUDED.permission='edit' THEN 'edit'
       ELSE 'view'
     END`,
    [name, previousName]
  );
  await client.query('UPDATE users SET position=$1 WHERE lower(position)=lower($2)', [name, previousName]);
  await client.query(
    `DELETE FROM entry_permissions WHERE subject_type='position' AND lower(subject_value)=lower($1)`,
    [previousName]
  );
}

async function countReferences(client, column, name) {
  const queries = [
    client.query(`SELECT count(*)::int AS count FROM users WHERE lower(${column})=lower($1)`, [name]),
    client.query(
      `SELECT count(*)::int AS count FROM entry_permissions
       WHERE subject_type=$1 AND lower(subject_value)=lower($2)`,
      [column, name]
    )
  ];
  if (column === 'department') {
    queries.push(client.query(
      'SELECT count(*)::int AS count FROM device_document_departments WHERE lower(department)=lower($1)',
      [name]
    ));
  }
  const results = await Promise.all(queries);
  return results.reduce((total, result) => total + result.rows[0].count, 0);
}

module.exports = router;
