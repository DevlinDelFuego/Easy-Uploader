const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shares (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      slug          TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at    DATETIME DEFAULT NULL,
      active        BOOLEAN DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      share_id      INTEGER NOT NULL REFERENCES shares(id),
      guest_token   TEXT,
      original_name TEXT NOT NULL,
      stored_name   TEXT NOT NULL,
      mime_type     TEXT,
      size_bytes    INTEGER,
      submitted_by  TEXT NOT NULL,
      comment       TEXT,
      uploaded_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'changeme';
  const hash = await bcrypt.hash(password, 12);

  const set = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  set.run('admin_username', username);
  set.run('admin_password_hash', hash);
}

module.exports = { db, migrate, seedAdmin };
