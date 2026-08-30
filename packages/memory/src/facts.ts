import type { DatabaseSync } from 'node:sqlite';
import { sanitizeMemoryText } from './summary.ts';
import { toMatchQuery, tok, tokBigram, tokUnigram } from './tok.ts';

export const FACT_MAX_CHARS = 120; // R3-10 sanitisation bound; identical to MEMORY_LABEL_MAX
export const FACT_MIN_CONFIDENCE = 0.6; // R3-10: "<= 5 facts with confidence >= 0.6"
export const FACT_RETRIEVE_MAX = 5; // bar §0: "<= 5 retrieved facts"
export const FACT_FALLBACK_MIN_HITS = 3; // R3-10: "unigram fallback if < 3 hits"

/**
 * §8.5's dedup threshold, same primitive (bigramSet/jaccard) and same number as §4.8's
 * NEAR_DUPLICATE_JACCARD. The two live in different packages (`@ds/memory` here,
 * `apps/desktop/src/main/proactive-templates.ts` there, Task 6) and `@ds/memory` must not import
 * from `apps/desktop`. Task 6 owns the identity assertion — see Concern C-7.
 */
export const FACT_MERGE_JACCARD = 0.6;

/** §8.2: `history` is a newline-joined list of superseded values, capped at 5 (oldest dropped). */
export const FACT_HISTORY_MAX = 5;

const ALIAS_MAX = 24; // matches ExtractedFactSchema.alias's per-entry bound (§8.5)
const RETRIEVE_CANDIDATES = 20; // the `LIMIT 20` of §8.4's two passes
const RECENCY_PER_HOUR = 0.995; // spec §6's shape, kept by R3-10

/**
 * §8.4: applied ONLY to the unigram fallback pass, where it stops a query collapsing to "every fact
 * that contains 的". Forty high-frequency Chinese function characters plus the ASCII stop list.
 * CONTRACT GAP: §8.4 names the 40 CJK entries verbatim but only says "plus the ASCII stop list";
 * the classic 22-word English list is used (Concern C-6).
 */
export const STOPWORDS: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    ...'的了是我你他她它们在有和就不人都一个上也很到说要去会着没看好自这那么什吗呢吧啊把',
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'but',
    'by',
    'for',
    'if',
    'in',
    'is',
    'it',
    'of',
    'on',
    'or',
    'that',
    'the',
    'to',
    'was',
    'with',
  ]),
) as ReadonlySet<string>;

export interface FactRow {
  id: number;
  key: string;
  value: string;
  alias: string;
  confidence: number;
  sourceTurn: number | null;
  updatedAt: number;
  tombstone: boolean;
  pinned: boolean;
  history: string;
}

export interface FactUpsert {
  key: string;
  value: string;
  alias: string[];
  confidence: number;
  sourceTurn: number | null;
}

/** The raw shape `SELECT * FROM facts` hands back — a type alias, not an interface (TS2352). */
type RawFact = {
  id: number;
  key: string;
  value: string;
  alias: string;
  value_tok: string;
  alias_tok: string;
  confidence: number;
  source_turn: number | null;
  updated_at: number;
  tombstone: number;
  pinned: number;
  history: string;
};

type Candidate = {
  id: number;
  value: string;
  confidence: number;
  updated_at: number;
  pinned: number;
  score: number;
};

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

const toRow = (r: RawFact): FactRow => ({
  id: r.id,
  key: r.key,
  value: r.value,
  alias: r.alias,
  confidence: r.confidence,
  sourceTurn: r.source_turn,
  updatedAt: r.updated_at,
  tombstone: r.tombstone === 1,
  pinned: r.pinned === 1,
  history: r.history,
});

/**
 * Tier 3 of spec §6 — the fact store R3-10 specifies (contracts §8.2, §8.4).
 *
 * Nothing is ever DELETEd: a contradicting value updates in place with provenance, a forgotten fact
 * is tombstoned. That is what keeps "以前喜欢拿铁" answerable.
 *
 * `value_tok` / `alias_tok` are stored as REAL COLUMNS as well as in the index, because `facts_fts`
 * is contentless (`content=''`): SQLite cannot recover the old tokens itself, so retiring an index
 * row requires the caller to supply them — and it makes the index rebuildable from the table alone.
 */
