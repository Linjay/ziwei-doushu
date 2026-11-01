import 'server-only';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';

const state = globalThis as typeof globalThis & { mingliDatabase?: { file: string; db: DatabaseSync } };
export function database() {
  const directory = path.resolve(/* turbopackIgnore: true */ process.env.MINGLI_DATA_DIR || '.codex-local/app-data');
  const file = path.join(directory, 'mingli.sqlite');
  if (state.mingliDatabase?.file === file) return state.mingliDatabase.db;
  state.mingliDatabase?.db.close();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  if (process.platform !== 'win32') chmodSync(file, 0o600);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, profile TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, active_record TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS chart_records (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      record_id TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, record_id)
    );
    CREATE TABLE IF NOT EXISTS history_tombstones (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      record_id TEXT NOT NULL, PRIMARY KEY(user_id, record_id)
    );
    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS remembered_devices (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
      active_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS device_accounts (
      device_id TEXT NOT NULL REFERENCES remembered_devices(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_used_at INTEGER NOT NULL,
      PRIMARY KEY(device_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS device_accounts_user ON device_accounts(user_id);
  `);
  const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(row => row.name));
  if (!userColumns.has('is_guest')) db.exec('ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0');
  if (!userColumns.has('initial_password')) db.exec('ALTER TABLE users ADD COLUMN initial_password INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(sessions)').all().some(row => row.name === 'device_id')) db.exec('ALTER TABLE sessions ADD COLUMN device_id TEXT REFERENCES remembered_devices(id) ON DELETE CASCADE');
  db.exec('CREATE INDEX IF NOT EXISTS sessions_device ON sessions(device_id)');
  state.mingliDatabase = { file, db };
  return db;
}

export function transaction<T>(operation: () => T): T {
  const db = database();
  db.exec('BEGIN IMMEDIATE');
  try { const result = operation(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
