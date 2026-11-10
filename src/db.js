'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR, DB_FILE } = require('./config');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id           TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'queued',
    n            INTEGER NOT NULL,
    max_iter     INTEGER NOT NULL,
    tol          REAL NOT NULL,
    progress     INTEGER NOT NULL DEFAULT 0,
    stage        TEXT NOT NULL DEFAULT 'у черзі',
    iterations   INTEGER NOT NULL DEFAULT 0,
    delta        REAL,
    residual     REAL,
    omega        REAL NOT NULL DEFAULT 1,
    result_json  TEXT,
    error        TEXT,
    worker_id    TEXT,
    cancel_flag  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    started_at   TEXT,
    finished_at  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_user   ON jobs(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

  CREATE TABLE IF NOT EXISTS job_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS worker_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id  TEXT NOT NULL,
    action     TEXT NOT NULL,
    detail     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/** Міграція для баз, створених попередніми версіями. */
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('jobs', 'delta', 'REAL');
ensureColumn('jobs', 'omega', 'REAL NOT NULL DEFAULT 1');

function logEvent(jobId, message) {
  db.prepare('INSERT INTO job_events (job_id, message) VALUES (?, ?)').run(jobId, message);
}

function logWorker(workerId, action, detail = '') {
  db.prepare('INSERT INTO worker_log (worker_id, action, detail) VALUES (?, ?, ?)').run(
    workerId, action, detail
  );
}

module.exports = { db, logEvent, logWorker, DB_FILE, DATA_DIR };
