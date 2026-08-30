import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 2;

/** The only kv keys Phase 2 writes (contracts §4.2). */
export const KV_SCHEMA_VERSION = 'schema_version';
export const KV_LAST_TRIM_ID = 'last_trim_id';
export const KV_FIRST_RUN_DONE = 'first_run_done';

/** §8.5's N = 6 counter. The only Phase 3 kv key `@ds/memory` itself writes. */
export const KV_MEM_TURNS_SINCE_EXTRACT = 'mem_turns_since_extract';

/**
 * §8.1's reserved kv key table, in table order: Phase 2's three then Phase 3's eleven. This is a
 * REGISTRY, not a second home — `KV_MODE` (§9.3) is declared by `main/mode-store.ts` and
 * `KV_PROACTIVE_MUTED` (§3.10.4) by `main/proactive-controller.ts`; each owner asserts membership
 * here. Nothing may write a kv key that is not on this list.
 */
export const RESERVED_KV_KEYS = [
  KV_SCHEMA_VERSION,
  KV_LAST_TRIM_ID,
  KV_FIRST_RUN_DONE,
  'sim_snapshot',
  'sim_affection',
  'sim_days_seen',
  'sim_liveliness',
  'sim_phases',
  'sim_proactive_muted',
  'mode',
  'ui_work_mode',
  'ui_sfx_muted',
  'ui_sfx_volume',
  KV_MEM_TURNS_SINCE_EXTRACT,
] as const satisfies readonly string[];

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

/**
 * Migration v1 -> v2 (contracts §8.1). Runs exactly once, inside `migrate()`'s single
 * BEGIN…COMMIT, and only when the stored version is below 2.
 *
 * The Phase 2 `facts` table is written by NOTHING in Phase 2 (Phase 2 contracts §4.2, verbatim:
 * "facts is written by nothing in Phase 2. It exists so the Phase 3 change is additive"), so it is
 * provably empty on every real database. It is still COPIED rather than assumed, and the copy is a
 * no-op when the count is 0. It cannot be ALTERed into shape: SQLite forbids adding a UNIQUE column
 * with ALTER TABLE ADD COLUMN, and `key TEXT UNIQUE` is the upsert key.
 */
