'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
function openStore(root) {
  if (!root || !path.isAbsolute(root)) throw new Error('TOPARROW_DATA_DIR must be an absolute writable directory');
  for (const dir of ['db', 'media', 'tmp', 'logs']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  const probe = path.join(root, 'tmp', randomUUID());
  fs.writeFileSync(probe, 'ok', { flag: 'wx' }); fs.unlinkSync(probe);
  const db = new DatabaseSync(path.join(root, 'db', 'stagepilot.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY,name TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',archived INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS screens(id TEXT PRIMARY KEY,activity TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,activity TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,name TEXT NOT NULL,type TEXT NOT NULL,mime TEXT NOT NULL,file TEXT NOT NULL,size INTEGER NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS scenes(id TEXT PRIMARY KEY,activity TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,name TEXT NOT NULL,layout TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,name TEXT NOT NULL,token TEXT NOT NULL,screen TEXT REFERENCES screens(id) ON DELETE SET NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT OR IGNORE INTO migrations VALUES(1);`);
  return { db, root, id: randomUUID,
    all(sql,...args) { return db.prepare(sql).all(...args); },
    get(sql,...args) { return db.prepare(sql).get(...args); },
    run(sql,...args) { return db.prepare(sql).run(...args); },
    setting(key,value) { if(value!==undefined) db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value)); return JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || 'null'); },
    transaction(fn) { db.exec('BEGIN IMMEDIATE');try {const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;} }
  };
}
module.exports = { openStore };
