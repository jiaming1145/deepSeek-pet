import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../db.ts';
import { FACT_FALLBACK_MIN_HITS, FactStore } from '../../facts.ts';
import { toMatchQuery, tokBigram } from '../../tok.ts';
import { B12_CORPUS, B12_NOW, B12_PROBES } from './fts-paraphrase.fixture.ts';

let dir: string;
let db: DatabaseSync;
let store: FactStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ds-memory-b12-'));
  db = openDb(join(dir, 'ds.sqlite'));
  store = new FactStore(db, () => B12_NOW);
  for (const f of B12_CORPUS) {
    store.upsert({
      key: f.key,
      value: f.value,
      alias: f.alias,
      confidence: f.confidence,
      sourceTurn: null,
    });
  }
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('B-12 memory/fts-paraphrase (contracts §12.7, §0.3 control corpus)', () => {
  it.each(B12_PROBES)('$ask -> $expectKey (via $via)', (probe) => {
    const out = store.retrieve(probe.ask, B12_NOW);
    if (probe.expectKey === null) {
      expect(out).toEqual([]);
      return;
    }
    const expected = B12_CORPUS.find((f) => f.key === probe.expectKey);
    expect(expected).toBeDefined();
    expect(out[0]).toBe(expected?.value);
  });

  it('腰疼 and 咖啡 match through the ALIAS column only — the value carries neither string', () => {
    for (const [ask, key] of [
      ['腰疼', 'health_back'],
      ['咖啡', 'drink_coffee'],
    ] as const) {
      const fact = B12_CORPUS.find((f) => f.key === key);
      expect(fact?.value.includes(ask)).toBe(false);
      expect(fact?.alias).toContain(ask);
      expect(store.retrieve(ask, B12_NOW)[0]).toBe(fact?.value);
    }
  });

  it('bm25(facts_fts, 1.0, 2.0) returns negative scores, best-first, for every hitting probe', () => {
    // The statement and the binding are §8.4's PASS 1, verbatim: ?1 = toMatchQuery(tokBigram(ask)).
    // FIX ROUND 1, finding 2 — this used to bind tok(ask), which is the INDEXING form and carries
    // unigrams too, so it was not the query the store actually runs.
    const sql = db.prepare(
      `SELECT bm25(facts_fts, 1.0, 2.0) AS score FROM facts_fts
         JOIN facts f ON f.id = facts_fts.rowid
        WHERE facts_fts MATCH ?1 AND f.tombstone = 0 AND f.confidence >= 0.6
        ORDER BY score ASC LIMIT 20`,
    );
    for (const probe of B12_PROBES.filter((p) => p.expectKey !== null)) {
      const rows = sql.all(toMatchQuery(tokBigram(probe.ask))) as Array<{ score: number }>;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].score).toBeLessThan(0);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].score).toBeGreaterThanOrEqual(rows[i - 1].score);
      }
    }
  });

  it('pass 1 returns fewer than FACT_FALLBACK_MIN_HITS on this corpus, so every probe uses the fallback', () => {
    // FIX ROUND 1, finding 2: pass 1 is the BIGRAM query. Counting with tok() (unigrams included)
    // measured a query the store never runs, and — because that query was a strict superset of the
    // fallback's — the fallback it claimed to prove could never add a row to begin with.
    const count = db.prepare(
      `SELECT COUNT(*) AS n FROM facts_fts JOIN facts f ON f.id = facts_fts.rowid
        WHERE facts_fts MATCH ?1 AND f.tombstone = 0 AND f.confidence >= 0.6`,
    );
    for (const probe of B12_PROBES) {
      const q = toMatchQuery(tokBigram(probe.ask));
      const n = q === '' ? 0 : (count.get(q) as { n: number }).n;
      expect(n < FACT_FALLBACK_MIN_HITS).toBe(probe.expectFallback);
    }
    // …and the fallback genuinely reaches rows pass 1 cannot: 冰 alone is a single character, so it
    // has no bigram at all and only pass 2 can answer it.
    expect(toMatchQuery(tokBigram('冰'))).toBe('');
    expect(store.retrieve('冰', B12_NOW)).toEqual(['主人喜欢喝冰美式']);
    // …and the fallback still returns nothing for 医院: neither 医 nor 院 is anywhere in the corpus.
    expect(store.retrieve('医院', B12_NOW)).toEqual([]);
  });
});
