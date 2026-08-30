import type { DatabaseSync } from 'node:sqlite';
import { estimateTokens } from '@ds/brain';
import type {
  ChatMessage,
  HistoryPort,
  MessageKind,
  MessageMeta,
  MetricsPort,
  MetricsRecord,
  Role,
  Summarize,
  TrimPlan,
} from '@ds/brain';
import type { HistoryRow } from '@ds/protocol';
import { KV_LAST_TRIM_ID, readKvInt, setKv } from './db.ts';
import type { FactStore } from './facts.ts';
import { capSummary, type RunningSummary } from './summary.ts';

/**
 * Safety net only. It sits ABOVE planTrim's 24_000 trigger on purpose: planTrim
 * (called by TurnRunner.send, contracts §3.8.4) is the real trimmer, and if this
 * net cut the window down to 24_000 first, plan.drop would always be empty and the
 * running summary could never refresh.
 */
export const HISTORY_WINDOW_SAFETY_TOKENS = 32_000;

/**
 * GC-1: a trim summarises EVERY row between the old pointer and the cutoff — the prefix that the
 * safety truncation kept out of `window()` included — in sequential chunks of at most this many
 * estimated tokens. planTrim's own window budget (24_000) is the natural bound for one
 * summariser call.
 */
export const TRIM_CHUNK_TOKENS = 24_000;

const DEFAULT_LIST_LIMIT = 50;
const LIST_COLUMNS = 'id, ts, role, content, turn_id, kind, interrupted';

export interface HistoryStoreOptions {
  db: DatabaseSync;
  summary: RunningSummary;
  summarize: Summarize;
  maxTokens?: number;
  /** §8.6: tier-3 retrieval. Optional — a store built without one keeps Phase 2's `facts() -> []`,
   *  which is what lets `brain-service.crash.test.ts` (T3-C's file) stay untouched by this task. */
  factStore?: FactStore;
  now?: () => number;
}

/**
 * MUST be a `type` alias, not an `interface`. StatementSync.all() is typed
 * `Record<string, SQLOutputValue>[]`, and an interface has no implicit index
 * signature, so `as RawHistoryRow[]` fails with TS2352. A type alias compiles.
 */
type RawHistoryRow = {
  id: number;
  ts: number;
  role: Role;
  content: string;
  turn_id: string | null;
  kind: MessageKind;
  interrupted: number;
};

/**
 * Tier 1 (window) + tier 2 (running summary) of spec §6. Every Promise-returning
 * method is internally synchronous — DatabaseSync is sync — and returns an
 * already-resolved promise so HistoryPort can stay async for a future store.
 * Never introduce a worker thread for this.
 */
export class HistoryStore implements HistoryPort, MetricsPort {
  private readonly db: DatabaseSync;
  private readonly summaryStore: RunningSummary;
  private readonly summarize: Summarize;
  private readonly maxTokens: number;
  private readonly now: () => number;
  /** G2-2: set by `close()`; every post-await continuation returns without touching the db. */
  private closed = false;
  /** G2-3: one trim in flight per store; null when idle. `trimSettled()` hands it out. */
  private inFlight: Promise<void> | null = null;
  private readonly factStore: FactStore | null;
  /** §8.6: the retrieval query for the next facts() call. Set by TurnRunner through HistoryPort. */
  private pendingQuery = '';

  constructor(opts: HistoryStoreOptions) {
    this.db = opts.db;
    this.summaryStore = opts.summary;
    this.summarize = opts.summarize;
    this.maxTokens = opts.maxTokens ?? HISTORY_WINDOW_SAFETY_TOKENS;
    this.factStore = opts.factStore ?? null;
    this.now = opts.now ?? Date.now;
  }

  // ---- HistoryPort -------------------------------------------------------

  /**
   * G2-2: closing fence. Called by index.ts before `db.close()`; a summariser that resolves after
   * this (the quit's drain timed out on it) finds `closed` and writes nothing, instead of throwing
   * ERR_INVALID_STATE into a closed handle.
   */
  close(): void {
    this.closed = true;
  }

  /** G2-2: resolves once every trim admitted so far has settled. `BrainService.dispose()` awaits it. */
  trimSettled(): Promise<void> {
    return this.inFlight ?? Promise.resolve();
  }

