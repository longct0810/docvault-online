require('dotenv').config({ path: `${__dirname}/.env` });

const databaseUrl = new URL(process.env.DATABASE_URL);
if (databaseUrl.hostname === 'db') {
  databaseUrl.hostname = '127.0.0.1';
  databaseUrl.port = '5433';
}

module.exports = {
  apps: [{
    name: 'IFC_Doc',
    script: 'src/server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: process.env.HOST_PORT || process.env.PORT || '3000',
      DATABASE_URL: databaseUrl.toString(),
      STORAGE_DIR: process.env.STORAGE_DIR || './storage'
    }
  }]
};
