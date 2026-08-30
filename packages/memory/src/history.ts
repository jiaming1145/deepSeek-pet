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
import { KV_LAST_TRIM_ID, getKv, setKv } from './db.ts';
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

  constructor(opts: HistoryStoreOptions) {
    this.db = opts.db;
    this.summaryStore = opts.summary;
    this.summarize = opts.summarize;
    this.maxTokens = opts.maxTokens ?? HISTORY_WINDOW_SAFETY_TOKENS;
    this.now = opts.now ?? Date.now;
  }

  // ---- HistoryPort -------------------------------------------------------

  /** Rows after the last trim point, oldest first. kind='system' rows are included: the user saw them. */
  window(): Promise<ChatMessage[]> {
    const rows = this.db
      .prepare('SELECT role, content FROM messages WHERE id > ? ORDER BY id ASC')
      .all(this.lastTrimId()) as Array<{ role: Role; content: string }>;
    const msgs: ChatMessage[] = rows.map((r) => ({ role: r.role, content: r.content }));

    let total = msgs.reduce((n, m) => n + estimateTokens(m.content), 0);
    let start = 0;
    while (start < msgs.length && total > this.maxTokens) {
      total -= estimateTokens(msgs[start].content);
      start++;
    }
    return Promise.resolve(msgs.slice(start));
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
   */
  async onTrimNeeded(plan: TrimPlan): Promise<void> {
    if (plan.drop.length === 0) return;

    // plan.drop carries no row ids: it is the oldest prefix of the current window, so the new
    // trim point is the plan.drop.length-th row with id > last_trim_id in ascending id order
    // (contracts §4.3). If that query returns no row the plan no longer matches the table and
    // NOTHING is written — neither the summary nor the pointer.
    //
    // I-10: resolved BEFORE the summarize await, while the table still matches the plan. A
    // `history:delete` landing during the network call used to shift the row-count offset onto
    // kept rows and move the pointer past turns that were never summarised. An id resolved now
    // bounds `id >` correctly even if that very row is deleted before the transaction below.
    const row = this.db
      .prepare('SELECT id FROM messages WHERE id > ? ORDER BY id ASC LIMIT 1 OFFSET ?')
      .get(this.lastTrimId(), plan.drop.length - 1) as { id: number } | undefined;
    if (row === undefined) return;
    const nextTrimId = row.id;

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

    this.db.exec('BEGIN');
    try {
      this.summaryStore.setSync(next); // caps at SUMMARY_TOKEN_CAP; synchronous by contract
      setKv(this.db, KV_LAST_TRIM_ID, String(nextTrimId));
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
    return Number(getKv(this.db, KV_LAST_TRIM_ID) ?? '0');
  }
}