  /** Rows after the last trim point, oldest first. kind='system' rows are included: the user saw them. */
  window(): Promise<ChatMessage[]> {
    return Promise.resolve(this.visibleRows(this.lastTrimId()).map((r) => ({ role: r.role, content: r.content })));
  }

  summary(): Promise<string> {
    return this.summaryStore.get();
  }

  /**
   * §8.6: tier 3. The values are already sanitised by FactStore.retrieve (§8.10).
   *
   * FIX ROUND 1, finding 6. The query is CONSUMED here. §8.6 does not say how long a `setQuery`
   * lives, and leaving it set meant any `facts()` on a path that does not set one first — a
   * proactive turn, or a second assembly after the user text changed — would retrieve against the
   * PREVIOUS turn's query and inject stale facts into 【你记得】. One `setQuery` now feeds exactly
   * one retrieval, and an unset query yields no facts instead of yesterday's.
   * `TurnRunner.send` sets it before every `facts()` (turn.ts), and a regeneration re-uses
   * `turn.base.facts` rather than retrieving again, so no live path loses its facts.
   */
  facts(): Promise<string[]> {
    const query = this.pendingQuery;
    this.pendingQuery = '';
    if (this.factStore === null || query === '') return Promise.resolve([]);
    return Promise.resolve(this.factStore.retrieve(query, this.now()));
  }

  /** §8.6: HistoryPort.setQuery. Stores the raw user text; no database access. */
  setQuery(text: string): void {
    this.pendingQuery = text;
  }

  recentAssistant(n: number): Promise<string[]> {
    const rows = this.db
      .prepare(
        "SELECT content FROM messages WHERE role = 'assistant' AND id > ? ORDER BY id DESC LIMIT ?",
      )
      .all(this.lastTrimId(), n) as Array<{ content: string }>;
    return Promise.resolve(rows.map((r) => r.content).reverse()); // LintContext.recent is newest-LAST
  }

