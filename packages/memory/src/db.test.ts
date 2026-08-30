import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  KV_FIRST_RUN_DONE,
  KV_LAST_TRIM_ID,
  KV_SCHEMA_VERSION,
  MemoryOpenError,
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

  it('migrate is idempotent and leaves schema_version at 1', () => {
    const path = join(dir, 'ds.sqlite');
    const db = openDb(path); // migrates once
    migrate(db); // twice
    migrate(db); // three times
    expect(SCHEMA_VERSION).toBe(1);
    expect(getKv(db, KV_SCHEMA_VERSION)).toBe('1');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toEqual([
      'facts',
      'kv',
      'messages',
      'metrics',
      'sqlite_sequence',
      'summaries',
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
    setKv(first, KV_SCHEMA_VERSION, '2');
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
    expect(row.value).toBe('2');
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
