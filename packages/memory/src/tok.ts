/**
 * The CJK-aware tokeniser R3-10 specifies (contracts §8.3):
 *   "tok(s) = NFKC -> lowercase -> for each CJK run emit every unigram and every bigram,
 *    Latin/digit words as-is."
 *
 * Why it exists at all: §0.3's recorded probe shows FTS5's `trigram` tokenizer returns ZERO rows
 * for `MATCH '面试'` against `我今天面试`, while a bigram-expanded row returns one. R3-10 overrules
 * spec §6's `tokenize='trigram'` on that evidence, and this file is the expansion.
 */

/**
 * The ranges the CJK expansion applies to — written with \u escapes on purpose (the same discipline
 * `@ds/brain`'s `estimateTokens` uses at `prompt.ts:17`): @ds/brain's six ranges MINUS the two
 * punctuation blocks. U+3040-30FF kana | U+3400-4DBF ext-A | U+4E00-9FFF unified |
 * U+F900-FAFF compat ideographs. `3000-303F` (、。《》〇) and `FF00-FFEF` (full-width forms) are
 * SEPARATORS here, not tokens: punctuation must break a bigram run, and NFKC has already folded
 * full-width Latin down to ASCII by the time the walk starts.
 * Literal form, for the reader: /[぀-ヿ㐀-䶿一-鿿豈-﫿]/u.
 */
const CJK = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;

/** A maximal run of these is one token, verbatim. */
const LATIN = /[A-Za-z0-9_]/u;

/**
 * The one walk both `tok` and `tokUnigram` use. NFKC-normalise, lowercase, then:
 *   - a maximal CJK run emits every unigram and (when `bigrams`) every adjacent bigram, in order;
 *   - a maximal [A-Za-z0-9_] run emits the word as one token;
 *   - anything else is a separator and emits nothing.
 * Deterministic, allocation-light, no dependencies.
 */
function walk(s: string, bigrams: boolean): string {
  const n = s.normalize('NFKC').toLowerCase();
  const out: string[] = [];
  let i = 0;
  while (i < n.length) {
    const ch = n[i];
    if (CJK.test(ch)) {
      let j = i;
      while (j < n.length && CJK.test(n[j])) j++;
      const run = n.slice(i, j);
      for (let k = 0; k < run.length; k++) {
        out.push(run[k]);
        if (bigrams && k + 1 < run.length) out.push(run.slice(k, k + 2));
      }
      i = j;
    } else if (LATIN.test(ch)) {
      let j = i;
      while (j < n.length && LATIN.test(n[j])) j++;
      out.push(n.slice(i, j));
      i = j;
    } else {
      i++;
    }
  }
  return out.join(' ');
}

/** `我今天面试` -> `我 我今 今 今天 天 天面 面 面试 试`; `喝 iced americano` -> `喝 iced americano`. */
export function tok(s: string): string {
  return walk(s, true);
}

/** The same walk emitting ONLY unigrams — the §8.4 second pass. */
export function tokUnigram(s: string): string {
  return walk(s, false);
}

/**
 * The character-bigram set of a string, reused by §4.8's near-duplicate check and §8.5's dedup.
 * Whitespace is removed first (so '我 累' and '我累' compare equal) and a single-character string is
 * its own single member, which keeps `jaccard` meaningful for one-character values.
 */
export function bigramSet(s: string): Set<string> {
  const n = s.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
  const out = new Set<string>();
  if (n.length === 0) return out;
  if (n.length === 1) {
    out.add(n);
    return out;
  }
  for (let i = 0; i + 1 < n.length; i++) out.add(n.slice(i, i + 2));
  return out;
}

/** |A∩B| / |A∪B|. Two empty sets are 0, not NaN — the callers threshold on >= 0.6. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * FTS5 query escaping: every token is wrapped in double quotes and OR-joined, so a token that
 * happens to be an FTS5 keyword (`AND`, `NOT`, `NEAR`) cannot change the query's shape. An embedded
 * `"` is doubled, which is FTS5's own escape inside a quoted string.
 *
 * Returns '' for an empty token list. Callers MUST skip the MATCH in that case: FTS5 raises
 * `fts5: syntax error near ""` on an empty match string (verified this session).
 */
export function toMatchQuery(tokens: string): string {
  const list = tokens.split(' ').filter((t) => t !== '');
  if (list.length === 0) return '';
  return list.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}
