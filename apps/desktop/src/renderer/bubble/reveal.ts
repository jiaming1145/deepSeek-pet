/**
 * Chinese reveal cadence (contracts.md §5.1, ruling R10.4).
 *
 * `delayMs` is the wait BEFORE painting its grapheme, so a step's grapheme becomes visible after
 * its own delay has elapsed. Punctuation costs its own base delay PLUS the pause, and closes the
 * mouth. Segmentation is grapheme-cluster based, which is where D1's grapheme awareness lives —
 * `sanitizeForDisplay` in @ds/brain no longer pretends to do it.
 */
export interface RevealStep {
  grapheme: string;
  delayMs: number;
  mouth: boolean;
}

export interface RevealOptions {
  hanziMs?: number;
  latinMs?: number;
  commaMs?: number;
  periodMs?: number;
}

export const REVEAL_DEFAULTS = { hanziMs: 70, latinMs: 35, commaMs: 150, periodMs: 300 } as const;

export const COMMA_PUNCT = '，、；：,;:';
export const SENTENCE_PUNCT = '。！？!?…';

/** Printable ASCII (Latin letters, digits, ASCII punctuation and the space) reveals at latinMs. */
const ASCII = /^[\x20-\x7E]$/;

/** One instance per module: constructing a Segmenter per sentence is measurable at 70 ms/step. */
const SEGMENTER = new Intl.Segmenter('zh', { granularity: 'grapheme' });

export class RevealPlan {
  private readonly plan: RevealStep[];

  constructor(text: string, opts?: RevealOptions) {
    const o = { ...REVEAL_DEFAULTS, ...opts };
    const plan: RevealStep[] = [];
    for (const { segment } of SEGMENTER.segment(text)) {
      const comma = COMMA_PUNCT.includes(segment);
      const sentence = SENTENCE_PUNCT.includes(segment);
      let delayMs = ASCII.test(segment) ? o.latinMs : o.hanziMs;
      if (comma) delayMs += o.commaMs;
      if (sentence) delayMs += o.periodMs;
      plan.push({ grapheme: segment, delayMs, mouth: !comma && !sentence && !/\s/.test(segment) });
    }
    this.plan = plan;
  }

  steps(): readonly RevealStep[] {
    return this.plan;
  }

  /** Plain sum. `……` is two `…` graphemes and costs 2 x (70 + 300) = 740 ms; the linter caps it. */
  totalMs(): number {
    let total = 0;
    for (const s of this.plan) total += s.delayMs;
    return total;
  }
}
