import type { ErrorCode, LintResult } from '@ds/protocol';
// TrimPlan comes from types.ts, NOT prompt.ts: this file and types.ts are T1's while prompt.ts is
// T3's, and importing across that line makes T1's own `tsc -p packages/brain/tsconfig.json` fail
// with TS2307. One import, one file, both owned by the same task. See §3.1, §3.8.4, §8.6 row 12.
import type { ChatMessage, TrimPlan } from './types.ts';

export type Role = 'user' | 'assistant';
export type MessageKind = 'chat' | 'proactive' | 'system';           // R10.3
export interface MessageMeta {                                        // R10.2
  turnId?: string;
  kind?: MessageKind;          // default 'chat'
  interrupted?: boolean;       // default false; R2's [interrupted] marker
}

export interface HistoryPort {
  /** Messages after the last trim point, oldest first, within the 24K estimate budget. */
  window(): Promise<ChatMessage[]>;
  /** The running summary, '' when there is none. Already <= 600 estimated tokens. */
  summary(): Promise<string>;
  /** Up to `MAX_FACTS` retrieved facts for the latest user message. Phase 2 returns []. */
  facts(): Promise<string[]>;
  /**
   * §8.6: the retrieval query for the NEXT `facts()` call — the user's raw text. Called by
   * `TurnRunner.send()` immediately before `window()`. Synchronous and void by design: it stores a
   * string, it does not touch the database. This is the ONLY HistoryPort change in Phase 3.
   */
  setQuery(text: string): void;
  /** The last `n` assistant contents, oldest first. Feeds LintContext.recent. */
  recentAssistant(n: number): Promise<string[]>;
  append(role: Role, content: string, meta?: MessageMeta): Promise<void>;
  onTrimNeeded(plan: TrimPlan): Promise<void>;
}

export interface RunningSummaryPort {
  get(): Promise<string>;
  set(text: string): Promise<void>;
}

/** Injected into HistoryStore; main supplies the non-streaming v4-flash call. */
export type Summarize = (oldSummary: string, dropped: ChatMessage[]) => Promise<string>;

export interface MetricsRecord {
  turnId: string; ts: number;
  ttftMs: number | null; totalMs: number;
  promptTokens: number; cacheHit: number; cacheMiss: number; completion: number;
  complianceMiss: boolean; regenerated: boolean; sensitive: boolean;
  lint: LintResult; errorCode: ErrorCode | null;
  /** §8.8 / R3-11: `JSON.stringify(messages)` as the request went on the wire. AUDIT ONLY — never
   *  replayed. `null` when the turn failed before a request was assembled. */
  envelope: string | null;
}
export interface MetricsPort { record(m: MetricsRecord): Promise<void> }
