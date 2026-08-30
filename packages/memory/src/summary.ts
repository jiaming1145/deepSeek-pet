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

/** R3-10's sanitisation bound, in grapheme clusters. Identical to `FACT_MAX_CHARS` by design. */
export const MEMORY_LABEL_MAX = 120;

/**
 * C0 and C1 control characters, EXCEPT the five whitespace controls U+0009..U+000D
 * (tab, LF, VT, FF, CR).
 *
 * DEVIATION (task-2 Step 13a), forced and covered by summary.test.ts: §8.10's step 2 says "strip
 * C0/C1 controls" and its step 5 says "collapse every whitespace run to a single space". Stripping
 * `\n` outright in step 2 would leave step 5 nothing to collapse, so ` 【A】\n\nB ` would sanitise
 * to `[A]B` — and the brief's own case "keeps the Phase 2 assertion byte-for-byte" requires
 * `[A] B`, as does Phase 2's `capSummary('用户叫阿明。\n【记住】…')` at summary.test.ts:78. The
 * whitespace controls are therefore left for step 5, which is where §8.10 actually handles them;
 * every non-whitespace control still dies here. U+0085 (NEL) is C1 and is NOT JS whitespace, so it
 * is stripped, exactly as the brief's `ab -> ab` case demands.
 */
const CONTROLS = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/gu;

/**
 * Every Unicode Cf (format) code point, plus the three separators that are not Cf but behave like
 * invisible line breaks: U+200B ZWSP, U+2028 LS, U+2029 PS. This covers §8.10's named set
 * (U+200B..U+200F, U+2028/2029, U+202A..U+202E, U+FEFF) and everything else in the category — a
 * bidi override or an invisible joiner inside a fact is a display forgery, not memory.
 */
const FORMAT = /[\p{Cf}\u200B\u2028\u2029]/gu;

/**
 * §8.10 step 1 is "NFKC normalise". Applied to the whole string, NFKC also flattens the FULL-WIDTH
 * ASCII block (U+FF01..U+FF5E) into half-width ASCII — so `用户叫阿明，喜欢深夜写代码。` would be
 * stored as `用户叫阿明,喜欢深夜写代码。`. That is a visible regression in a Chinese-language
 * product, and it breaks the Phase 2 round-trip `summary.test.ts:45-46` that this task's brief does
 * NOT list among the lines it changes. Verified this session: NFKC maps ，！？：；（） to ,!?:;()
 * while leaving 。、《》【】 untouched.
 *
 * DEVIATION (task-2 Step 13a), recorded as a Concern: step 1 normalises everything EXCEPT the
 * full-width punctuation Chinese prose actually uses. Both purposes of the step survive intact —
 *   - full-width LATIN and DIGITS still fold (`ＡＢＣ` -> `ABC`), which is what §8.10's own case and
 *     the tokeniser need, and what stops a look-alike identifier;
 *   - ＜ ＞ ｜ ［ ］ (U+FF1C/FF1E/FF5C/FF3B/FF3D) are deliberately NOT preserved, so a full-width
 *     `＜｜ACT｜＞` still folds to `<|ACT|>` and is then neutralised by step 4.
 * Only inert prose punctuation is kept as the user wrote it.
 */
const KEEP_FULLWIDTH =
  /[\uFF01-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF5E\uFFE0-\uFFE6]/u;

/**
 * NFKC over every run that is not preserved punctuation, concatenated. Splitting on the preserved
 * characters is safe (a combining mark never meaningfully follows full-width punctuation) and,
 * unlike a placeholder scheme, it cannot be confused by private-use code points in untrusted input.
 * Idempotent: preserved characters stay preserved, and NFKC is idempotent on the rest.
 */
function normalizeKeepingProsePunctuation(s: string): string {
  let out = '';
  let buf = '';
  for (const ch of s) {
    if (KEEP_FULLWIDTH.test(ch)) {
      if (buf !== '') {
        out += buf.normalize('NFKC');
        buf = '';
      }
      out += ch;
    } else {
      buf += ch;
    }
  }
  return buf === '' ? out : out + buf.normalize('NFKC');
}

const GRAPHEMES = new Intl.Segmenter('zh', { granularity: 'grapheme' });