export class FactStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(db: DatabaseSync, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
    this.reindexMigratedRows();
  }

  /**
   * §8.1: DDL_V2's copy writes an EMPTY `value_tok` because SQL cannot run `tok()`. Any row with
   * `value_tok = ''` AND `value <> ''` is re-tokenised and inserted into `facts_fts`, once, in one
   * transaction. On every real database this runs zero times (the v1 `facts` table is provably
   * empty) — but a migration that could leave a fact unsearchable is a migration that lies about
   * having migrated it.
   */
  private reindexMigratedRows(): void {
    const rows = this.db
      .prepare("SELECT id, value, alias FROM facts WHERE value_tok = '' AND value <> ''")
      .all() as Array<{ id: number; value: string; alias: string }>;
    if (rows.length === 0) return;
    this.tx(() => {
      const upd = this.db.prepare('UPDATE facts SET value_tok = ?, alias_tok = ? WHERE id = ?');
      const ins = this.db.prepare(
        'INSERT INTO facts_fts (rowid, value_tok, alias_tok) VALUES (?, ?, ?)',
      );
      for (const r of rows) {
        const valueTok = tok(r.value);
        const aliasTok = tok(r.alias);
        upd.run(valueTok, aliasTok, r.id);
        ins.run(r.id, valueTok, aliasTok);
      }
    });
  }

  /**
   * Runs `fn` inside one BEGIN…COMMIT, with the ROLLBACK guard every write path here needs.
   *
   * FIX ROUND 1, finding 3. `facts` and the CONTENTLESS `facts_fts` are two stores that must agree:
   * retiring an index row means handing FTS5 the OLD tokens by hand, so a throw between the
   * `'delete'`, the `UPDATE` and the re-`INSERT` leaves a fact that is live in the table and absent
   * from the index — unsearchable forever, since `reindexMigratedRows` only repairs rows whose
   * `value_tok` is `''`. node:sqlite autocommits each statement, so nothing but an explicit
   * transaction closes that window.
   *
   * A call that is ALREADY inside a transaction joins it rather than failing with
   * "cannot start a transaction within a transaction": the outer BEGIN is the wider guarantee.
   */
  private tx<T>(fn: () => T): T {
    if (this.db.isTransaction) return fn();
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // the failing statement already rolled the transaction back; keep the original error
      }
      throw err;
    }
  }

  /** Upsert by `key`. A contradicting value updates IN PLACE with provenance (R3-10). */
  upsert(f: FactUpsert): { id: number; changed: boolean } {
    const value = sanitizeMemoryText(f.value, FACT_MAX_CHARS);
    const alias = f.alias
      .map((a) => sanitizeMemoryText(a, ALIAS_MAX))
      .filter((a) => a !== '')
      .join(' ');
    const valueTok = tok(value);
    const aliasTok = tok(alias);
    const confidence = clamp01(f.confidence);
    const ts = this.now();

    const existing = this.db
      .prepare('SELECT id, value, alias, value_tok, alias_tok, history FROM facts WHERE key = ?')
      .get(f.key) as
      | {
          id: number;
          value: string;
          alias: string;
          value_tok: string;
          alias_tok: string;
          history: string;
        }
      | undefined;

    if (existing === undefined) {
      return this.tx(() => {
        const res = this.db
          .prepare(
            'INSERT INTO facts (key, value, alias, value_tok, alias_tok, confidence, source_turn, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(f.key, value, alias, valueTok, aliasTok, confidence, f.sourceTurn, ts);
        const id = Number(res.lastInsertRowid);
        this.db
          .prepare('INSERT INTO facts_fts (rowid, value_tok, alias_tok) VALUES (?, ?, ?)')
          .run(id, valueTok, aliasTok);
        return { id, changed: true };
      });
    }

    if (existing.value === value && existing.alias === alias) {
      // Nothing to retire and nothing to remember: only the metadata moves.
      this.db
        .prepare(
          'UPDATE facts SET confidence = ?, source_turn = ?, updated_at = ?, tombstone = 0 WHERE id = ?',
        )
        .run(confidence, f.sourceTurn, ts, existing.id);
      return { id: existing.id, changed: false };
    }

    const history =
      existing.value === value
        ? existing.history
        : [...(existing.history === '' ? [] : existing.history.split('\n')), existing.value]
            .slice(-FACT_HISTORY_MAX)
            .join('\n');
    return this.tx(() => {
      // Contentless FTS5: the old tokens must be handed back before the row can be re-indexed.
      this.db
        .prepare(
          `INSERT INTO facts_fts (facts_fts, rowid, value_tok, alias_tok) VALUES ('delete', ?, ?, ?)`,
        )
        .run(existing.id, existing.value_tok, existing.alias_tok);
      this.db
        .prepare(
          'UPDATE facts SET value = ?, alias = ?, value_tok = ?, alias_tok = ?, confidence = ?, source_turn = ?, updated_at = ?, tombstone = 0, history = ? WHERE id = ?',
        )
        .run(value, alias, valueTok, aliasTok, confidence, f.sourceTurn, ts, history, existing.id);
      this.db
        .prepare('INSERT INTO facts_fts (rowid, value_tok, alias_tok) VALUES (?, ?, ?)')
        .run(existing.id, valueTok, aliasTok);
      return { id: existing.id, changed: true };
    });
  }

  /** Tombstones instead of deleting (R3-10). The FTS row STAYS; retrieval filters on tombstone = 0. */
  tombstone(id: number): void {
    this.db.prepare('UPDATE facts SET tombstone = 1 WHERE id = ?').run(id);
  }

  /** X4's 记住这个: confidence 0.95, pinned 1. */
  pin(key: string, value: string, sourceTurn: number | null): number {
    const { id } = this.upsert({ key, value, alias: [], confidence: 0.95, sourceTurn });
    this.db.prepare('UPDATE facts SET pinned = 1, confidence = 0.95 WHERE id = ?').run(id);
    return id;
  }

  /**
   * The two-pass retrieval of §8.4. Returns <= FACT_RETRIEVE_MAX sanitised value strings.
   *
   * Pass 1 is the BIGRAM query (`tokBigram`), pass 2 the unigram fallback minus STOPWORDS. See
   * `tokBigram`'s comment for why pass 1 stopped being `tok(query)` in fix round 1 (finding 2):
   * with unigrams in pass 1 the fallback was unreachable by construction and STOPWORDS was dead.
   */
  retrieve(query: string, nowWall: number): string[] {
    const pass1 = this.match(toMatchQuery(tokBigram(query)));
    const rows =
      pass1.length >= FACT_FALLBACK_MIN_HITS
        ? pass1
        : this.merge(pass1, this.match(toMatchQuery(this.fallbackTokens(query))));

    return rows
      .map((r) => ({
        r,
        rank: -r.score * (0.5 + r.confidence) * RECENCY_PER_HOUR ** this.hoursOld(r, nowWall),
      }))
      .sort((a, b) => b.r.pinned - a.r.pinned || b.rank - a.rank)
      .slice(0, FACT_RETRIEVE_MAX)
      .map((x) => sanitizeMemoryText(x.r.value, FACT_MAX_CHARS)); // idempotent; the write path already did it
  }

  /** X4: the whole non-tombstoned set, newest first, for export and the Phase 4 记忆 tab. */
  list(includeTombstoned = false): FactRow[] {
    const sql = includeTombstoned
      ? 'SELECT * FROM facts ORDER BY updated_at DESC, id DESC'
      : 'SELECT * FROM facts WHERE tombstone = 0 ORDER BY updated_at DESC, id DESC';
    return (this.db.prepare(sql).all() as RawFact[]).map(toRow);
  }

  /**
   * X4 one-click wipe: §8.9's normative sentence, "tombstones every fact". Returns the row count.
   *
   * FIX ROUND 1, finding 1. This used to follow the UPDATE with
   * `INSERT INTO facts_fts (facts_fts) VALUES ('delete-all')`, which emptied the contentless index
   * while leaving every `value_tok` / `alias_tok` in `facts` — so the next `upsert()` of a key that
   * existed before the wipe handed FTS5 a `'delete'` for tokens that were no longer in the index
   * and threw `database disk image is malformed` (SQLITE_CORRUPT, errcode 267) BEFORE the UPDATE:
   * the new value was lost and that key became permanently un-updatable. Keys are stable
   * identifiers by design (`job_interview`, `pet_name`), so it fired on the first extraction after
   * the wipe. Reproduced on a scratch database this session; pinned by facts.test.ts below.
   *
   * A wipe is therefore exactly a BULK `tombstone()`, and it keeps that method's documented
   * semantics: the FTS rows STAY and retrieval filters `f.tombstone = 0`. Nothing is leaked — the
   * values themselves are deliberately kept in `facts` (§8.9 wipes memory, not the row), so an
   * index over them is not a second copy of anything, and table and index never diverge.
   * DEVIATION: §8.2's doc comment says "and clears the FTS index"; that clause is what corrupts.
   */
  wipe(): number {
    return this.db.prepare('UPDATE facts SET tombstone = 1 WHERE tombstone = 0').run()
      .changes as number;
  }

  // ---- internal ----------------------------------------------------------

  private hoursOld(r: Candidate, nowWall: number): number {
    return Math.max(0, (nowWall - r.updated_at) / 3_600_000);
  }

  /** §8.4's second pass query: unigrams minus STOPWORDS. */
  private fallbackTokens(query: string): string {
    return tokUnigram(query)
      .split(' ')
      .filter((t) => t !== '' && !STOPWORDS.has(t))
      .join(' ');
  }

  /**
   * §8.4's statement, byte-identical for both passes. `bm25()` returns NEGATIVE scores, so
   * `ORDER BY score ASC` IS best-first. An empty match string is a FTS5 syntax error, never a
   * no-op, so it short-circuits here.
   */
  private match(matchQuery: string): Candidate[] {
    if (matchQuery === '') return [];
    return this.db
      .prepare(
        `SELECT f.id, f.value, f.confidence, f.updated_at, f.pinned,
                bm25(facts_fts, 1.0, 2.0) AS score
           FROM facts_fts
           JOIN facts f ON f.id = facts_fts.rowid
          WHERE facts_fts MATCH ?1
            AND f.tombstone = 0
            AND f.confidence >= ?2
          ORDER BY score ASC
          LIMIT ${RETRIEVE_CANDIDATES}`,
      )
      .all(matchQuery, FACT_MIN_CONFIDENCE) as Candidate[];
  }

  /** Pass 1's rows keep their (better) bigram score; pass 2 only adds rows pass 1 did not find. */
  private merge(first: Candidate[], second: Candidate[]): Candidate[] {
    const seen = new Set(first.map((r) => r.id));
    return [...first, ...second.filter((r) => !seen.has(r.id))].slice(0, RETRIEVE_CANDIDATES);
  }
}
