/**
 * B-11 (contracts §12.7): "an extraction response truncated mid-JSON (`finish_reason: 'length'`) |
 * ZERO facts written | one console.warn | `facts` unchanged; `mem_turns_since_extract` still reset
 * (the attempt counted)". Data only — the runner is `src/main/fact-extractor.test.ts`.
 *
 * Directory convention: `apps/desktop/tests/fixtures/<area>/` (plan-header.md's resolution of the
 * §12.7 gap; Task 14's B-04 lives beside it under `proactive/`).
 */

/** The six user turns that drive the counter to N = 6 and become the extractor's user message. */
export const B11_USER_TURNS: readonly string[] = [
  '我下周三要去杭州面试',
  '有点紧张',
  '你觉得我该穿什么',
  '面试的是一家做游戏的公司',
  '我妈也挺关心这事的',
  '希望能过吧',
];

/**
 * A response that hit `max_tokens` mid-object: valid JSON up to the cut, unparsable as a whole.
 * The first fact is fully readable to a human, which is exactly the trap — a partial parse would
 * write it, and mem0#5428 is what that costs.
 */
export const B11_TRUNCATED_RESPONSE =
  '{"facts":[{"key":"job_interview","value":"主人下周三要去杭州面试一家游戏公司","alias":["面试","工作","游戏公司"],"confidence":0.9},{"key":"family_mother","value":"主人的妈妈很关心这次面';

/** The well-formed control, so the same harness proves the mechanism works when nothing is cut. */
export const B11_COMPLETE_RESPONSE =
  '{"facts":[{"key":"job_interview","value":"主人下周三要去杭州面试一家游戏公司","alias":["面试","工作","游戏公司"],"confidence":0.9}]}';

export const B11_EXPECTED = {
  truncated: { factsWritten: 0, warnings: 1, counterAfter: '0' },
  complete: { factsWritten: 1, warnings: 0, counterAfter: '0' },
} as const;