/**
 * §8.10 — the ONE helper. Applied to every LLM-written memory string (fact values, fact aliases,
 * the running summary) at BOTH boundaries: before it enters the FTS index, and again before it is
 * interpolated into a prompt. Idempotent, so double application is harmless.
 *
 *  1. NFKC normalise.
 *  2. Strip C0/C1 controls and every Unicode Cf code point (ZWSP/ZWJ/RLO/BOM/LS/PS included).
 *  3. `【` -> `[`, `】` -> `]`  (so a fact can never forge a prompt section header).
 *  4. Replace `<|` and `|>` with `(` and `)` (so a fact can never forge a control token).
 *  5. Collapse every whitespace run — newlines included — to a single space, then trim.
 *  6. Truncate to `max` grapheme clusters (Intl.Segmenter), no ellipsis added.
 *
 * M-5 (Phase 2 carry, R3-17 item 3), closed here: memory text is spliced into the prompt next to
 * the card's `【记住】`-style post-history instructions, so a poisoned summary or fact must not be
 * able to carry a forged instruction line, a forged `<|ACT …|>` tag, or an invisible reordering.
 *
 * `max` defaults to MEMORY_LABEL_MAX because every LABEL caller wants that bound. `capSummary` is
 * the one caller that must NOT truncate here — a running summary is up to SUMMARY_CHAR_CAP long and
 * is cut on a sentence boundary, never mid-clause — so it passes Infinity. See Concern C-4.
 */
export function sanitizeMemoryText(text: string, max: number = MEMORY_LABEL_MAX): string {
  const cleaned = normalizeKeepingProsePunctuation(text)
    .replace(CONTROLS, '')
    .replace(FORMAT, '')
    .replace(/【/g, '[')
    .replace(/】/g, ']')
    .replace(/<\|/g, '(')
    .replace(/\|>/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
  if (!Number.isFinite(max)) return cleaned;
  const parts = [...GRAPHEMES.segment(cleaned)];
  return parts.length <= max
    ? cleaned
    : parts
        .slice(0, max)
        .map((p) => p.segment)
        .join('');
}

/**
 * §8.6 / R3-10: the CONSERVATIVE token bound — one token per CJK code point.
 *
 * The disagreement, recorded rather than papered over: the shipped `estimateTokens`
 * (`prompt.ts:20-31`) counts CJK at 1/1.5, so a summary at exactly 600 estimated tokens can be
 * 900 hanzi, which a 1-token-per-char model reads as ~900 tokens. Phase 3 does NOT change
 * `estimateTokens` — it is the single oracle for planTrim, cardTokens, messages.tokens and the
 * eval, and re-scaling it would invalidate every Phase 2 measurement. `capSummary` gains this
 * second bound alongside the first instead.
 *
 * The CJK ranges are `estimateTokens`'s six, deliberately including CJK punctuation and full-width
 * forms so 。！？，、《》 cost the same as a hanzi. They are re-declared here rather than imported
 * because `prompt.ts`'s `CJK_TOK` is module-private and `prompt.ts` is not this task's file;
 * `summary.test.ts` pins both functions against the same strings so they cannot drift silently.
 */
const CJK_CONSERVATIVE =
  /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

export function estimateTokensConservative(s: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of s) {
    if (CJK_CONSERVATIVE.test(ch)) cjk++;
    else if (/\s/.test(ch)) continue;
    else if (/[A-Za-z0-9]/.test(ch)) continue; // counted by word below
    else other++;
  }
  const latinWords = (s.match(/[A-Za-z0-9]+/g) ?? []).length;
  return Math.ceil(cjk + latinWords * 1.3 + other * 0.3);
}

/** §8.6: the conservative bound, in CJK code points. */
export const SUMMARY_CHAR_CAP = 600;

/**
 * Enforces the running-summary budget by dropping whole sentences from the END until the remainder
 * fits BOTH bounds (§8.6): `estimateTokens <= maxTokens` AND
 * `estimateTokensConservative <= maxChars`. The conservative bound binds first for pure Chinese
 * (600 hanzi = 600 conservative tokens vs 400 by the shipped oracle), which is exactly the case
 * R3-10 is protecting; the token bound still binds for Latin-heavy text.
 *
 * Degenerate case (pinned by §4.4, unchanged): a text whose first sentence alone exceeds a cap —
 * or that has no terminator at all — is kept whole rather than cut mid-sentence. An over-cap
 * summary is a bounded, visible cost; a summary sliced mid-clause is silent corruption of the
 * model's memory.
 */
export function capSummary(
  text: string,
  maxTokens: number = SUMMARY_TOKEN_CAP,
  maxChars: number = SUMMARY_CHAR_CAP,
): string {
  // Infinity: the 120-grapheme LABEL bound must not touch a summary (§8.10's note).
  const trimmed = sanitizeMemoryText(text, Number.POSITIVE_INFINITY);
  if (
    trimmed === '' ||
    (estimateTokens(trimmed) <= maxTokens && estimateTokensConservative(trimmed) <= maxChars)
  ) {
    return trimmed;
  }
  const parts = trimmed.split(SENTENCE_BOUNDARY).filter((s) => s.trim() !== '');
  let kept = '';
  for (const part of parts) {
    const next = kept + part;
    if (estimateTokens(next) > maxTokens || estimateTokensConservative(next) > maxChars) break;
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
