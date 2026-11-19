const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const { pool } = require('./db');
const { writeAudit } = require('./audit');
const { authenticate, requirePasswordChangeComplete, filterAccessible, requireRole, authorizeEntry } = require('./access');
const { cleanName } = require('./file-names');

const router = express.Router();
const storageRoot = path.resolve(process.env.STORAGE_DIR || './storage');
const maxFileSize = Number(process.env.MAX_FILE_SIZE_MB || 100) * 1024 * 1024;
fs.mkdirSync(storageRoot, { recursive: true });
const catalogUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, storageRoot),
    filename: (_req, _file, callback) => callback(null, crypto.randomUUID())
  }),
  limits: { fileSize: maxFileSize, files: 20 }
});
const imageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, storageRoot),
    filename: (_req, _file, callback) => callback(null, crypto.randomUUID())
  }),
  limits: { fileSize: Math.min(maxFileSize, 15 * 1024 * 1024), files: 20 },
  fileFilter: (_req, file, callback) => {
    if (!imageMimeTypes.has(file.mimetype)) {
      const error = new Error('Chỉ chấp nhận ảnh JPEG, PNG, GIF, WebP hoặc AVIF');
      error.code = 'INVALID_IMAGE_TYPE';
      return callback(error);
    }
    callback(null, true);
  }
});
const entityConfig = {
  solutions: {
    table: 'solutions',
    singular: 'solution',
    title: 'giải pháp',
    documentTable: 'solution_documents',
    foreignKey: 'solution_id',
    categories: ['technical', 'presentation'],
    fields: ['name', 'description']
  },
  devices: {
    table: 'devices',
    singular: 'device',
    title: 'thiết bị',
    documentTable: 'device_documents',
    foreignKey: 'device_id',
    categories: ['datasheet', 'installation', 'legal_test', 'catalog'],
    fields: ['name', 'model', 'manufacturer', 'description']
  }
};

router.use(authenticate, requirePasswordChangeComplete);

router.get('/files', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id,name,kind,mime_type,size_bytes,updated_at FROM entries
     WHERE kind='file' ORDER BY lower(name)`
  );
  res.json(await filterAccessible(req.user, rows));
});

router.get('/devices/:deviceId/images/:imageId', async (req, res, next) => {
  if (!isUuid(req.params.deviceId) || !isUuid(req.params.imageId)) return res.sendStatus(404);
  const { rows } = await pool.query(
    'SELECT disk_name,mime_type FROM device_images WHERE id=$1 AND device_id=$2',
    [req.params.imageId, req.params.deviceId]
  );
  if (!rows[0]) return res.sendStatus(404);
  const imagePath = path.join(storageRoot, rows[0].disk_name);
  res.type(rows[0].mime_type);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(imagePath, error => {
    if (error && !res.headersSent) next(error);
  });
});

router.get('/solutions/:solutionId/images/:imageId', async (req, res, next) => {
  if (!isUuid(req.params.solutionId) || !isUuid(req.params.imageId)) return res.sendStatus(404);
  const { rows } = await pool.query(
    'SELECT disk_name,mime_type FROM solution_images WHERE id=$1 AND solution_id=$2',
    [req.params.imageId, req.params.solutionId]
  );
  if (!rows[0]) return res.sendStatus(404);
  const imagePath = path.join(storageRoot, rows[0].disk_name);
  res.type(rows[0].mime_type);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(imagePath, error => {
    if (error && !res.headersSent) next(error);
  });
});

router.post('/solutions/:id/images', (req, res, next) => {
  if (!requireCatalogRole(req, res, 'editor')) return;
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Mã giải pháp không hợp lệ' });
  next();
}, (req, res, next) => {
  imageUpload.array('images', 20)(req, res, async error => {
    if (!error) return next();
    await removeUploadedFiles(req.files || []);
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      return res.status(tooLarge ? 413 : 400).json({
        error: tooLarge
          ? `Mỗi ảnh không được vượt quá ${Math.floor(Math.min(maxFileSize, 15 * 1024 * 1024) / 1024 / 1024)} MB`
          : error.code === 'LIMIT_FILE_COUNT'
            ? 'Mỗi lần tải lên tối đa 20 ảnh'
            : 'Không thể nhận ảnh tải lên'
      });
    }
    if (error.code === 'INVALID_IMAGE_TYPE') return res.status(400).json({ error: error.message });
    return next(error);
  });
}, async (req, res, next) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Chọn ít nhất một ảnh để tải lên' });

  const detectedTypes = [];
  try {
    for (const file of files) {
      const detected = await detectImageType(file.path);
      if (!detected || detected.mimeType !== file.mimetype) {
        await removeUploadedFiles(files);
        return res.status(400).json({ error: 'Nội dung ảnh không hợp lệ hoặc không khớp định dạng tệp' });
      }
      detectedTypes.push(detected.mimeType);
    }
  } catch (error) {
    try {
      await removeUploadedFiles(files);
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
    }
    return next(error);
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows: solutions } = await client.query(
      'SELECT name FROM solutions WHERE id=$1 FOR UPDATE',
      [req.params.id]
    );
    if (!solutions[0]) {
      await client.query('ROLLBACK');
      await removeUploadedFiles(files);
      return res.sendStatus(404);
    }
    const { rows: existingAvatar } = await client.query(
      'SELECT id FROM solution_images WHERE solution_id=$1 AND is_avatar=true',
      [req.params.id]
    );
    let setInitialAvatar = existingAvatar.length === 0;
    const added = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const id = crypto.randomUUID();
      const name = cleanName(file.originalname) || 'solution-image';
      const isAvatar = setInitialAvatar;
      await client.query(
        `INSERT INTO solution_images(id,solution_id,disk_name,original_name,mime_type,size_bytes,is_avatar)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [id, req.params.id, file.filename, name, detectedTypes[index], file.size, isAvatar]
      );
      await writeAudit(client, req, {
        action: 'solution_image_upload',
        entityType: 'solution',
        entityId: req.params.id,
        entityName: solutions[0].name,
        details: { imageId: id, fileName: name, mimeType: detectedTypes[index], isAvatar }
      });
      added.push({
        id,
        original_name: name,
        mime_type: detectedTypes[index],
        size_bytes: file.size,
        is_avatar: isAvatar,
        url: `/api/catalog/solutions/${req.params.id}/images/${id}`
      });
      setInitialAvatar = false;
    }
    await client.query('COMMIT');
    res.status(201).json(added);
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    await removeUploadedFiles(files);
    return next(error);
  } finally {
    client?.release();
  }
});