export const DDL_V2 = `
CREATE TABLE IF NOT EXISTS facts_v2 (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT    NOT NULL UNIQUE,
  value       TEXT    NOT NULL,
  alias       TEXT    NOT NULL DEFAULT '',
  value_tok   TEXT    NOT NULL DEFAULT '',
  alias_tok   TEXT    NOT NULL DEFAULT '',
  confidence  REAL    NOT NULL DEFAULT 0.7 CHECK (confidence BETWEEN 0 AND 1),
  source_turn INTEGER,
  updated_at  INTEGER NOT NULL,
  tombstone   INTEGER NOT NULL DEFAULT 0 CHECK (tombstone IN (0,1)),
  pinned      INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  history     TEXT    NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO facts_v2 (key, value, value_tok, confidence, source_turn, updated_at)
  SELECT 'legacy:' || id, text, '', 0.6, NULL, ts FROM facts;
-- The copy writes an EMPTY value_tok, because SQL cannot run tok(). \`FactStore\`'s constructor
-- therefore reindexes on open: any row with \`value_tok = ''\` AND \`value <> ''\` is re-tokenised and
-- inserted into facts_fts, once, in one transaction. On every real database this loop runs zero
-- times (the v1 table is provably empty, D-37) -- but a migration that could leave a fact
-- unsearchable is a migration that lies about having migrated it.

DROP TABLE facts;
ALTER TABLE facts_v2 RENAME TO facts;

CREATE INDEX IF NOT EXISTS idx_facts_updated   ON facts(updated_at);
CREATE INDEX IF NOT EXISTS idx_facts_tombstone ON facts(tombstone);

-- R3-10: contentless FTS5 over the TOKENISED columns, unicode61, alias weighted 2.0 at query time.
CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts
  USING fts5(value_tok, alias_tok, content='', tokenize='unicode61');

-- R3-7: the proactive ledger (§3.10.6). The STORE over these rows is packages/memory/src/proactive-log.ts (T3-C).
CREATE TABLE IF NOT EXISTS proactive_log (
  id           TEXT    PRIMARY KEY,
  template_id  TEXT    NOT NULL,
  bucket       TEXT    NOT NULL,
  reserved_at  INTEGER NOT NULL,
  generated_at INTEGER,
  displayed_at INTEGER,
  answered_at  INTEGER,
  outcome      TEXT,
  turn_id      TEXT,
  local_date   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proactive_template ON proactive_log(template_id, displayed_at);
CREATE INDEX IF NOT EXISTS idx_proactive_day      ON proactive_log(local_date, displayed_at);

-- R3-11: the exact wire envelope of every request, stored for AUDIT, never replayed (§8.8).
ALTER TABLE metrics ADD COLUMN envelope TEXT;
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

/** G2-7: the only shape a persisted counter may have — no sign, no leading zero, no exponent. */
const CANONICAL_NON_NEGATIVE_INT = /^(0|[1-9]\d*)$/;

/**
 * G2-7: reads a kv counter as a canonical non-negative safe integer; a missing key is 0. Anything
 * else throws a plain Error — `Number('garbage')` is NaN, which used to sail past the newer-schema
 * check and be overwritten, and a negative or exponent-form `last_trim_id` used to be accepted.
 * openDb wraps the throw in MemoryOpenError (it alone knows the path).
 */
export function readKvInt(db: DatabaseSync, key: string): number {
  const raw = getKv(db, key);
  if (raw === null) return 0;
  const n = Number(raw);
  if (!CANONICAL_NON_NEGATIVE_INT.test(raw) || !Number.isSafeInteger(n)) {
    throw new Error(`数据库里的 ${key} 不是合法的整数：${JSON.stringify(raw)}`);
  }
  return n;
}

/**
 * G2-7 + §8.1: the stored schema version, or 0 when `kv` does not exist yet (a brand-new file).
 * `getKv` prepares `SELECT … FROM kv`, which throws `no such table: kv` before any DDL has run —
 * so the version cannot simply be read first, as §8.1's snippet does. `sqlite_master` always
 * exists, so this asks it whether the read is even possible, and keeps `readKvInt`'s canonical
 * validation for the case where it is.
 */
function storedSchemaVersion(db: DatabaseSync): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'kv'")
    .get() as { n: number };
  return row.n === 0 ? 0 : readKvInt(db, KV_SCHEMA_VERSION);
}

/**
 * Idempotent. Called by openDb; safe to call again on an already-migrated database.
 * Throws a plain Error on a newer stored schema — openDb is what wraps it in a
 * MemoryOpenError, because only openDb knows the path (contracts §4.1).
 *
 * §8.1 restructure: `from` is read FIRST so the version-gated blocks have something to attach to.
 * Two deviations from §8.1's literal snippet, both forced and both covered by db.test.ts:
 *
 *  1. the read is guarded by `storedSchemaVersion` (see above) — reading kv before any DDL throws
 *     on a brand-new file;
 *  2. `DDL_V1` is gated on `from < 2` instead of running unconditionally. §8.1 says it "still runs
 *     for every `from`", but it cannot: its last statement is
 *     `CREATE INDEX IF NOT EXISTS idx_facts_ts ON facts(ts)`, and v2 DROPs the v1 `facts` table
 *     (taking that index with it) and renames `facts_v2` into its place. Replaying DDL_V1 on a v2
 *     database therefore fails with `no such column: ts` — reproduced on a scratch database this
 *     session, and pinned by `db.test.ts` ("re-opening a v2 database is a no-op"). Every DDL_V1
 *     statement is `IF NOT EXISTS` / `INSERT OR IGNORE`, so skipping it at v2 loses nothing.
 */
export function migrate(db: DatabaseSync): void {
  db.exec('BEGIN');
  try {
    const from = storedSchemaVersion(db); // G2-7: malformed -> throws -> MemoryOpenError
    if (from > SCHEMA_VERSION) {
      throw new Error(
        `这个数据库来自更新的版本（schema_version=${from}，本版本支持 ${SCHEMA_VERSION}）`,
      );
    }
    if (from < 2) {
      db.exec(DDL_V1);
      db.exec(DDL_V2);
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
    readKvInt(db, KV_LAST_TRIM_ID); // G2-7: validated at open; HistoryStore trusts it afterwards
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
