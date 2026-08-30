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
import { sanitizeMemoryText, type RunningSummary } from './summary.ts';

/**
 * Safety net only. It sits ABOVE planTrim's 24_000 trigger on purpose: planTrim
 * (called by TurnRunner.send, contracts §3.8.4) is the real trimmer, and if this
 * net cut the window down to 24_000 first, plan.drop would always be empty and the
 * running summary could never refresh.
 */
export const HISTORY_WINDOW_SAFETY_TOKENS = 32_000;

const DEFAULT_LIST_LIMIT = 50;
const LIST_COLUMNS = 'id, ts, role, content, turn_id, kind, interrupted';

export interface HistoryStoreOptions {
  db: DatabaseSync;
  summary: RunningSummary;
  summarize: Summarize;
  maxTokens?: number;
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

  constructor(opts: HistoryStoreOptions) {
    this.db = opts.db;
    this.summaryStore = opts.summary;
    this.summarize = opts.summarize;
    this.maxTokens = opts.maxTokens ?? HISTORY_WINDOW_SAFETY_TOKENS;
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

  /** Tier 3 retrieval is Phase 3 (spec §6). The port exists now so the prompt layout is final. */
  facts(): Promise<string[]> {
    // M-5: the same sanitiser as the summary, applied here so Phase 3's real rows cannot forge a
    // `【记住】` line either. Empty in Phase 2, so the map is a no-op today.
    const rows: string[] = [];
    return Promise.resolve(rows.map(sanitizeMemoryText));
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
    // An idle store starts NOW: `trim` runs synchronously up to its first await, so the snapshot and
    // the cutoff are taken before the caller's next statement (I-10's guarantee). A busy store
    // queues behind the in-flight trim.
    const run = this.inFlight === null ? this.trim(plan) : this.inFlight.then(() => this.trim(plan));
    // The tracked promise never rejects (a failed transaction must not poison the next trim); the
    // caller's promise still does.
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

    let next: string;
    try {
      next = await this.summarize(this.summaryStore.getSync(), plan.drop);
    } catch (err) {
      console.warn(
        '[memory] summarize failed; window left untrimmed:',
        err instanceof Error ? err.message : String(err),
      );
      return;
    }
    if (this.closed) return; // G2-2: the db is closing or closed under us

    this.db.exec('BEGIN');
    try {
      if (this.lastTrimId() !== base) {
        // Someone moved the pointer while the summary was on the wire: this plan is stale.
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
        'INSERT OR REPLACE INTO metrics (turn_id, ts, ttft_ms, total_ms, prompt_tokens, cache_hit, cache_miss, completion, compliance_miss, regenerated, sensitive, lint, error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
