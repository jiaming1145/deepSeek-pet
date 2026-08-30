import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DDL_V2,
  KV_FIRST_RUN_DONE,
  KV_LAST_TRIM_ID,
  KV_MEM_TURNS_SINCE_EXTRACT,
  KV_SCHEMA_VERSION,
  MemoryOpenError,
  RESERVED_KV_KEYS,
  SCHEMA_VERSION,
  getKv,
  migrate,
  openDb,
  setKv,
} from './db.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ds-memory-db-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('openDb / migrate', () => {
  it('creates the database file and its missing parent directory', () => {
    const path = join(dir, 'nested', 'deeper', 'ds.sqlite');
    const db = openDb(path);
    expect(existsSync(path)).toBe(true);
    const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(mode.journal_mode).toBe('wal');
    db.close();
  });

  it('migrate is idempotent and leaves schema_version at 2', () => {
    const path = join(dir, 'ds.sqlite');
    const db = openDb(path); // migrates once
    migrate(db); // twice
    migrate(db); // three times
    expect(SCHEMA_VERSION).toBe(2);
    expect(getKv(db, KV_SCHEMA_VERSION)).toBe('2');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    // Verified against a real migration this session. facts_fts_{config,data,docsize,idx} are
    // FTS5's own shadow tables; proactive_log is §3.10.6's ledger (its store is Task 6's).
    expect(tables.map((t) => t.name)).toEqual([
      'facts',
      'facts_fts',
      'facts_fts_config',
      'facts_fts_data',
      'facts_fts_docsize',
      'facts_fts_idx',
      'kv',
      'messages',
      'metrics',
      'proactive_log',
      'sqlite_sequence',
      'summaries',
    ]);
    const idx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(idx.map((i) => i.name)).toEqual([
      'idx_facts_tombstone',
      'idx_facts_updated',
      'idx_messages_ts',
      'idx_messages_turn_id',
      'idx_metrics_ts',
      'idx_proactive_day',
      'idx_proactive_template',
    ]);
    db.close();
  });

  it('seeds exactly one summaries row across repeated migrations', () => {
    const path = join(dir, 'ds.sqlite');
    const db = openDb(path);
    migrate(db);
    const row = db.prepare('SELECT COUNT(*) AS n FROM summaries').get() as { n: number };
    expect(row.n).toBe(1);
    const seed = db
      .prepare('SELECT content, tokens, updated_ts FROM summaries WHERE id = 1')
      .get() as { content: string; tokens: number; updated_ts: number };
    expect(seed.content).toBe('');
    expect(seed.tokens).toBe(0);
    expect(seed.updated_ts).toBe(0);
    db.close();
  });

  it('kv helpers round-trip and return null for a missing key', () => {
    const db = openDb(join(dir, 'ds.sqlite'));
    expect(getKv(db, KV_FIRST_RUN_DONE)).toBe(null);
    setKv(db, KV_FIRST_RUN_DONE, '1');
    expect(getKv(db, KV_FIRST_RUN_DONE)).toBe('1');
    setKv(db, KV_FIRST_RUN_DONE, '2');
    expect(getKv(db, KV_FIRST_RUN_DONE)).toBe('2');
    db.close();
  });

  it('throws MemoryOpenError naming the path when the file cannot be opened', () => {
    // `dir` is a directory: sqlite cannot open it as a database file.
    let caught: unknown = null;
    try {
      openDb(dir);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MemoryOpenError);
    const e = caught as MemoryOpenError;
    expect(e.name).toBe('MemoryOpenError');
    expect(e.code).toBe('memory-open');
    expect(e.path).toBe(dir);
    expect(e.message.startsWith('无法打开数据库：')).toBe(true);
    expect(e.message.includes(dir)).toBe(true);
  });

  it('throws MemoryOpenError when the stored schema version is newer', () => {
    const path = join(dir, 'ds.sqlite');
    const first = openDb(path);
    setKv(first, KV_SCHEMA_VERSION, '3');
    first.close();

    let caught: unknown = null;
    try {
      openDb(path);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MemoryOpenError);
    expect((caught as MemoryOpenError).message.includes('这个数据库来自更新的版本')).toBe(true);

    // the guard must not have written the version back down
    const raw = new DatabaseSync(path);
    const row = raw.prepare('SELECT value FROM kv WHERE key = ?').get(KV_SCHEMA_VERSION) as {
      value: string;
    };
    expect(row.value).toBe('3');
    raw.close();
  });

  describe('G2-7: kv counters are validated as canonical non-negative safe integers at open', () => {
    const seed = (key: string, value: string): string => {
      const path = join(dir, 'ds.sqlite');
      const db = openDb(path);
      setKv(db, key, value);
      db.close();
      return path;
    };

    it.each([
      ['non-numeric', 'garbage'],
      ['negative', '-1'],
      ['leading zero', '01'],
      ['exponent form', '1e3'],
      ['fraction', '1.5'],
      ['signed', '+2'],
      ['whitespace', ' 2'],
      ['beyond safe integer', '9007199254740993'],
      ['empty', ''],
    ])('rejects a %s last_trim_id (%s) with MemoryOpenError', (_label, value) => {
      const path = seed(KV_LAST_TRIM_ID, value);
      expect(() => openDb(path)).toThrow(MemoryOpenError);
    });

    it('rejects a garbage schema_version instead of silently overwriting it', () => {
      const path = seed(KV_SCHEMA_VERSION, 'garbage');
      expect(() => openDb(path)).toThrow(MemoryOpenError);
      const raw = new DatabaseSync(path);
      expect(getKv(raw, KV_SCHEMA_VERSION)).toBe('garbage'); // left as found, not rewritten to 1
      raw.close();
    });

    it('accepts canonical values and a missing last_trim_id', () => {
      const path = seed(KV_LAST_TRIM_ID, '42');
      const db = openDb(path);
      expect(getKv(db, KV_LAST_TRIM_ID)).toBe('42');
      db.close();
      const fresh = openDb(join(dir, 'fresh.sqlite'));
      expect(getKv(fresh, KV_LAST_TRIM_ID)).toBe(null);
      fresh.close();
    });
  });
});

