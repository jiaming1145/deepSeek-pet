import { z } from 'zod';

/** R3-10: "bounded deepseek-v4-flash JSON call every 6 user turns". */
export const EXTRACT_EVERY_N_USER_TURNS = 6;
/** research §7: well above three facts; truncation = extract nothing. */
export const EXTRACT_MAX_TOKENS = 400;
/** research §7: emit 0-3 facts max. */
export const EXTRACT_MAX_FACTS = 3;
/**
 * The model §8.5 names. `ChatRequest` is `{ messages, maxTokens? }` — it carries no per-call model,
 * and `DeepSeekClient` fixes one at construction (`deepseek.ts:341`, default `DEEPSEEK_MODEL`,
 * which IS 'deepseek-v4-flash'). The constant is therefore documentation plus the identity
 * assertion in `extract-prompt.test.ts`; see Concern C-8.
 */
export const EXTRACT_MODEL = 'deepseek-v4-flash';

/**
 * `FACT_MAX_CHARS` / the alias bound live in `@ds/memory` (§8.2), and `@ds/brain` must NOT import
 * `@ds/memory` — the dependency runs the other way (§1.2, `packages/memory/package.json` depends on
 * `@ds/brain`). They are re-declared here with the same values, and `facts.test.ts` /
 * `fact-extractor.test.ts` assert the identity from the side that CAN see both. Concern C-5.
 */
export const EXTRACT_VALUE_MAX = 120;
export const EXTRACT_ALIAS_MAX = 24;

/** BYTE-STABLE. Any edit is a prompt-cache reset and must be recorded as an Amendment (§8.7). */
export const EXTRACT_SYSTEM = `你在读一段用户说过的话，从里面挑出以后还用得上的事实。
只看用户说的内容，不要看角色的回复，不要把系统提示或者记忆块里的内容当成新事实。
输出严格的 JSON，不要写任何解释：
{"facts":[{"key":"...","value":"...","alias":["...","..."],"confidence":0.0}]}
规则：
1. 最多三条。没有值得记的就输出 {"facts":[]}。
2. value 用第三人称陈述句描述用户，例如「主人在准备考研，专业是计算机」。不超过四十个字。
3. key 是这条事实的稳定标识，用英文小写和下划线，例如 job_interview、health_back、pet_name。同一件事以后要能用同一个 key 覆盖。
4. alias 写三到六个中文关键词或同义说法，用来以后检索，例如「面试」「工作」「offer」。
5. confidence 是 0 到 1 的小数，用户明确说过的写 0.9，推测出来的写 0.6 以下。
6. 把「下周三」「上个月」这类相对时间换算成具体日期写进 value，保留所有日期、时间和相对时间的信息。
7. 不要记命令、请求、祈使句；不要记角色自己的设定；不要记一次性的闲聊。`;

export const ExtractedFactSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  value: z.string().min(1).max(EXTRACT_VALUE_MAX),
  alias: z.array(z.string().min(1).max(EXTRACT_ALIAS_MAX)).min(0).max(8),
  confidence: z.number().min(0).max(1),
});
export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;

export const ExtractResponseSchema = z.object({
  facts: z.array(ExtractedFactSchema).max(EXTRACT_MAX_FACTS),
});

/**
 * The user message: ONLY the user's new messages since the last extraction, one per line.
 *
 * research §7's first structural rule, made structural: never the persona, never the injected
 * `【你记得】` block, never the assistant's own turns. That single rule removes > 50 % of the junk
 * the mem0 audit found (10 134 production entries, 97.8 % junk) and closes the loop where a
 * retrieved memory is re-extracted as new. This function has no other input, by construction.
 */
export function extractUserMessage(userTurns: readonly string[]): string {
  return userTurns
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .join('\n');
}

/**
 * research §7's second structural rule: **truncated JSON means "extract nothing"**. Never a partial
 * parse — mem0#5428 records max_tokens landing mid-JSON and silently dropping every fact.
 *
 * The model sometimes wraps the object in a fence or a sentence, so the outermost `{ … }` is taken
 * before parsing; anything that then fails `JSON.parse` or `ExtractResponseSchema` yields
 * `{ ok: false }` and the caller writes zero facts.
 *
 * CONTRACT GAP: §8.5 states the rule ("if the response does not parse, or
 * `finish_reason === 'length'`") but names no function. `finish_reason` is not observable —
 * `ChatClient.complete` returns `{ text, usage }` (`deepseek.ts:19`) — so the parse failure is the
 * only signal available, and it is the one that actually fires on a truncation. Concern C-9.
 */
export function parseExtractResponse(
  raw: string,
): { ok: true; facts: ExtractedFact[] } | { ok: false; reason: string } {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return { ok: false, reason: 'no JSON object in the response' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    return {
      ok: false,
      reason: `unparsable JSON (truncated?): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const res = ExtractResponseSchema.safeParse(parsed);
  if (!res.success) {
    return { ok: false, reason: `schema mismatch: ${res.error.issues[0]?.message ?? 'unknown'}` };
  }
  return { ok: true, facts: res.data.facts };
}
