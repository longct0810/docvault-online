const { Pool } = require('pg');
const crypto = require('crypto');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    department TEXT, position TEXT, role TEXT NOT NULL DEFAULT 'viewer',
    is_admin BOOLEAN NOT NULL DEFAULT false, is_active BOOLEAN NOT NULL DEFAULT true,
    must_change_password BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS position TEXT');
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'viewer'");
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false');
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_role_check') THEN
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('viewer','editor','manager'));
    END IF;
  END $$`);
  await pool.query("UPDATE users SET role='manager' WHERE is_admin=true AND role!='manager'");
  await pool.query(`CREATE TABLE IF NOT EXISTS entries (
    id UUID PRIMARY KEY, parent_id UUID REFERENCES entries(id) ON DELETE CASCADE,
    name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('folder','file')),
    owner_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    is_private BOOLEAN NOT NULL DEFAULT false,
    is_catalog_public BOOLEAN NOT NULL DEFAULT false,
    disk_name TEXT, mime_type TEXT, size_bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query('ALTER TABLE entries ADD COLUMN IF NOT EXISTS owner_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE');
  await pool.query('ALTER TABLE entries ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false');
  await pool.query('ALTER TABLE entries ADD COLUMN IF NOT EXISTS is_catalog_public BOOLEAN NOT NULL DEFAULT false');
  await pool.query('CREATE INDEX IF NOT EXISTS entries_parent_idx ON entries(parent_id)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS entries_private_owner_unique ON entries(owner_user_id) WHERE is_private=true AND owner_user_id IS NOT NULL');
  await pool.query(`CREATE TABLE IF NOT EXISTS entry_permissions (
    id BIGSERIAL PRIMARY KEY,
    entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    subject_type TEXT NOT NULL CHECK(subject_type IN ('user','department','position')),
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    subject_value TEXT,
    permission TEXT NOT NULL CHECK(permission IN ('view','edit','manage')),
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
      (subject_type='user' AND user_id IS NOT NULL AND subject_value IS NULL) OR
      (subject_type IN ('department','position') AND user_id IS NULL AND subject_value IS NOT NULL AND length(trim(subject_value)) > 0)
    )
  )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS entry_permissions_user_unique
    ON entry_permissions(entry_id,user_id) WHERE subject_type='user'`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS entry_permissions_group_unique
    ON entry_permissions(entry_id,subject_type,lower(subject_value)) WHERE subject_type IN ('department','position')`);
  await pool.query('CREATE INDEX IF NOT EXISTS entry_permissions_entry_idx ON entry_permissions(entry_id)');
  await pool.query(`UPDATE entries SET is_catalog_public=false,updated_at=now()
    WHERE is_catalog_public=true AND EXISTS (
      SELECT 1 FROM entry_permissions p
      WHERE p.entry_id=entries.id AND p.created_by IS NOT NULL
    )`);
  if (process.env.ADMIN_USERNAME) {
    await pool.query("UPDATE users SET is_admin=true,is_active=true,role='manager' WHERE username=$1", [process.env.ADMIN_USERNAME]);
  }
  await ensurePersonalFolders();
  await pool.query(`CREATE TABLE IF NOT EXISTS activity_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    actor_username TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    entity_name TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS activity_logs_created_idx ON activity_logs(created_at DESC, id DESC)');
  await pool.query(`CREATE TABLE IF NOT EXISTS solutions (
    id UUID PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS solutions_name_unique ON solutions(lower(name))');
  await pool.query(`CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY, name TEXT NOT NULL, model TEXT NOT NULL DEFAULT '',
    manufacturer TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS devices_name_unique ON devices(lower(name))');
  await pool.query(`CREATE TABLE IF NOT EXISTS solution_documents (
    solution_id UUID NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
    entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK(category IN ('technical','presentation')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(solution_id,entry_id,category)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS solution_images (
    id UUID PRIMARY KEY,
    solution_id UUID NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
    disk_name TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/gif','image/webp','image/avif')),
    size_bytes BIGINT NOT NULL CHECK(size_bytes > 0),
    is_avatar BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS solution_images_solution_idx ON solution_images(solution_id,created_at)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS solution_images_avatar_unique ON solution_images(solution_id) WHERE is_avatar=true');
  await pool.query(`CREATE TABLE IF NOT EXISTS device_documents (
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK(category IN ('design','legal_test','catalog')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(device_id,entry_id,category)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS device_images (
    id UUID PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    disk_name TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/gif','image/webp','image/avif')),
    size_bytes BIGINT NOT NULL CHECK(size_bytes > 0),
    is_avatar BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS device_images_device_idx ON device_images(device_id,created_at)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS device_images_avatar_unique ON device_images(device_id) WHERE is_avatar=true');
  await pool.query(`CREATE TABLE IF NOT EXISTS solution_devices (
    solution_id UUID NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(solution_id,device_id)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS solution_documents_entry_idx ON solution_documents(entry_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS device_documents_entry_idx ON device_documents(entry_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS solution_devices_device_idx ON solution_devices(device_id)');
}

async function ensurePersonalFolders() {
  const { rows: users } = await pool.query('SELECT id,username FROM users ORDER BY id');
  const client = await pool.connect();
  try {
    for (const user of users) {
      await client.query('BEGIN');
      const { rows: inserted } = await client.query(
        `INSERT INTO entries(id,parent_id,name,kind,owner_user_id,is_private)
         VALUES($1,NULL,$2,'folder',$3,true)
         ON CONFLICT(owner_user_id) WHERE is_private=true AND owner_user_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [crypto.randomUUID(), `${user.username} - Cá nhân`, user.id]
      );
      let folderId = inserted[0]?.id;
      if (!folderId) {
        const { rows: existing } = await client.query(
          "SELECT id FROM entries WHERE owner_user_id=$1 AND is_private=true",
          [user.id]
        );
        folderId = existing[0]?.id;
      }
      if (!folderId) throw new Error(`Could not create personal folder for user ${user.id}`);
      await client.query(
        `INSERT INTO entry_permissions(entry_id,subject_type,user_id,permission)
         VALUES($1,'user',$2,'manage')
         ON CONFLICT(entry_id,user_id) WHERE subject_type='user'
         DO UPDATE SET permission='manage'`,
        [folderId, user.id]
      );
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
module.exports = { pool, initDb };