  append(role: Role, content: string, meta?: MessageMeta): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO messages (ts, role, content, turn_id, kind, interrupted, tokens) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        this.now(),
        role,
        content,
        meta?.turnId ?? null,
        meta?.kind ?? 'chat',
        meta?.interrupted === true ? 1 : 0,
        estimateTokens(content),
      );
    return Promise.resolve();
  }

  /**
   * The network call runs OUTSIDE the transaction; the two writes that must agree
   * — the new summary and the new trim point — run inside one. Dropped rows are
   * never deleted: last_trim_id is what excludes them from the prompt window, and
   * the history pane still shows them (X5).
   *
   * G2-3 / CX-4: trims are SERIALISED — one in flight per store. A second plan admitted while a
   * summarisation is on the wire (a superseded turn's) waits for the first to settle, and then
   * finds the table no longer matches it and aborts without writing, so two overlapping trims can
   * never both commit and a stale summary can never overwrite a newer one.
   */
  onTrimNeeded(plan: TrimPlan): Promise<void> {
    if (plan.drop.length === 0) return Promise.resolve();
    return this.chain(() => this.trim(plan));
  }

  /**
   * §8.5: the ONE write chain. `FactExtractor` appends to the same tail `onTrimNeeded` uses, so an
   * extraction can never interleave with a trim's BEGIN…COMMIT. FW-3a: after `close()` the fence
   * REJECTS rather than racing `db.close()`.
   *
   * CONTRACT GAP: §8.6 enumerates four history.ts changes and does not name this one, but §8.5
   * requires "a single Promise tail in HistoryStore that both onTrimNeeded and the extractor append
   * to" — this is that tail, factored out of the body it already had (Concern C-2).
   */
  enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('[memory] write chain closed'));
    return this.chain(task);
  }

  /**
   * G2-3 / CX-4, unchanged in substance: an idle store starts NOW (the task runs synchronously up
   * to its first await, so a trim's snapshot and cutoff are taken before the caller's next
   * statement — I-10's guarantee); a busy store queues behind whatever is in flight. The tracked
   * promise never rejects (a failed write must not poison the next one); the caller's still does.
   */
  private chain<T>(start: () => Promise<T>): Promise<T> {
    const run = this.inFlight === null ? start() : this.inFlight.then(start);
    const settled = run.then(noop, noop);
    this.inFlight = settled;
    void settled.then(() => {
      if (this.inFlight === settled) this.inFlight = null;
    });
    return run;
  }

  private async trim(plan: TrimPlan): Promise<void> {
    if (this.closed) return;

    // I-10 / CX-5: the trim point is the EXACT id of the last dropped row, resolved BEFORE the
    // summarize await while the table still matches the plan — never `last_trim_id + drop.length`.
    // `window()` may have safety-truncated the oldest rows (HISTORY_WINDOW_SAFETY_TOKENS), so
    // plan.drop does not necessarily start at last_trim_id + 1; a length-derived pointer skipped
    // every truncated row. The snapshot of last_trim_id is re-checked inside the transaction.
    const base = this.lastTrimId();
    const cutoff = this.resolveCutoff(base, plan);
    if (cutoff === null) return; // the plan no longer matches the table: NOTHING is written

    // GC-1: the pointer moves to `cutoff`, so every row `base < id <= cutoff` leaves the prompt
    // window for good — including the oldest ones the safety truncation had already kept out of
    // `window()` (and therefore out of plan.drop). They are all summarised, in id order, once
    // each, in bounded chunks; the id-bearing snapshot is what the commit re-validates.
    const prefix = this.rowsBetween(base, cutoff);
    const chunks = chunkByTokens(prefix, TRIM_CHUNK_TOKENS);

    let next = this.summaryStore.getSync();
    for (const chunk of chunks) {
      try {
        next = await this.summarize(next, chunk.map((r) => ({ role: r.role, content: r.content })));
      } catch (err) {
        console.warn(
          '[memory] summarize failed; window left untrimmed:',
          err instanceof Error ? err.message : String(err),
        );
        return;
      }
      if (this.closed) return; // G2-2: the db is closing or closed under us
      // The next chunk sees what the store would keep, not an uncapped intermediate.
      next = capSummary(next);
    }

    this.db.exec('BEGIN');
    try {
      if (this.lastTrimId() !== base || !this.prefixStillMatches(prefix, cutoff)) {
        // Someone moved the pointer while the summary was on the wire, or the rows the summary
        // describes are not the rows the pointer would retire: this plan is stale.
        this.db.exec('ROLLBACK');
        return;
      }
      this.summaryStore.setSync(next); // caps at SUMMARY_TOKEN_CAP; synchronous by contract
      setKv(this.db, KV_LAST_TRIM_ID, String(cutoff));
      this.db.exec('COMMIT');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // the failing statement already rolled the transaction back
      }
      throw err;
    }
  }

  // ---- MetricsPort -------------------------------------------------------

  record(m: MetricsRecord): Promise<void> {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO metrics (turn_id, ts, ttft_ms, total_ms, prompt_tokens, cache_hit, cache_miss, completion, compliance_miss, regenerated, sensitive, lint, error_code, envelope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        m.turnId,
        m.ts,
        m.ttftMs,
        m.totalMs,
        m.promptTokens,
        m.cacheHit,
        m.cacheMiss,
        m.completion,
        m.complianceMiss ? 1 : 0,
        m.regenerated ? 1 : 0,
        m.sensitive ? 1 : 0,
        JSON.stringify(m.lint.violations),
        m.errorCode,
        m.envelope,
      );
    return Promise.resolve();
  }

  // ---- Chat-window surface ----------------------------------------------

  /** Newest first. The caller derives `nextBefore` as the smallest returned id. */
  list(opts: { before?: number; limit?: number }): HistoryRow[] {
    const limit = opts.limit ?? DEFAULT_LIST_LIMIT;
    const rows =
      opts.before === undefined
        ? (this.db
            .prepare(`SELECT ${LIST_COLUMNS} FROM messages ORDER BY id DESC LIMIT ?`)
            .all(limit) as RawHistoryRow[])
        : (this.db
            .prepare(`SELECT ${LIST_COLUMNS} FROM messages WHERE id < ? ORDER BY id DESC LIMIT ?`)
            .all(opts.before, limit) as RawHistoryRow[]);

    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      role: r.role,
      content: r.content,
      turnId: r.turn_id,
      kind: r.kind,
      interrupted: r.interrupted === 1,
    }));
  }

  deleteTurn(turnId: string): number {
    return this.db.prepare('DELETE FROM messages WHERE turn_id = ?').run(turnId).changes as number;
  }

  /** Inclusive: counts rows with ts >= the argument (contracts §4.3). */
  countSince(ts: number): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE ts >= ?').get(ts) as {
      n: number;
    };
    return row.n;
  }

  lastMessageTs(): number | null {
    const row = this.db.prepare('SELECT ts FROM messages ORDER BY id DESC LIMIT 1').get() as
      | { ts: number }
      | undefined;
    return row === undefined ? null : row.ts;
  }

  // ---- internal ----------------------------------------------------------

  private lastTrimId(): number {
    return readKvInt(this.db, KV_LAST_TRIM_ID);
  }

  /**
   * The rows `window()` would return for a given trim point, WITH their ids: everything after the
   * pointer, oldest first, then the same safety truncation from the oldest end.
   */
  private visibleRows(afterId: number): Array<{ id: number; role: Role; content: string }> {
    const rows = this.db
      .prepare('SELECT id, role, content FROM messages WHERE id > ? ORDER BY id ASC')
      .all(afterId) as Array<{ id: number; role: Role; content: string }>;
    let total = rows.reduce((n, r) => n + estimateTokens(r.content), 0);
    let start = 0;
    while (start < rows.length && total > this.maxTokens) {
      total -= estimateTokens(rows[start].content);
      start++;
    }
    return rows.slice(start);
  }

  /** GC-1: every row the trim retires, `after < id <= upTo`, oldest first, with ids. */
  private rowsBetween(after: number, upTo: number): Array<{ id: number; role: Role; content: string }> {
    return this.db
      .prepare('SELECT id, role, content FROM messages WHERE id > ? AND id <= ? ORDER BY id ASC')
      .all(after, upTo) as Array<{ id: number; role: Role; content: string }>;
  }

  /**
   * GC-1: the rows the summary was built from are exactly the rows the pointer is about to retire.
   * A `history:delete` of a retired row during the await only removes rows from the set (the
   * summary then describes slightly more than the table holds, which is harmless and matches
   * I-10); a row that is now MISSING from the summary — an append landing with an id inside the
   * range cannot happen (ids are monotonic), but a changed content can — makes the plan stale.
   */
  private prefixStillMatches(snapshot: Array<{ id: number; role: Role; content: string }>, upTo: number): boolean {
    const byId = new Map(snapshot.map((r) => [r.id, r]));
    for (const row of this.rowsBetween(snapshot.length === 0 ? upTo : snapshot[0].id - 1, upTo)) {
      const seen = byId.get(row.id);
      if (seen === undefined || seen.role !== row.role || seen.content !== row.content) return false;
    }
    return true;
  }

  /**
   * The id of the last row `plan.drop` covers, or null when the plan does not describe the oldest
   * prefix of the window as it stands now (rows deleted, a pointer moved by an earlier trim, a plan
   * built from a window this store never produced). plan.drop carries no ids (contracts §4.3), so
   * the match is by position, role and content.
   */
  private resolveCutoff(base: number, plan: TrimPlan): number | null {
    const visible = this.visibleRows(base);
    if (visible.length < plan.drop.length) return null;
    for (let i = 0; i < plan.drop.length; i++) {
      if (visible[i].role !== plan.drop[i].role || visible[i].content !== plan.drop[i].content) return null;
    }
    return visible[plan.drop.length - 1].id;
  }
}

const noop = (): void => {};

/**
 * GC-1: splits rows into consecutive groups whose estimated tokens stay at or under `maxTokens`.
 * A single row larger than the bound is its own group — it is never split or skipped.
 */
export function chunkByTokens<T extends { content: string }>(rows: T[], maxTokens: number): T[][] {
  const out: T[][] = [];
  let group: T[] = [];
  let total = 0;
  for (const row of rows) {
    const cost = estimateTokens(row.content);
    if (group.length > 0 && total + cost > maxTokens) {
      out.push(group);
      group = [];
      total = 0;
    }
    group.push(row);
    total += cost;
  }
  if (group.length > 0) out.push(group);
  return out;
}
