import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';

export async function getDB(dbPath) {
  const p = dbPath || path.resolve(process.cwd(), 'queue.db');
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = await open({ filename: p, driver: sqlite3.Database });

  await db.exec(`PRAGMA journal_mode = WAL;`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      state TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      next_run_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_error TEXT,
      locked_by INTEGER
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS dlq (
      id TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      max_retries INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      failed_at TEXT NOT NULL,
      last_error TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS workers (
      pid INTEGER PRIMARY KEY,
      started_at TEXT NOT NULL,
      last_heartbeat TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await db.exec(`
    INSERT OR IGNORE INTO config(key,value)
    VALUES ('max_retries','3'),
           ('backoff_base','2');
  `);

  return db;
}

export async function getConfig(db, key) {
  const row = await db.get(`SELECT value FROM config WHERE key=?`, [key]);
  return row ? row.value : null;
}

export async function setConfig(db, key, value) {
  await db.run(
    `INSERT INTO config(key,value)
     VALUES(?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [key, String(value)]
  );
}
