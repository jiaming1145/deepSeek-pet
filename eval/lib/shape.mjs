// eval/lib/shape.mjs — local shape metrics (contracts.md §7.3 "computed locally").
// emojiCount mirrors the helper @ds/brain keeps private in slop-lint.ts §3.6.2.
const GRAPHEME = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const HAN = /\p{Script=Han}/u;
const EMOJI = /\p{Extended_Pictographic}/u;

export function countHanzi(s) {
  let n = 0;
  for (const ch of s) if (HAN.test(ch)) n++;
  return n;
}

export function splitSentences(s) {
  return s.split(/(?<=[。！？!?])/).filter((x) => x.trim());
}

export function endsWithQuestion(s) {
  return /[？?]\s*$/.test(s);
}

export function emojiCount(s) {
  let n = 0;
  for (const g of GRAPHEME.segment(s)) if (EMOJI.test(g.segment)) n++;
  return n;
}

export function ellipsisCount(s) {
  return (s.match(/……/g) ?? []).length;
}

export function fourGrams(s) {
  const out = new Set();
  const t = s.replace(/\s+/g, '');
  for (let i = 0; i + 4 <= t.length; i++) out.add(t.slice(i, i + 4));
  return out;
}

export function overlapRatio(a, b) {
  if (a.size === 0) return 0;
  let hit = 0;
  for (const g of a) if (b.has(g)) hit++;
  return hit / a.size;
}

export function shapeOf(reply) {
  return {
    hanzi: countHanzi(reply),
    sentences: splitSentences(reply).length,
    endsWithQuestion: endsWithQuestion(reply),
    emojiCount: emojiCount(reply),
    ellipsisCount: ellipsisCount(reply),
  };
}