describe('schema v2 migration (contracts §8.1)', () => {
  /** Builds a real v1 database: Phase 2's DDL, a legacy fact row, schema_version = 1. */
  const seedV1 = (): string => {
    const path = join(dir, 'ds.sqlite');
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user','assistant')), content TEXT NOT NULL,
        turn_id TEXT, kind TEXT NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat','proactive','system')),
        interrupted INTEGER NOT NULL DEFAULT 0 CHECK (interrupted IN (0,1)), tokens INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE summaries (
        id INTEGER PRIMARY KEY CHECK (id = 1), content TEXT NOT NULL DEFAULT '',
        tokens INTEGER NOT NULL DEFAULT 0, updated_ts INTEGER NOT NULL DEFAULT 0);
      INSERT INTO summaries (id, content, tokens, updated_ts) VALUES (1, '旧摘要。', 3, 9);
      CREATE TABLE facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, text TEXT NOT NULL,
        importance INTEGER NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10), source_turn_id TEXT);
      CREATE INDEX idx_facts_ts ON facts(ts);
      CREATE TABLE metrics (
        turn_id TEXT PRIMARY KEY, ts INTEGER NOT NULL, ttft_ms INTEGER, total_ms INTEGER NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0, cache_hit INTEGER NOT NULL DEFAULT 0,
        cache_miss INTEGER NOT NULL DEFAULT 0, completion INTEGER NOT NULL DEFAULT 0,
        compliance_miss INTEGER NOT NULL DEFAULT 0 CHECK (compliance_miss IN (0,1)),
        regenerated INTEGER NOT NULL DEFAULT 0 CHECK (regenerated IN (0,1)),
        sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0,1)),
        lint TEXT NOT NULL DEFAULT '[]', error_code TEXT);
      INSERT INTO facts (ts, text, importance, source_turn_id) VALUES (1700, '旧事实', 7, 't9');
      INSERT INTO kv (key, value) VALUES ('schema_version', '1');
      INSERT INTO kv (key, value) VALUES ('last_trim_id', '5');
    `);
    db.close();
    return path;
  };

  it('carries a v1 file to v2: the legacy fact is copied, not lost, and nothing else moves', () => {
    const path = seedV1();
    const db = openDb(path);

    expect(getKv(db, KV_SCHEMA_VERSION)).toBe('2');
    expect(getKv(db, KV_LAST_TRIM_ID)).toBe('5'); // untouched by the migration

    const rows = db.prepare('SELECT * FROM facts').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'legacy:1',
      value: '旧事实',
      alias: '',
      value_tok: '', // SQL cannot run tok(); FactStore's constructor reindexes it (§8.1)
      alias_tok: '',
      confidence: 0.6,
      source_turn: null,
      updated_at: 1700,
      tombstone: 0,
      pinned: 0,
      history: '',
    });

    // the summary survives; `messages` and `metrics` keep every v1 column
    const sum = db.prepare('SELECT content FROM summaries WHERE id = 1').get() as {
      content: string;
    };
    expect(sum.content).toBe('旧摘要。');
    const cols = (
      db.prepare("SELECT name FROM pragma_table_info('metrics')").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toEqual([
      'turn_id',
      'ts',
      'ttft_ms',
      'total_ms',
      'prompt_tokens',
      'cache_hit',
      'cache_miss',
      'completion',
      'compliance_miss',
      'regenerated',
      'sensitive',
      'lint',
      'error_code',
      'envelope',
    ]);
    db.close();
  });

  it('re-opening a v2 database is a no-op — DDL_V1 is never replayed over the v2 facts table', () => {
    // The regression this pins, reproduced this session on a scratch database: DDL_V1 ends with
    // `CREATE INDEX IF NOT EXISTS idx_facts_ts ON facts(ts)`. v2 DROPs the v1 `facts` table (and
    // with it that index) and renames facts_v2 into its place, so a replay of DDL_V1 finds the
    // index missing and the column gone: `SqliteError: no such column: ts`.
    const path = seedV1();
    const first = openDb(path);
    first.close();
    const again = openDb(path); // would throw MemoryOpenError('no such column: ts') if DDL_V1 replayed
    expect(getKv(again, KV_SCHEMA_VERSION)).toBe('2');
    expect((again.prepare('SELECT COUNT(*) AS n FROM facts').get() as { n: number }).n).toBe(1);
    migrate(again); // and again, in-process
    expect((again.prepare('SELECT COUNT(*) AS n FROM facts').get() as { n: number }).n).toBe(1);
    again.close();
  });

  it('a brand-new file goes straight to v2 with an empty facts table and a usable FTS index', () => {
    const db = openDb(join(dir, 'fresh.sqlite'));
    expect(getKv(db, KV_SCHEMA_VERSION)).toBe('2');
    expect((db.prepare('SELECT COUNT(*) AS n FROM facts').get() as { n: number }).n).toBe(0);
    db.prepare('INSERT INTO facts_fts (rowid, value_tok, alias_tok) VALUES (?, ?, ?)').run(
      1,
      '面 面试 试',
      '工 工作 作',
    );
    const hit = db
      .prepare(`SELECT COUNT(*) AS n FROM facts_fts WHERE facts_fts MATCH '"面试"'`)
      .get() as { n: number };
    expect(hit.n).toBe(1);
    db.close();
  });

  it('the facts table enforces the v2 shape (UNIQUE key, confidence and flag CHECKs)', () => {
    const db = openDb(join(dir, 'ds.sqlite'));
    const ins = db.prepare(
      'INSERT INTO facts (key, value, updated_at, confidence) VALUES (?, ?, ?, ?)',
    );
    ins.run('job_interview', '主人下周三要去杭州面试', 1, 0.9);
    expect(() => ins.run('job_interview', '别的', 2, 0.9)).toThrow(); // UNIQUE key
    expect(() => ins.run('k2', 'v', 3, 1.5)).toThrow(); // confidence BETWEEN 0 AND 1
    expect(() =>
      db
        .prepare('INSERT INTO facts (key, value, updated_at, tombstone) VALUES (?,?,?,?)')
        .run('k3', 'v', 4, 2),
    ).toThrow(); // tombstone IN (0,1)
    db.close();
  });

  it('the proactive ledger table exists with §3.10.6 columns (its store is Task 6)', () => {
    const db = openDb(join(dir, 'ds.sqlite'));
    const cols = (
      db.prepare("SELECT name FROM pragma_table_info('proactive_log')").all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    expect(cols).toEqual([
      'id',
      'template_id',
      'bucket',
      'reserved_at',
      'generated_at',
      'displayed_at',
      'answered_at',
      'outcome',
      'turn_id',
      'local_date',
    ]);
    db.close();
  });

  it('pins §8.1’s reserved kv key list and the one key this task owns', () => {
    expect(KV_MEM_TURNS_SINCE_EXTRACT).toBe('mem_turns_since_extract');
    expect(RESERVED_KV_KEYS).toEqual([
      'schema_version',
      'last_trim_id',
      'first_run_done',
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
      'mem_turns_since_extract',
    ]);
    // The registry is documentation, not a second home: each key's OWNER declares its own constant
    // (KV_MODE is Task 6's, KV_PROACTIVE_MUTED is Task 14's). Only the memory keys live here.
    expect(RESERVED_KV_KEYS).toContain(KV_SCHEMA_VERSION);
    expect(RESERVED_KV_KEYS).toContain(KV_LAST_TRIM_ID);
    expect(RESERVED_KV_KEYS).toContain(KV_FIRST_RUN_DONE);
    expect(new Set(RESERVED_KV_KEYS).size).toBe(RESERVED_KV_KEYS.length);
  });

  it('DDL_V2 names every object the migration creates', () => {
    for (const name of [
      'facts_v2',
      'facts_fts',
      'proactive_log',
      'idx_facts_updated',
      'idx_facts_tombstone',
      'idx_proactive_template',
      'idx_proactive_day',
      'ALTER TABLE metrics ADD COLUMN envelope',
    ]) {
      expect(DDL_V2).toContain(name);
    }
    expect(DDL_V2).toContain(`tokenize='unicode61'`); // R3-10: trigram is unusable for Chinese (§0.3)
    expect(DDL_V2).not.toContain('trigram');
  });
});
