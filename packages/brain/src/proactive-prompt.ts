import type { ProactiveBucket } from '@ds/protocol';
import { MAX_FACTS } from './prompt.ts';

export interface ProactiveTemplate {
  id: string;                 // stable, the 30-day ledger key
  bucket: ProactiveBucket;
  /** Zero-token path: the line is spoken verbatim. Used for greeting/night/meal/longGap. */
  text?: string;
  /** LLM path: a TOPIC + STYLE instruction, never a script. Used for **`callback` only** (R3-29). */
  instruction?: string;
  /** A14 audit marker: set by the template author, asserted by the §4.8 linter. */
  audited: true;
}

/** §3.10.7, byte-stable. ≈30 characters is bar §0's 2-second reveal cap at 60–80 ms per hanzi. */
export const PROACTIVE_INSTRUCTION_TAIL = '只说一句话，不超过三十个字。不要提对方多久没理你，不要催，不要问“你还在吗”。';

/**
 * Builds the user-message text handed to TurnRunner.send(text, 'proactive'). The facts are the
 * already-sanitised strings FactStore.retrieve returned (§8.10 applied at both boundaries); they
 * ride on the same 【你记得】 line assemblePrompt uses, capped at MAX_FACTS.
 */
export function proactivePrompt(t: ProactiveTemplate, facts: string[]): string {
  if (t.instruction === undefined) throw new Error(`proactivePrompt: ${t.id} is a text template, it is spoken locally, never prompted`);
  const lines = [`【主动】${t.instruction}`];
  const picked = facts.slice(0, MAX_FACTS);
  if (picked.length > 0) lines.push(`【你记得】${picked.join('；')}`);
  lines.push(PROACTIVE_INSTRUCTION_TAIL);
  return lines.join('\n');
}