router.patch('/solutions/:solutionId/images/:imageId/avatar', async (req, res) => {
  if (!requireCatalogRole(req, res, 'editor')) return;
  if (!isUuid(req.params.solutionId) || !isUuid(req.params.imageId)) {
    return res.status(400).json({ error: 'Mã giải pháp hoặc ảnh không hợp lệ' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: solutions } = await client.query(
      'SELECT name FROM solutions WHERE id=$1 FOR UPDATE',
      [req.params.solutionId]
    );
    if (!solutions[0]) {
      await client.query('ROLLBACK');
      return res.sendStatus(404);
    }
    const { rows: images } = await client.query(
      'SELECT id,original_name FROM solution_images WHERE id=$1 AND solution_id=$2 FOR UPDATE',
      [req.params.imageId, req.params.solutionId]
    );
    if (!images[0]) {
      await client.query('ROLLBACK');
      return res.sendStatus(404);
    }
    await client.query('UPDATE solution_images SET is_avatar=false WHERE solution_id=$1 AND is_avatar=true', [req.params.solutionId]);
    await client.query('UPDATE solution_images SET is_avatar=true WHERE id=$1', [req.params.imageId]);
    await writeAudit(client, req, {
      action: 'solution_image_avatar',
      entityType: 'solution',
      entityId: req.params.solutionId,
      entityName: solutions[0].name,
      details: { imageId: images[0].id, fileName: images[0].original_name }
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

router.delete('/solutions/:solutionId/images/:imageId', async (req, res) => {
  if (!requireCatalogRole(req, res, 'manager')) return;
  if (!isUuid(req.params.solutionId) || !isUuid(req.params.imageId)) {
    return res.status(400).json({ error: 'Mã giải pháp hoặc ảnh không hợp lệ' });
  }
  const client = await pool.connect();
  let diskName;
  try {
    await client.query('BEGIN');
    const { rows: solutions } = await client.query(
      'SELECT name FROM solutions WHERE id=$1 FOR UPDATE',
      [req.params.solutionId]
    );
    if (!solutions[0]) {
      await client.query('ROLLBACK');
      return res.sendStatus(404);
    }
    const { rows: images } = await client.query(
      'DELETE FROM solution_images WHERE id=$1 AND solution_id=$2 RETURNING disk_name,original_name,is_avatar',
      [req.params.imageId, req.params.solutionId]
    );
    if (!images[0]) {
      await client.query('ROLLBACK');
      return res.sendStatus(404);
    }
    diskName = images[0].disk_name;
    if (images[0].is_avatar) {
      await client.query(
        `UPDATE solution_images SET is_avatar=true WHERE id=(
           SELECT id FROM solution_images WHERE solution_id=$1 ORDER BY created_at,id LIMIT 1
         )`,
        [req.params.solutionId]
      );
    }
    await writeAudit(client, req, {
      action: 'solution_image_delete',
      entityType: 'solution',
      entityId: req.params.solutionId,
      entityName: solutions[0].name,
      details: { imageId: req.params.imageId, fileName: images[0].original_name }
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await removeDiskFiles([diskName]);
  res.json({ ok: true });
});

for (const [kind, config] of Object.entries(entityConfig)) {
  router.get(`/${kind}`, async (req, res) => {
    const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
    const { rows } = await pool.query(
      kind === 'solutions'
        ? `SELECT s.id,s.name,s.description,s.created_at,s.updated_at,
             (SELECT count(*)::int FROM solution_devices sd WHERE sd.solution_id=s.id) AS device_count,
             avatar.id AS avatar_image_id
           FROM solutions s LEFT JOIN solution_images avatar ON avatar.solution_id=s.id AND avatar.is_avatar=true
           WHERE $1='' OR s.name ILIKE '%'||$1||'%' OR s.description ILIKE '%'||$1||'%'
           ORDER BY lower(s.name)`
        : `SELECT d.id,d.name,d.model,d.manufacturer,d.description,d.created_at,d.updated_at,
             (SELECT count(*)::int FROM solution_devices sd WHERE sd.device_id=d.id) AS solution_count,
             avatar.id AS avatar_image_id
           FROM devices d LEFT JOIN device_images avatar ON avatar.device_id=d.id AND avatar.is_avatar=true
           WHERE $1='' OR d.name ILIKE '%'||$1||'%' OR d.model ILIKE '%'||$1||'%'
             OR d.manufacturer ILIKE '%'||$1||'%' OR d.description ILIKE '%'||$1||'%'
           ORDER BY lower(d.name)`,
      [search]
    );
    for (const row of rows) {
      row.avatar_url = row.avatar_image_id
        ? `/api/catalog/${kind}/${row.id}/images/${row.avatar_image_id}`
        : null;
      delete row.avatar_image_id;
    }
    res.json(rows);
  });

  router.get(`/${kind}/:id`, async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: `Mã ${config.title} không hợp lệ` });
    const columns = kind === 'solutions'
      ? 'id,name,description,created_at,updated_at'
      : 'id,name,model,manufacturer,description,created_at,updated_at';
    const { rows } = await pool.query(`SELECT ${columns} FROM ${config.table} WHERE id=$1`, [req.params.id]);
    if (!rows[0]) return res.sendStatus(404);
    const entity = rows[0];
    const { rows: documentRows } = await pool.query(
      `SELECT m.category,e.id,e.name,e.kind,e.mime_type,e.size_bytes,e.updated_at
       FROM ${config.documentTable} m JOIN entries e ON e.id=m.entry_id
       WHERE m.${config.foreignKey}=$1 ORDER BY m.category,lower(e.name)`,
      [req.params.id]
    );
    const documents = await filterAccessible(req.user, documentRows);
    const relatedQuery = kind === 'solutions'
      ? `SELECT d.id,d.name,d.model,d.manufacturer,avatar.id AS avatar_image_id
         FROM solution_devices sd JOIN devices d ON d.id=sd.device_id
         LEFT JOIN device_images avatar ON avatar.device_id=d.id AND avatar.is_avatar=true
         WHERE sd.solution_id=$1 ORDER BY lower(d.name)`
      : `SELECT s.id,s.name,avatar.id AS avatar_image_id FROM solution_devices sd
         JOIN solutions s ON s.id=sd.solution_id
         LEFT JOIN solution_images avatar ON avatar.solution_id=s.id AND avatar.is_avatar=true
         WHERE sd.device_id=$1 ORDER BY lower(s.name)`;
    const { rows: related } = await pool.query(relatedQuery, [req.params.id]);
    if (kind === 'devices') {
      const { rows: images } = await pool.query(
        `SELECT id,original_name,mime_type,size_bytes,is_avatar,created_at
         FROM device_images WHERE device_id=$1 ORDER BY is_avatar DESC,created_at,id`,
        [req.params.id]
      );
      for (const image of images) {
        image.url = `/api/catalog/devices/${req.params.id}/images/${image.id}`;
      }
      const avatar = images.find(image => image.is_avatar);
      entity.avatar_url = avatar?.url || null;
      res.json({ ...entity, documents, related, images });
      return;
    }
    const { rows: images } = await pool.query(
      `SELECT id,original_name,mime_type,size_bytes,is_avatar,created_at
       FROM solution_images WHERE solution_id=$1 ORDER BY is_avatar DESC,created_at,id`,
      [req.params.id]
    );
    for (const image of images) {
      image.url = `/api/catalog/solutions/${req.params.id}/images/${image.id}`;
    }
    const avatar = images.find(image => image.is_avatar);
    entity.avatar_url = avatar?.url || null;
    for (const item of related) {
      const relatedKind = kind === 'solutions' ? 'devices' : 'solutions';
      item.avatar_url = item.avatar_image_id
        ? `/api/catalog/${relatedKind}/${item.id}/images/${item.avatar_image_id}`
        : null;
      delete item.avatar_image_id;
    }
    res.json({ ...entity, documents, related, images });
  });

  if (kind === 'devices') {
    router.get('/devices/:id/document-departments', async (req, res) => {
      if (!requireCatalogRole(req, res, 'manager')) return;
      if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Mã thiết bị không hợp lệ' });
      const { rows: devices } = await pool.query('SELECT id FROM devices WHERE id=$1', [req.params.id]);
      if (!devices[0]) return res.sendStatus(404);
      const [{ rows: departments }, { rows: grants }] = await Promise.all([
        pool.query('SELECT name FROM departments ORDER BY lower(name)'),
        pool.query(
          `SELECT category,department FROM device_document_departments
           WHERE device_id=$1 ORDER BY category,lower(department)`,
          [req.params.id]
        )
      ]);
      res.json({
        departments: departments.map(row => row.name),
        permissions: Object.fromEntries(config.categories.map(category => [
          category,
          grants.filter(grant => grant.category === category).map(grant => grant.department)
        ]))
      });
    });

    router.put('/devices/:id/document-departments/:category', async (req, res) => {
      if (!requireCatalogRole(req, res, 'manager')) return;
      const { id, category } = req.params;
      if (!isUuid(id) || !config.categories.includes(category)) {
        return res.status(400).json({ error: 'Thiết bị hoặc loại tài liệu không hợp lệ' });
      }
      const requested = req.body?.departments;
      if (!Array.isArray(requested) || requested.some(value => typeof value !== 'string')) {
        return res.status(400).json({ error: 'Danh sách phòng ban không hợp lệ' });
      }
      const uniqueNames = [...new Set(requested.map(value => value.trim().toLocaleLowerCase()))];
      if (uniqueNames.length > 100 || uniqueNames.some(value => !value || value.length > 120)) {
        return res.status(400).json({ error: 'Danh sách phòng ban không hợp lệ' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: devices } = await client.query(
          'SELECT name FROM devices WHERE id=$1 FOR UPDATE',
          [id]
        );
        if (!devices[0]) {
          await client.query('ROLLBACK');
          return res.sendStatus(404);
        }
        const { rows: departments } = await client.query(
          `SELECT name FROM departments
           WHERE lower(name)=ANY($1::text[])`,
          [uniqueNames]
        );
        if (departments.length !== uniqueNames.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Một hoặc nhiều phòng ban không tồn tại' });
        }
        await client.query(
          'DELETE FROM device_document_departments WHERE device_id=$1 AND category=$2',
          [id, category]
        );
        for (const department of departments) {
          await client.query(
            `INSERT INTO device_document_departments(device_id,category,department)
             VALUES($1,$2,$3)`,
            [id, category, department.name]
          );
        }
        await writeAudit(client, req, {
          action: 'device_document_permission_update',
          entityType: 'device',
          entityId: id,
          entityName: devices[0].name,
          details: { category, departments: departments.map(row => row.name) }
        });
        await client.query('COMMIT');
        res.json({ category, departments: departments.map(row => row.name) });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }

  router.post(`/${kind}`, async (req, res) => {
    if (!requireCatalogRole(req, res, 'editor')) return;
    const values = validateEntity(kind, req.body);
    if (values.error) return res.status(400).json({ error: values.error });
    const id = crypto.randomUUID();
    const columns = config.fields.join(',');
    const placeholders = config.fields.map((_, index) => `$${index + 2}`).join(',');
    const params = [id, ...config.fields.map(field => values[field])];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO ${config.table}(id,${columns},created_by) VALUES($1,${placeholders},$${params.length + 1}) RETURNING *`,
        [...params, req.user.id]
      );
      await writeAudit(client, req, {
        action: 'catalog_create', entityType: config.singular, entityId: id,
        entityName: values.name, details: {}
      });
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: `Tên ${config.title} đã tồn tại` });
      throw error;
    } finally {
      client.release();
    }
  });

  router.patch(`/${kind}/:id`, async (req, res) => {
    if (!requireCatalogRole(req, res, 'editor')) return;
    if (!isUuid(req.params.id)) return res.status(400).json({ error: `Mã ${config.title} không hợp lệ` });
    const values = validateEntity(kind, req.body);
    if (values.error) return res.status(400).json({ error: values.error });
    const assignments = config.fields.map((field, index) => `${field}=$${index + 1}`).join(',');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE ${config.table} SET ${assignments},updated_at=now() WHERE id=$${config.fields.length + 1} RETURNING *`,
        [...config.fields.map(field => values[field]), req.params.id]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.sendStatus(404);
      }
      await writeAudit(client, req, {
        action: 'catalog_update', entityType: config.singular, entityId: req.params.id,
        entityName: values.name, details: {}
      });
      await client.query('COMMIT');
      res.json(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: `Tên ${config.title} đã tồn tại` });
      throw error;
    } finally {
      client.release();
    }
  });

  router.delete(`/${kind}/:id`, async (req, res) => {
    if (!requireCatalogRole(req, res, 'manager')) return;
    if (!isUuid(req.params.id)) return res.status(400).json({ error: `Mã ${config.title} không hợp lệ` });
    const client = await pool.connect();
    let imageFiles = [];
    let deleted = false;
    try {
      await client.query('BEGIN');
      if (kind === 'devices' || kind === 'solutions') {
        const imageTable = kind === 'devices' ? 'device_images' : 'solution_images';
        const ownerColumn = kind === 'devices' ? 'device_id' : 'solution_id';
        const { rows } = await client.query(`SELECT disk_name FROM ${imageTable} WHERE ${ownerColumn}=$1`, [req.params.id]);
        imageFiles = rows.map(row => row.disk_name);
      }
      const { rows } = await client.query(
        `DELETE FROM ${config.table} WHERE id=$1 RETURNING name`,
        [req.params.id]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.sendStatus(404);
      }
      await writeAudit(client, req, {
        action: 'catalog_delete', entityType: config.singular, entityId: req.params.id,
        entityName: rows[0].name, details: {}
      });
      await client.query('COMMIT');
      deleted = true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (deleted) {
      await removeDiskFiles(imageFiles);
      res.json({ ok: true });
    }
  });
}

router.post('/devices/:id/images', (req, res, next) => {
  if (!requireCatalogRole(req, res, 'editor')) return;
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Mã thiết bị không hợp lệ' });
  next();
}, (req, res, next) => {
  imageUpload.array('images', 20)(req, res, async error => {
    if (!error) return next();
    await removeUploadedFiles(req.files || []);
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      return res.status(tooLarge ? 413 : 400).json({
        error: tooLarge
          ? `Mỗi ảnh không được vượt quá ${Math.floor(Math.min(maxFileSize, 15 * 1024 * 1024) / 1024 / 1024)} MB`
          : error.code === 'LIMIT_FILE_COUNT'
            ? 'Mỗi lần tải lên tối đa 20 ảnh'
            : 'Không thể nhận ảnh tải lên'
      });
    }
    if (error.code === 'INVALID_IMAGE_TYPE') return res.status(400).json({ error: error.message });
    return next(error);
  });
}, async (req, res, next) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Chọn ít nhất một ảnh để tải lên' });

  const detectedTypes = [];
  try {
    for (const file of files) {
      const detected = await detectImageType(file.path);
      if (!detected || detected.mimeType !== file.mimetype) {
        await removeUploadedFiles(files);
        return res.status(400).json({ error: 'Nội dung ảnh không hợp lệ hoặc không khớp định dạng tệp' });
      }
      detectedTypes.push(detected.mimeType);
    }
  } catch (error) {
    try {
      await removeUploadedFiles(files);
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
    }
    return next(error);
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows: devices } = await client.query(
      'SELECT name FROM devices WHERE id=$1 FOR UPDATE',
      [req.params.id]
    );
    if (!devices[0]) {
      await client.query('ROLLBACK');
      await removeUploadedFiles(files);
      return res.sendStatus(404);
    }
    const { rows: existingAvatar } = await client.query(
      'SELECT id FROM device_images WHERE device_id=$1 AND is_avatar=true',
      [req.params.id]
    );
    let setInitialAvatar = existingAvatar.length === 0;
    const added = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const id = crypto.randomUUID();
      const name = cleanName(file.originalname) || 'device-image';
      const isAvatar = setInitialAvatar;
      await client.query(
        `INSERT INTO device_images(id,device_id,disk_name,original_name,mime_type,size_bytes,is_avatar)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [id, req.params.id, file.filename, name, detectedTypes[index], file.size, isAvatar]
      );
      await writeAudit(client, req, {
        action: 'device_image_upload',
        entityType: 'device',
        entityId: req.params.id,
        entityName: devices[0].name,
        details: { imageId: id, fileName: name, mimeType: detectedTypes[index], isAvatar }
      });
      added.push({
        id,
        original_name: name,
        mime_type: detectedTypes[index],
        size_bytes: file.size,
        is_avatar: isAvatar,
        url: `/api/catalog/devices/${req.params.id}/images/${id}`
      });
      setInitialAvatar = false;
    }
    await client.query('COMMIT');
    res.status(201).json(added);
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    await removeUploadedFiles(files);
    return next(error);
  } finally {
    client?.release();
  }
});

router.patch('/devices/:deviceId/images/:imageId/avatar', async (req, res) => {
  if (!requireCatalogRole(req, res, 'editor')) return;
  if (!isUuid(req.params.deviceId) || !isUuid(req.params.imageId)) {
    return res.status(400).json({ error: 'Mã thiết bị hoặc ảnh không hợp lệ' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: devices } = await client.query(
      'SELECT name FROM devices WHERE id=$1 FOR UPDATE',
      [req.params.deviceId]
    );
    if (!devices[0]) {
      await client.query('ROLLBACK');
      return res.sendStatus(404);
    }
    const { rows: images } = await client.query(
      'SELECT id,original_name FROM device_images WHERE id=$1 AND device_id=$2 FOR UPDATE',
      [req.params.imageId, req.params.deviceId]
    );
    if (!images[0]) {
      await client.query('ROLLBACK');
      return res.sendStatus(404);
    }
    await client.query('UPDATE device_images SET is_avatar=false WHERE device_id=$1 AND is_avatar=true', [req.params.deviceId]);
    await client.query('UPDATE device_images SET is_avatar=true WHERE id=$1', [req.params.imageId]);
    await writeAudit(client, req, {
      action: 'device_image_avatar',
      entityType: 'device',
      entityId: req.params.deviceId,
      entityName: devices[0].name,
      details: { imageId: images[0].id, fileName: images[0].original_name }
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

router.delete('/devices/:deviceId/images/:imageId', async (req, res) => {
  if (!requireCatalogRole(req, res, 'manager')) return;
  if (!isUuid(req.params.deviceId) || !isUuid(req.params.imageId)) {
    return res.status(400).json({ error: 'Mã thiết bị hoặc ảnh không hợp lệ' });
  }
  const client = await pool.connect();
  let diskName;
  let deviceName;
  try {
    await client.query('BEGIN');
    const { rows: devices } = await client.query(
      'SELECT name FROM devices WHERE id=$1 FOR UPDATE',
      [req.params.deviceId]
    );
    if (!devices[0]) {
      await client.query('ROLLBACK');
      return res.sendStatus(404);
    }
    deviceName = devices[0].name;
    const { rows: images } = await client.query(
      'DELETE FROM device_images WHERE id=$1 AND device_id=$2 RETURNING disk_name,original_name,is_avatar',
      [req.params.imageId, req.params.deviceId]
    );
    if (!images[0]) {
      await client.query('ROLLBACK');
      return res.sendStatus(404);
    }
    diskName = images[0].disk_name;
    if (images[0].is_avatar) {
      await client.query(
        `UPDATE device_images SET is_avatar=true WHERE id=(
           SELECT id FROM device_images WHERE device_id=$1 ORDER BY created_at,id LIMIT 1
         )`,
        [req.params.deviceId]
      );
    }
    await writeAudit(client, req, {
      action: 'device_image_delete',
      entityType: 'device',
      entityId: req.params.deviceId,
      entityName: deviceName,
      details: { imageId: req.params.imageId, fileName: images[0].original_name }
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await removeDiskFiles([diskName]);
  res.json({ ok: true });
});

router.post('/:kind/:id/documents', async (req, res) => {
  const config = entityConfig[req.params.kind];
  if (!config) return res.sendStatus(404);
  if (!requireCatalogRole(req, res, 'editor')) return;
  const { entryId, category } = req.body || {};
  if (!isUuid(req.params.id) || !isUuid(entryId) || !config.categories.includes(category)) {
    return res.status(400).json({ error: 'Tài liệu hoặc loại tài liệu không hợp lệ' });
  }
  if (!await authorizeEntry(req.user, entryId, 'view')) {
    return res.status(403).json({ error: 'Bạn không có quyền sử dụng tài liệu này' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: entities } = await client.query(
      `SELECT name FROM ${config.table} WHERE id=$1 FOR UPDATE`,
      [req.params.id]
    );
    if (!entities[0]) {
      await client.query('ROLLBACK');
      return res.sendStatus(404);
    }
    const { rows: files } = await client.query(
      "SELECT id FROM entries WHERE id=$1 AND kind='file'",
      [entryId]
    );
    if (!files[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Chỉ có thể liên kết tệp hiện có trong IFC_Doc' });
    }
    await client.query(
      `INSERT INTO ${config.documentTable}(${config.foreignKey},entry_id,category)
       VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [req.params.id, entryId, category]
    );
    await writeAudit(client, req, {
      action: 'catalog_document_add', entityType: config.singular, entityId: req.params.id,
      entityName: entities[0].name, details: { entryId, category }
    });
    await client.query('COMMIT');
    res.status(201).json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.post('/:kind/:id/documents/upload', (req, res, next) => {
  const config = entityConfig[req.params.kind];
  if (!config) return res.sendStatus(404);
  if (!requireCatalogRole(req, res, 'editor')) return;
  if (!isUuid(req.params.id)) return res.status(400).json({ error: `Mã ${config.title} không hợp lệ` });
  next();
}, (req, res, next) => {
  catalogUpload.array('files', 20)(req, res, async error => {
    if (!error) return next();
    await removeUploadedFiles(req.files || []);
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? `Mỗi tệp không được vượt quá ${Math.floor(maxFileSize / 1024 / 1024)} MB`
        : error.code === 'LIMIT_FILE_COUNT'
          ? 'Mỗi lần tải lên tối đa 20 tệp'
          : 'Không thể nhận tệp tải lên';
      return res.status(status).json({ error: message });
    }
    return next(error);
  });
}, async (req, res, next) => {
  const config = entityConfig[req.params.kind];
  const category = req.body?.category;
  const files = req.files || [];
  if (!config.categories.includes(category)) {
    await removeUploadedFiles(files);
    return res.status(400).json({ error: 'Loại tài liệu không hợp lệ' });
  }
  if (!files.length) return res.status(400).json({ error: 'Chọn ít nhất một tệp để tải lên' });

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows: entities } = await client.query(
      `SELECT name FROM ${config.table} WHERE id=$1 FOR UPDATE`,
      [req.params.id]
    );
    if (!entities[0]) {
      await client.query('ROLLBACK');
      await removeUploadedFiles(files);
      return res.sendStatus(404);
    }

    const added = [];
    for (const file of files) {
      const id = crypto.randomUUID();
      const name = cleanName(file.originalname) || 'tai-lieu';
      await client.query(
        `INSERT INTO entries(id,parent_id,name,kind,disk_name,mime_type,size_bytes,is_catalog_public)
         VALUES($1,NULL,$2,'file',$3,$4,$5,true)`,
        [id, name, file.filename, file.mimetype, file.size]
      );
      await client.query(
        `INSERT INTO entry_permissions(entry_id,subject_type,user_id,permission)
         VALUES($1,'user',$2,$3)`,
        [id, req.user.id, req.user.role === 'manager' || req.user.is_admin ? 'manage' : 'edit']
      );
      await client.query(
        `INSERT INTO ${config.documentTable}(${config.foreignKey},entry_id,category)
         VALUES($1,$2,$3)`,
        [req.params.id, id, category]
      );
      await writeAudit(client, req, {
        action: 'upload',
        entityType: 'file',
        entityId: id,
        entityName: name,
        details: { parentName: null, mimeType: file.mimetype, sizeBytes: file.size }
      });
      await writeAudit(client, req, {
        action: 'catalog_document_add',
        entityType: config.singular,
        entityId: req.params.id,
        entityName: entities[0].name,
        details: { entryId: id, fileName: name, category }
      });
      added.push({ id, name, category });
    }
    await client.query('COMMIT');
    res.status(201).json(added);
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    await removeUploadedFiles(files);
    return next(error);
  } finally {
    client?.release();
  }
});

router.delete('/:kind/:id/documents/:entryId/:category', async (req, res) => {
  const config = entityConfig[req.params.kind];
  if (!config) return res.sendStatus(404);
  if (!requireCatalogRole(req, res, 'manager')) return;
  if (!isUuid(req.params.id) || !isUuid(req.params.entryId) || !config.categories.includes(req.params.category)) {
    return res.status(400).json({ error: 'Tài liệu hoặc loại tài liệu không hợp lệ' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: entities } = await client.query(`SELECT name FROM ${config.table} WHERE id=$1`, [req.params.id]);
    if (!entities[0]) {
      await client.query('ROLLBACK');
      return res.sendStatus(404);
    }
    const { rowCount } = await client.query(
      `DELETE FROM ${config.documentTable} WHERE ${config.foreignKey}=$1 AND entry_id=$2 AND category=$3`,
      [req.params.id, req.params.entryId, req.params.category]
    );
    if (!rowCount) {
      await client.query('ROLLBACK');
      return res.sendStatus(404);
    }
    await writeAudit(client, req, {
      action: 'catalog_document_remove', entityType: config.singular, entityId: req.params.id,
      entityName: entities[0].name, details: { entryId: req.params.entryId, category: req.params.category }
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

router.post('/solutions/:id/devices', async (req, res) => {
  if (!requireCatalogRole(req, res, 'editor')) return;
  const { deviceId } = req.body || {};
  if (!isUuid(req.params.id) || !isUuid(deviceId)) {
    return res.status(400).json({ error: 'Giải pháp hoặc thiết bị không hợp lệ' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: solution } = await client.query('SELECT name FROM solutions WHERE id=$1', [req.params.id]);
    const { rows: device } = await client.query('SELECT name FROM devices WHERE id=$1', [deviceId]);
    if (!solution[0] || !device[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy giải pháp hoặc thiết bị' });
    }
    await client.query(
      'INSERT INTO solution_devices(solution_id,device_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [req.params.id, deviceId]
    );
    await writeAudit(client, req, {
      action: 'catalog_link_device', entityType: 'solution', entityId: req.params.id,
      entityName: solution[0].name, details: { deviceId, deviceName: device[0].name }
    });
    await client.query('COMMIT');
    res.status(201).json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.delete('/solutions/:id/devices/:deviceId', async (req, res) => {
  if (!requireCatalogRole(req, res, 'manager')) return;
  if (!isUuid(req.params.id) || !isUuid(req.params.deviceId)) {
    return res.status(400).json({ error: 'Giải pháp hoặc thiết bị không hợp lệ' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: solution } = await client.query('SELECT name FROM solutions WHERE id=$1', [req.params.id]);
    if (!solution[0]) {
      await client.query('ROLLBACK');
      return res.sendStatus(404);
    }
    const { rowCount } = await client.query(
      'DELETE FROM solution_devices WHERE solution_id=$1 AND device_id=$2',
      [req.params.id, req.params.deviceId]
    );
    if (!rowCount) {
      await client.query('ROLLBACK');
      return res.sendStatus(404);
    }
    await writeAudit(client, req, {
      action: 'catalog_unlink_device', entityType: 'solution', entityId: req.params.id,
      entityName: solution[0].name, details: { deviceId: req.params.deviceId }
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

function requireCatalogRole(req, res, role) {
  return requireRole(req.user, role, res);
}

function validateEntity(kind, body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
  const name = cleanText(body.name, 240);
  if (!name) return { error: 'Tên không được để trống' };
  const description = cleanText(body.description, 4000) || '';
  if (kind === 'solutions') return { name, description };
  return {
    name,
    model: cleanText(body.model, 160) || '',
    manufacturer: cleanText(body.manufacturer, 160) || '',
    description
  };
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().slice(0, maxLength);
  return cleaned || null;
}

async function removeUploadedFiles(files) {
  await Promise.all(files.map(file => fs.promises.rm(file.path, { force: true })));
}

async function removeDiskFiles(names) {
  await Promise.all(names.map(name => fs.promises.rm(path.join(storageRoot, name), { force: true })));
}

async function detectImageType(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return { mimeType: 'image/jpeg' };
    }
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return { mimeType: 'image/png' };
    }
    if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) {
      return { mimeType: 'image/gif' };
    }
    if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
      return { mimeType: 'image/webp' };
    }
    if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp'
      && ['avif', 'avis'].includes(bytes.toString('ascii', 8, 12))) {
      return { mimeType: 'image/avif' };
    }
    return null;
  } finally {
    await handle.close();
  }
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

module.exports = router;
