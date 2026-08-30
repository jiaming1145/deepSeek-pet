import type { DatabaseSync } from 'node:sqlite';
import { SUMMARY_TOKEN_CAP, estimateTokens } from '@ds/brain';
import type { RunningSummaryPort } from '@ds/brain';

// Re-export, not a fresh const: the cap is literally one binding (contracts §4.4).
export { SUMMARY_TOKEN_CAP, MAX_FACTS as SUMMARY_MAX_FACTS } from '@ds/brain';

/**
 * CP-1: the terminator set is `。！？!?`. `…` and `\n` are deliberately excluded —
 * the §4.4 summariser prompt forbids bullet points, and `…` inside a summary is a
 * stylistic pause rather than a sentence end.
 */
const SENTENCE_BOUNDARY = /(?<=[。！？!?])/;

/**
 * Enforces the running-summary budget by dropping whole sentences from the END
 * until the remainder fits, so the stored text always ends on a terminator.
 * Degenerate case (pinned by §4.4): a text whose first sentence alone exceeds the
 * cap — or that has no terminator at all — is kept whole rather than cut
 * mid-sentence. An over-cap summary is a bounded, visible cost; a summary sliced
 * mid-clause is silent corruption of the model's memory.
 */
/**
 * M-5: memory text is spliced into the prompt next to the card's `【记住】`-style post-history
 * instructions, so a poisoned summary or fact must not be able to carry a forged instruction line.
 * Whitespace runs (newlines included) collapse to one space and `【`/`】` become `[`/`]`; the text
 * stays readable, but nothing in it can start a new line or wear the instruction brackets.
 */
export function sanitizeMemoryText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/【/g, '[').replace(/】/g, ']').trim();
}

export function capSummary(text: string, maxTokens: number = SUMMARY_TOKEN_CAP): string {
  const trimmed = sanitizeMemoryText(text);
  if (trimmed === '' || estimateTokens(trimmed) <= maxTokens) return trimmed;
  const parts = trimmed.split(SENTENCE_BOUNDARY).filter((s) => s.trim() !== '');
  let kept = '';
  for (const part of parts) {
    const next = kept + part;
    if (estimateTokens(next) > maxTokens) break;
    kept = next;
  }
  return kept === '' ? trimmed : kept;
}

/**
 * Tier 2 memory (spec §6). Refreshed ONLY at a trim event, from
 * HistoryStore.onTrimNeeded — no timer, no per-turn refresh, no consolidation pass
 * in Phase 2. That is what keeps the cached prompt prefix stable (X1).
 */
export class RunningSummary implements RunningSummaryPort {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(db: DatabaseSync, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  getSync(): string {
    const row = this.db.prepare('SELECT content FROM summaries WHERE id = 1').get() as
      | { content: string }
      | undefined;
    return row === undefined ? '' : row.content;
  }

  get(): Promise<string> {
    return Promise.resolve(this.getSync());
  }

  /** The synchronous write. onTrimNeeded's BEGIN…COMMIT must never await inside itself. */
  setSync(text: string): void {
    const kept = capSummary(text);
    this.db
      .prepare('UPDATE summaries SET content = ?, tokens = ?, updated_ts = ? WHERE id = 1')
      .run(kept, estimateTokens(kept), this.now());
  }

  set(text: string): Promise<void> {
    this.setSync(text);
    return Promise.resolve();
  }

  updatedAt(): number {
    const row = this.db.prepare('SELECT updated_ts FROM summaries WHERE id = 1').get() as
      | { updated_ts: number }
      | undefined;
    return row === undefined ? 0 : row.updated_ts;
  }
}
