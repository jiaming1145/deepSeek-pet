import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;

/** The only kv keys Phase 2 writes (contracts §4.2). */
export const KV_SCHEMA_VERSION = 'schema_version';
export const KV_LAST_TRIM_ID = 'last_trim_id';
export const KV_FIRST_RUN_DONE = 'first_run_done';

export class MemoryOpenError extends Error {
  readonly code = 'memory-open';
  readonly path: string;
  constructor(path: string, cause: unknown) {
    super(`无法打开数据库：${path}\n${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'MemoryOpenError';
    this.path = path;
    this.cause = cause;
  }
}

/**
 * Schema version 1. Forward migrations append `if (from < N) { … }` blocks below;
 * never rewrite this DDL. Phase 2 ships no FTS5 table — history search is Phase 3+
 * and is additive (a virtual table plus triggers, no change to these tables).
 */
const DDL_V1 = `
CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  role        TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content     TEXT    NOT NULL,
  turn_id     TEXT,
  kind        TEXT    NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat','proactive','system')),
  interrupted INTEGER NOT NULL DEFAULT 0 CHECK (interrupted IN (0,1)),
  tokens      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_ts      ON messages(ts);
CREATE INDEX IF NOT EXISTS idx_messages_turn_id ON messages(turn_id);

CREATE TABLE IF NOT EXISTS summaries (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  content    TEXT    NOT NULL DEFAULT '',
  tokens     INTEGER NOT NULL DEFAULT 0,
  updated_ts INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO summaries (id, content, tokens, updated_ts) VALUES (1, '', 0, 0);

CREATE TABLE IF NOT EXISTS facts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             INTEGER NOT NULL,
  text           TEXT    NOT NULL,
  importance     INTEGER NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  source_turn_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_facts_ts ON facts(ts);

CREATE TABLE IF NOT EXISTS metrics (
  turn_id         TEXT PRIMARY KEY,
  ts              INTEGER NOT NULL,
  ttft_ms         INTEGER,
  total_ms        INTEGER NOT NULL,
  prompt_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_hit       INTEGER NOT NULL DEFAULT 0,
  cache_miss      INTEGER NOT NULL DEFAULT 0,
  completion      INTEGER NOT NULL DEFAULT 0,
  compliance_miss INTEGER NOT NULL DEFAULT 0 CHECK (compliance_miss IN (0,1)),
  regenerated     INTEGER NOT NULL DEFAULT 0 CHECK (regenerated IN (0,1)),
  sensitive       INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0,1)),
  lint            TEXT    NOT NULL DEFAULT '[]',
  error_code      TEXT
);
CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics(ts);
`;

export function getKv(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row === undefined ? null : row.value;
}

export function setKv(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, value);
}

/**
 * Idempotent. Called by openDb; safe to call again on an already-migrated database.
 * Throws a plain Error on a newer stored schema — openDb is what wraps it in a
 * MemoryOpenError, because only openDb knows the path (contracts §4.1).
 */
export function migrate(db: DatabaseSync): void {
  db.exec('BEGIN');
  try {
    db.exec(DDL_V1);
    const stored = Number(getKv(db, KV_SCHEMA_VERSION) ?? '0');
    if (stored > SCHEMA_VERSION) {
      throw new Error(
        `这个数据库来自更新的版本（schema_version=${stored}，本版本支持 ${SCHEMA_VERSION}）`,
      );
    }
    setKv(db, KV_SCHEMA_VERSION, String(SCHEMA_VERSION));
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // the failing statement already rolled the transaction back; keep the original error
    }
    throw err;
  }
}

/**
 * Opens the history database, creating the directory and the schema if needed.
 * Any failure — a bad path, a locked file, a database from a newer build — is
 * wrapped in MemoryOpenError. The caller in apps/desktop/src/main/index.ts (T6)
 * shows a blocking dialog and quits: the app never runs without persistence (spec §8).
 */
export function openDb(path: string): DatabaseSync {
  let db: DatabaseSync | null = null;
  try {
    mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    return db;
  } catch (cause) {
    if (db !== null) {
      try {
        db.close();
      } catch {
        // the handle is already unusable; the open error is what matters
      }
    }
    throw new MemoryOpenError(path, cause);
  }
}
