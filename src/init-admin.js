require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, initDb } = require('./db');

(async () => {
  await initDb();
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password || password.length < 12) {
    throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD (at least 12 characters) in .env');
  }
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users(username,password_hash,role,is_admin,is_active)
     VALUES($1,$2,'manager',true,true)
     ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash,role='manager',is_admin=true,is_active=true`,
    [username, hash]
  );
  console.log(`Admin account ready: ${username}`);
  await pool.end();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
