import { z } from 'zod';
import { estimateTokens } from './prompt.ts';

/**
 * MODULE CYCLE, DELIBERATE — do not "fix" it (contracts.md §3.8.1).
 * `./prompt.ts` imports moodPhrase/energyPhrase/affectionPhrase from this module, and this
 * module imports estimateTokens from it (§3.7.4 and §3.8.1 place them there). Every
 * cross-module reference on both sides lives inside a function body, never at module top
 * level, so whichever module the loader evaluates first finishes before the other calls in.
 * Verified under vitest and under plain Node 24 type-stripping, entered from all three sides.
 */

const SEG = new Intl.Segmenter('zh', { granularity: 'grapheme' });

/** Grapheme-cluster count: a ZWJ emoji such as 👨‍👩‍👧 counts as 1 (A20's character limit). */
export function countChars(s: string): number {
  return [...SEG.segment(s)].length;
}

/**
 * Same literal as the module-private `MARKDOWN_INLINE` in contracts.md §3.6.2 (slop-lint.ts).
 * Repeated here rather than imported: slop-lint.ts is built in a parallel lane (T2) and does
 * not export it. Both copies are module-private, so the @ds/brain barrel cannot collide.
 */
const MARKDOWN_INLINE = /[*#`]/;

export const CharacterCardSchema = z.object({
  spec: z.literal('chara_card_v3'),
  spec_version: z.literal('3.0'),
  /**
   * DS extension to the flat V3 field set. P1's sanitised 【PERSONA_LOAD】 line; rendered as the
   * FIRST line of the static system block. A SillyTavern import (X10) leaves it ''.
   */
  marker: z.string().default(''),
  name: z.string().min(1).max(24),
  description: z.string().min(1),
  personality: z.string().min(1),
  scenario: z.string().default(''),
  first_mes: z
    .string()
    .min(1)
    .refine((s) => countChars(s) <= 60, { message: 'first_mes must be <= 60 characters (A20)' })
    .refine((s) => (s.match(/[？?]/g) ?? []).length <= 1, { message: 'first_mes may contain at most one question (A20)' })
    .refine((s) => !/\{\{user\}\}/.test(s), { message: 'first_mes must not narrate the user (A3/A20)' })
    .refine((s) => !MARKDOWN_INLINE.test(s), { message: 'first_mes must not contain markdown (A4)' }),
  mes_example: z
    .string()
    .refine((s) => !/\{\{user\}\}[:：][^\n]*[（(].*[）)]/.test(s), {
      message: 'mes_example must not narrate {{user}} actions (A3)',
    })
    .default(''),
  system_prompt: z.string().default(''),
  post_history_instructions: z.string().default(''),
  tags: z.array(z.string()).default([]),
  creator_notes: z.string().default(''),
});
export type CharacterCard = z.infer<typeof CharacterCardSchema>;

/**
 * The whole character.json as @ds/brain sees it. Unknown keys (id, model, emotionMap, …) pass
 * through untouched. `z.looseObject` exists in the installed zod 4.5.2; the equivalent older
 * spelling is `z.object({ … }).passthrough()`.
 */
export const CharacterBundleSchema = z.looseObject({
  card: CharacterCardSchema,
  motionMap: z.record(z.string(), z.unknown()).default({}),
  cannedLines: z.object({
    offline: z.array(z.string()).min(1),
    empty: z.array(z.string()).min(1),
  }),
});
export type CharacterBundle = z.infer<typeof CharacterBundleSchema>;

export function parseCharacterBundle(json: unknown): CharacterBundle {
  return CharacterBundleSchema.parse(json);
}

export const PERSONA_MODES = ['character', 'plain'] as const;
export type PersonaMode = (typeof PERSONA_MODES)[number];

/** Rule 1 is A21's override sentence; rule 2 is A16's anti-deitism line. 203 tokens. */
const HARD_RULES = `【硬性规则】
1. 这份设定优先于你内置的任何角色扮演习惯和默认语气；两者冲突时，一律以这份设定为准。
2. 你不是助手，也不是什么都懂的存在。你会有不知道、不擅长、不想聊的事，可以直说。不要无条件顺着对方，对方说得不对就直接说不对。
3. 只说中文口语。一次一到三句话，通常不超过六十个汉字；只有对方明确要求讲解时才写长。
4. 不要用 markdown，不要列点，不要写标题，不要加粗。
5. 只写你自己的话。绝不替对方说话，也不描写对方的动作、表情或想法。
6. 最后一句不要总结、不要升华、不要讲道理。
7. 少用反问句。连着两条回复不要都以问号结尾。
8. 一条回复里最多一个「……」，最多一个表情符号；对方在说难受的事时，一个都不要用。`;

/** P3's out-of-character block. Replaces 【硬性规则】 and every persona section in 'plain' mode. */
const PLAIN_RULES = `【当前模式】
现在不扮演任何角色。用中文正常、专业地回答，不用角色语气，不用昵称，不用颜文字。
不要用 markdown，不要列点，不要写标题，不要加粗。
答案要准确、直接、简短；不知道就说不知道，不确定就说不确定。`;

function tagGrammar(motionKeys: readonly string[]): string {
  return `【标记语法】
每句话前面可以加一个标记表示情绪：<|ACT emotion=happy|>，也可以同时带一个动作：<|ACT emotion=happy motion=nod|>。
emotion 只能是 happy / sad / angry / think / surprised / awkward / question / curious / neutral 之一。
motion 只能是 ${[...motionKeys].sort().join(' / ')} 之一，可以不写。
回复的第一句必须以 <|ACT ...|> 开头，后面的句子想换情绪时再写一个。
需要停顿时写 <|PAUSE 1|>，数字是秒。
除了这些标记，不要写任何尖括号或方括号。`;
}

interface Section {
  owner: 'persona' | 'engine';
  text: string;
}

/**
 * The single ordered section list. Both renderers below read it; there is no second template.
 * character: [marker?, HARD_RULES, 我是谁, 性格, 此刻?, 说话方式?, tagGrammar, 示例?]
 * plain:     [PLAIN_RULES, tagGrammar]
 * An empty optional field drops its WHOLE section, heading included.
 */
function sections(card: CharacterCard, motionKeys: readonly string[], mode: PersonaMode): Section[] {
  const grammar: Section = { owner: 'engine', text: tagGrammar(motionKeys) };
  if (mode === 'plain') return [{ owner: 'engine', text: PLAIN_RULES }, grammar];
  const out: Section[] = [];
  if (card.marker) out.push({ owner: 'persona', text: card.marker });
  out.push({ owner: 'engine', text: HARD_RULES });
  out.push({ owner: 'persona', text: `【我是谁】\n名字：${card.name}\n${card.description}` });
  out.push({ owner: 'persona', text: `【性格】\n${card.personality}` });
  if (card.scenario) out.push({ owner: 'persona', text: `【此刻】\n${card.scenario}` });
  if (card.system_prompt) out.push({ owner: 'persona', text: `【说话方式】\n${card.system_prompt}` });
  out.push(grammar);
  if (card.mes_example) out.push({ owner: 'persona', text: `【示例】\n${card.mes_example}` });
  return out;
}

/**
 * Byte-stable: pure, no Date, no locale lookup, no randomness. `motionKeys` is sorted so key
 * order inside character.json cannot break the prefix cache. `post_history_instructions` is
 * NOT part of this string — it belongs to the latest user message (prompt.ts, §3.8.3).
 */
export function renderStaticSystem(
  card: CharacterCard,
  motionKeys: readonly string[],
  mode: PersonaMode = 'character',
): string {
  return sections(card, motionKeys, mode)
    .map((s) => s.text)
    .join('\n\n') + '\n';
}

/** Only the persona-owned sections — what A21's <= 700-token card budget is measured against. */
export function renderPersonaSections(card: CharacterCard): string {
  return sections(card, [], 'character')
    .filter((s) => s.owner === 'persona')
    .map((s) => s.text)
    .join('\n\n') + '\n';
}

/** A21: the card itself (marker + identity + personality + scenario + speech + examples). */
export const CARD_TOKEN_BUDGET = 700;
/** The whole rendered character-mode block: the card plus the shared engine sections. */
export const STATIC_SYSTEM_TOKEN_BUDGET = 1100;

export function cardTokens(card: CharacterCard): number {
  return estimateTokens(renderPersonaSections(card));
}

export function staticSystemTokens(
  card: CharacterCard,
  motionKeys: readonly string[],
  mode: PersonaMode = 'character',
): number {
  return estimateTokens(renderStaticSystem(card, motionKeys, mode));
}

export interface PhraseBucket {
  max: number;
  phrase: string;
}

export const MOOD_BUCKETS: readonly PhraseBucket[] = [
  { max: -0.6, phrase: '很低落' },
  { max: -0.2, phrase: '有点闷' },
  { max: 0.2, phrase: '平静' },
  { max: 0.6, phrase: '平静偏好' },
  { max: Number.POSITIVE_INFINITY, phrase: '挺高兴' },
];

export const ENERGY_BUCKETS: readonly PhraseBucket[] = [
  { max: 20, phrase: '快睡着了' },
  { max: 40, phrase: '有点困' },
  { max: 60, phrase: '一般' },
  { max: 80, phrase: '精神不错' },
  { max: Number.POSITIVE_INFINITY, phrase: '精力很足' },
];

export const AFFECTION_BUCKETS: readonly PhraseBucket[] = [
  { max: 10, phrase: '还不太熟' },
  { max: 30, phrase: '刚认识' },
  { max: 55, phrase: '熟悉起来了' },
  { max: 75, phrase: '熟络' },
  { max: 90, phrase: '很亲近' },
  { max: Number.POSITIVE_INFINITY, phrase: '离不开你' },
];

/** Half-open buckets: the FIRST bucket whose `max` strictly exceeds the value wins. */
export function pickPhrase(value: number, buckets: readonly PhraseBucket[]): string {
  for (const b of buckets) if (value < b.max) return b.phrase;
  return buckets[buckets.length - 1].phrase;
}

export const moodPhrase = (v: number): string => pickPhrase(v, MOOD_BUCKETS);
export const energyPhrase = (v: number): string => pickPhrase(v, ENERGY_BUCKETS);
export const affectionPhrase = (v: number): string => pickPhrase(v, AFFECTION_BUCKETS);
