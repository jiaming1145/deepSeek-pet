import type { ChatMessage } from './types.ts';
import { affectionPhrase, energyPhrase, moodPhrase } from './persona.ts';

/**
 * MODULE CYCLE, DELIBERATE — see the note at the top of ./persona.ts. `estimateTokens` stays
 * here (contracts.md §3.8.1 makes it the single token oracle for the whole repo); the three
 * phrase helpers stay in ./persona.ts. Neither side dereferences the other at module scope.
 */

/**
 * Six ranges, written with \u escapes on purpose: the first range starts at U+3000 IDEOGRAPHIC
 * SPACE, an invisible literal endpoint. Ranges: 3000-303F CJK punctuation | 3040-30FF kana |
 * 3400-4DBF ext-A | 4E00-9FFF unified | F900-FAFF compat ideographs | FF00-FFEF full-width.
 * CJK punctuation and full-width forms are deliberately included, so 。！？，、《》 cost the
 * same as a hanzi.
 */
const CJK_TOK = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

/** The single token oracle: planTrim, cardTokens, the summary cap, messages.tokens, the eval. */
export function estimateTokens(s: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of s) {
    if (CJK_TOK.test(ch)) cjk++;
    else if (/\s/.test(ch)) continue;
    else if (/[A-Za-z0-9]/.test(ch)) continue; // counted by word below
    else other++;
  }
  const latinWords = (s.match(/[A-Za-z0-9]+/g) ?? []).length;
  return Math.ceil(cjk / 1.5 + latinWords * 1.3 + other * 0.3);
}

export interface StatePreamble {
  localTime: string; // '21:14'  — the caller formats with Intl.DateTimeFormat('zh-CN')
  weekday: string; // '周三'
  mood: number; // [-1, 1]
  energy: number; // [0, 100]
  affection: number; // [0, 100]
  sinceLastChat: string; // '3小时' | '刚刚' | '2天'
}

export interface AssembleInput {
  /** renderStaticSystem(...) — byte-identical across turns; this is the cached prefix. */
  staticSystem: string;
  /** card.post_history_instructions; '' or undefined to omit. */
  postHistoryInstructions?: string;
  /** Running summary, '' to omit; the caller has already capped it at SUMMARY_TOKEN_CAP. */
  summary: string;
  /** Retrieved facts; truncated to MAX_FACTS here, not by the caller. Phase 2 passes []. */
  facts: string[];
  /** Append-only, user/assistant only, oldest first. Never reformatted, never rewritten. */
  history: ChatMessage[];
  state: StatePreamble;
  userText: string;
  /** Lint nudge, appended last. NEVER persisted to history (R10.6). */
  nudge?: string;
}

export const LINT_NUDGE = '（上一条回复不像你会说的话，换个说法，别用助手腔。）';
export const SUMMARY_TOKEN_CAP = 600;
export const MAX_FACTS = 5;

/**
 * Layout (C-2 — the addendum wins; there is no "pair #1"):
 *   messages[0]    = { role: 'system', content: staticSystem }
 *   messages[1..n] = ...history (verbatim)
 *   messages[n+1]  = { role: 'user', content: <state head>\n\n<userText>[\n<nudge>] }
 * Dynamic state appears ONLY in the last message; everything before it is byte-stable, which
 * is the whole point (X1, >= 70 % prefix-cache hit).
 */
export function assemblePrompt(input: AssembleInput): ChatMessage[] {
  const s = input.state;
  const head: string[] = [
    `【状态】本地时间 ${s.weekday} ${s.localTime}｜心情 ${moodPhrase(s.mood)}｜精力 ${energyPhrase(s.energy)}｜好感 ${affectionPhrase(s.affection)}｜距离上次聊天 ${s.sinceLastChat}`,
  ];
  if (input.summary) head.push(`【最近发生过什么】${input.summary}`);
  const facts = input.facts.slice(0, MAX_FACTS);
  if (facts.length > 0) head.push(`【你记得】${facts.join('；')}`);
  const phi = input.postHistoryInstructions ?? '';
  if (phi) head.push(`【记住】${phi}`);
  let latest = `${head.join('\n')}\n\n${input.userText}`;
  if (input.nudge) latest = `${latest}\n${input.nudge}`;

  return [
    { role: 'system', content: input.staticSystem },
    ...input.history,
    { role: 'user', content: latest },
  ];
}

// TrimPlan is DECLARED in types.ts (§3.1, owner T1). prompt.ts re-exports it, so the many
// existing `import type { TrimPlan } from './prompt.ts'` call sites keep resolving.
// (contracts.md §3.8.4 and §8.6 row 12; the Task-3 brief's Step 6 body predates T1 landing the
// interface in types.ts, and declaring it a second time here is TS2308 on the barrel.)
export type { TrimPlan } from './types.ts';
import type { TrimPlan } from './types.ts';

/**
 * Caller: TurnRunner.send(), immediately after history.window() and before assembling
 * (contracts.md §3.8.4). HistoryStore.window() never trims on its own.
 * Walks from the oldest message into `drop` until droppedTokens >= dropTokens, then extends
 * `drop` forward until the next kept message is a 'user' row, so a pair is never split.
 */
export function planTrim(history: ChatMessage[], maxTokens = 24_000, dropTokens = 8_000): TrimPlan {
  let total = 0;
  for (const m of history) total += estimateTokens(m.content);
  if (total <= maxTokens) return { keep: history, drop: [], droppedTokens: 0 };

  let i = 0;
  let dropped = 0;
  while (i < history.length && dropped < dropTokens) {
    dropped += estimateTokens(history[i].content);
    i++;
  }
  while (i < history.length && history[i].role !== 'user') {
    dropped += estimateTokens(history[i].content);
    i++;
  }
  return { keep: history.slice(i), drop: history.slice(0, i), droppedTokens: dropped };
}
