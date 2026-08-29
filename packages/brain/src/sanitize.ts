const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const HALF_TO_FULL: Record<string, string> = { ',': '，', '.': '。', '!': '！', '?': '？', ':': '：', ';': '；' };

/**
 * Turns one raw model sentence into the exact characters the bubble paints.
 * Called exactly once per sentence, by TurnRunner at emission (contracts.md §3.11.2 / A10).
 * Emoji are preserved on purpose: A18 is a linter rule, not a sanitizer rule.
 * No grapheme segmentation here — that lives in RevealPlan (T7, the bubble renderer; D1).
 */
export function sanitizeForDisplay(input: string): string {
  // 1. carriage returns
  let t = input.replace(/\r/g, '');
  // 2. fenced code blocks out, inline backticks unwrapped
  t = t.replace(/```[\s\S]*?```/g, '').replace(/`([^`]*)`/g, '$1');
  // 3. emphasis, headings, list markers
  t = t
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '');
  // 4. stage directions
  t = t.replace(/\[[^\]\n]{1,40}\]/g, '').replace(/[（(]旁白[^）)]*[）)]/g, '');
  // 5. long dot runs
  t = t.replace(/\.{3,}|。{3,}/g, '……').replace(/…{3,}/g, '……');
  // 6. the V4 leading-number injection (A23)
  t = t.replace(/^\s*\d{1,3}\s+(?=\S)/, '');
  // 7. half-width -> full-width, only when a CJK char is adjacent
  t = t.replace(
    /([\s\S])([,.!?:;])(?=([\s\S]|$))/g,
    (m: string, before: string, p: string, after: string | undefined) => {
      const cjkNear = CJK.test(before) || (after !== undefined && after !== '' && CJK.test(after));
      return cjkNear ? before + HALF_TO_FULL[p] : m;
    },
  );
  // 8. whitespace
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}
