import type { DatabaseSync } from 'node:sqlite';
import type { ChatClient } from '@ds/brain';
import {
  EXTRACT_EVERY_N_USER_TURNS,
  EXTRACT_MAX_TOKENS,
  EXTRACT_SYSTEM,
  extractUserMessage,
  parseExtractResponse,
} from '@ds/brain';
import type { FactStore, HistoryStore } from '@ds/memory';
import {
  FACT_MAX_CHARS,
  FACT_MERGE_JACCARD,
  KV_MEM_TURNS_SINCE_EXTRACT,
  bigramSet,
  getKv,
  jaccard,
  sanitizeMemoryText,
  setKv,
} from '@ds/memory';

/**
 * §8.5 rule 3: memory is DATA, never an instruction channel (research §7.8 — models are
 * "significantly more vulnerable to memory injection compared to prompt injection"). A value that
 * opens with one of these is dropped with a logged reason, however confident the model was.
 */
export const IMPERATIVE_VALUE = /^(请|帮我|记住|不要|别|你要|给我)/;

/** The alias bound §8.5's schema already enforces; re-applied after sanitisation. */
const ALIAS_MAX = 24;

export interface FactExtractorDeps {
  /** The live client, rebuilt on every key change — read through the getter, never captured. */
  client(): ChatClient | null;
  store: FactStore;
  /** The write chain owner. `enqueueWrite` is what serialises this against a trim (§8.5). */
  history: HistoryStore;
  db: DatabaseSync;
  /**
   * Accepted for §8.5's constructor shape, and deliberately NOT read: fact rows are stamped by
   * `FactStore`'s own clock, and one lane has one clock (rulings, ownership table). FIX ROUND 1,
   * finding 4 — this used to be stored in a field kept alive by a `void this.now;` statement, which
   * made the injected clock look like it reached the written rows. It never did.
   */
  now?: () => number;
}

/**
 * R3-10: "bounded deepseek-v4-flash JSON call every 6 user turns, serialised with trims through the
 * same write chain, cancellable, drained on quit."
 *
 * The counter lives in `kv.mem_turns_since_extract`, not in this object, so a restart mid-window
 * does not hand the user six free turns.
 */
export class FactExtractor {
  private readonly deps: FactExtractorDeps;
  /** The user turns since the last attempt. Cleared when an attempt is queued, not when it lands. */
  private pending: string[] = [];
  private controller: AbortController | null = null;
  /** Whatever the last queued attempt resolved to; `dispose()` awaits it. */
  private tail: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(deps: FactExtractorDeps) {
    this.deps = deps;
  }

  /** Called from BrainService on every completed USER turn. Counts, and fires at N = 6. */
  noteUserTurn(text: string): void {
    if (this.disposed) return;
    const trimmed = text.trim();
    if (trimmed === '') return; // a blank turn is not a turn
    this.pending.push(trimmed);

    const n = this.counter() + 1;
    if (n < EXTRACT_EVERY_N_USER_TURNS) {
      setKv(this.deps.db, KV_MEM_TURNS_SINCE_EXTRACT, String(n));
      return;
    }
    // B-11: the budget is spent when the attempt is DECIDED, not when it succeeds — a truncated
    // response, a network failure and a missing key all leave the counter at 0.
    setKv(this.deps.db, KV_MEM_TURNS_SINCE_EXTRACT, '0');
    const turns = this.pending.slice(-EXTRACT_EVERY_N_USER_TURNS);
    this.pending = [];
    this.queue(turns);
  }

  /** Awaited by the quit drain (§3.11). Cancels the in-flight call and awaits its writes. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.controller?.abort();
    await this.tail;
  }

  // ---- internal ----------------------------------------------------------

  /**
   * G2-7 shape, tolerated rather than fatal: a corrupted counter must not stop the app from
   * chatting. It is reset to a known value and the window starts again.
   */
  private counter(): number {
    const raw = getKv(this.deps.db, KV_MEM_TURNS_SINCE_EXTRACT);
    if (raw === null) return 0;
    const n = Number(raw);
    if (!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(n)) {
      console.warn(
        `[memory] ${KV_MEM_TURNS_SINCE_EXTRACT} was not an integer (${JSON.stringify(raw)}); restarting the window`,
      );
      return 0;
    }
    return n;
  }

  /** §8.5: the extraction joins the SAME write chain the trim/summarisation path uses. */
  private queue(turns: readonly string[]): void {
    this.tail = this.deps.history
      .enqueueWrite(() => this.extract(turns))
      .catch((err: unknown) => {
        // FW-3a: after the closing fence this is the expected path, not an error path.
        console.warn(
          '[memory] fact extraction skipped:',
          err instanceof Error ? err.message : String(err),
        );
      });
  }

  private async extract(turns: readonly string[]): Promise<void> {
    if (this.disposed) return;
    const client = this.deps.client();
    if (client === null) return; // no key: nothing to do, budget already spent

    const controller = new AbortController();
    this.controller = controller;
    let text: string;
    try {
      const res = await client.complete(
        {
          messages: [
            { role: 'system', content: EXTRACT_SYSTEM },
            { role: 'user', content: extractUserMessage(turns) },
          ],
          maxTokens: EXTRACT_MAX_TOKENS,
        },
        controller.signal,
      );
      text = res.text;
    } catch (err) {
      if (!controller.signal.aborted) {
        console.warn(
          '[memory] fact extraction failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
      return;
    } finally {
      if (this.controller === controller) this.controller = null;
    }
    if (this.disposed || controller.signal.aborted) return;

    const parsed = parseExtractResponse(text);
    if (!parsed.ok) {
      // §8.5 rule 2 / B-11: truncated or malformed means EXTRACT NOTHING. Never a partial parse.
      console.warn('[memory] fact extraction produced no usable JSON:', parsed.reason);
      return;
    }
    for (const f of parsed.facts) this.write(f.key, f.value, f.alias, f.confidence);
  }

  private write(
    key: string,
    rawValue: string,
    rawAlias: readonly string[],
    confidence: number,
  ): void {
    const value = sanitizeMemoryText(rawValue, FACT_MAX_CHARS);
    if (value === '') return;
    if (IMPERATIVE_VALUE.test(value)) {
      console.warn(`[memory] dropped an imperative fact value (${key})`);
      return;
    }
    if (value.includes('【') || value.includes('<|')) {
      // Defence in depth: sanitizeMemoryText has already mapped both away, so this cannot fire —
      // which is the point. If it ever does, the sanitiser regressed and memory stopped being data.
      console.warn(`[memory] dropped a fact value carrying a control marker (${key})`);
      return;
    }
    const alias = rawAlias.map((a) => sanitizeMemoryText(a, ALIAS_MAX)).filter((a) => a !== '');

    // research §7 / mem0#7123: a candidate that is a near-duplicate of an existing non-tombstoned
    // value is MERGED into that row (same key, so upsert updates in place with provenance) rather
    // than inserted as a second memory of the same thing.
    const candidate = bigramSet(value);
    const dup = this.deps.store
      .list()
      .find((row) => jaccard(candidate, bigramSet(row.value)) >= FACT_MERGE_JACCARD);

    this.deps.store.upsert({
      key: dup?.key ?? key,
      value,
      alias,
      confidence,
      // CONTRACT GAP: §8.2's FactUpsert carries `sourceTurn`, but `noteUserTurn(text)` receives no
      // turn id and §8.5's constructor takes none. Null until the controller rules (Concern C-11).
      sourceTurn: null,
    });
  }
}
