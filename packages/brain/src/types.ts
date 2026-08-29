import { EMOTIONS, isEmotion, type Emotion, type SentenceEvent, type TurnState, type Usage } from '@ds/protocol';
export { EMOTIONS, isEmotion };
export type { Emotion, SentenceEvent, TurnState, Usage };

export type Tag =
  | { kind: 'act'; emotion: Emotion; motion?: string }
  | { kind: 'pause'; seconds: number };

export type ScanItem =
  | { kind: 'text'; text: string }
  | { kind: 'tag'; tag: Tag }
  | { kind: 'badtag'; raw: string };

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

/**
 * Declared HERE, not in prompt.ts. §3.10's `ports.ts` needs it, and both `ports.ts` and this file
 * are T1's while `prompt.ts` is T3's — an `import type { TrimPlan } from './prompt.ts'` inside a
 * T1-only tree is TS2307 under verbatimModuleSyntax + allowImportingTsExtensions, so T1 could not
 * ship §3.10 verbatim. `prompt.ts` re-exports it (§3.8.4) and every existing call site —
 * `from '@ds/brain'`, `from './prompt.ts'`, `from './types.ts'` — keeps compiling unchanged.
 */
export interface TrimPlan { keep: ChatMessage[]; drop: ChatMessage[]; droppedTokens: number }
