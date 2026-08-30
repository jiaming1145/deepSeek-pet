import { LookAnchorSchema, SAY_MAX_GRAPHEMES, WalkAnchorSchema, type LookTarget, type WalkAnchor } from '@ds/protocol';

/** ONE home for the type: §2.6 spells the union out here, but Task 1 already exports the identical
 *  `z.infer<typeof LookTargetSchema>` from `@ds/protocol`. Re-exported, never redeclared (R3-48;
 *  Task 1 Concern 2). Structurally: `{kind:'anchor'; anchor: LookAnchor} | {kind:'point'; x; y}`. */
export type { LookTarget };

/** §2.6: `look=x,y`, up to two decimals, each in [-1, 1]. */
export const LOOK_POINT_RE = /^-?(?:0(?:\.\d{1,2})?|1(?:\.0{1,2})?),-?(?:0(?:\.\d{1,2})?|1(?:\.0{1,2})?)$/;

/** Parses the `look=` attribute value. Returns null for anything unrecognised (caller logs). */
export function parseLook(raw: string): LookTarget | null {
  const anchor = LookAnchorSchema.safeParse(raw);
  if (anchor.success) return { kind: 'anchor', anchor: anchor.data };
  if (!LOOK_POINT_RE.test(raw)) return null;
  const [x, y] = raw.split(',').map(Number);
  return { kind: 'point', x, y };
}

/** Parses the `walkTo=` attribute value. Symbolic anchors only (Convai's objects[].name model). */
export function parseWalkTo(raw: string): WalkAnchor | null {
  const r = WalkAnchorSchema.safeParse(raw);
  return r.success ? r.data : null;
}

const SEG = new Intl.Segmenter('zh', { granularity: 'grapheme' });
/** Mirrors sentences.ts HARD's terminator set (。！？!? and …) without the newline arm. */
export const SAY_TERMINATOR_RE = /[。！？!?…]/;

/** The §2.6 `say` bound, applied AFTER sanitizeForDisplay. Never drops: a truncated line beats a silent turn. */
export function boundSay(text: string): { text: string; truncated: boolean } {
  const graphemes = [...SEG.segment(text)].map((s) => s.segment);
  if (graphemes.length <= SAY_MAX_GRAPHEMES) return { text, truncated: false };
  const head = graphemes.slice(0, SAY_MAX_GRAPHEMES);
  let cut = -1;
  for (let i = head.length - 1; i >= 0; i--) {
    if (SAY_TERMINATOR_RE.test(head[i])) { cut = i; break; }
  }
  return { text: (cut >= 0 ? head.slice(0, cut + 1) : head).join(''), truncated: true };
}

export const ACT_ATTRS = ['emotion', 'motion', 'look', 'walkTo'] as const;
