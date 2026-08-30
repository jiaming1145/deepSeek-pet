import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { bigramSet, jaccard, tok, toMatchQuery, tokUnigram } from './tok.ts';

describe('tok (contracts §8.3, R3-10)', () => {
  it('expands a CJK run into every unigram AND every adjacent bigram, in order', () => {
    // The contract's own worked example, character for character.
    expect(tok('我今天面试')).toBe('我 我今 今 今天 天 天面 面 面试 试');
  });

  it('passes Latin/digit words through as single tokens', () => {
    expect(tok('喝 iced americano')).toBe('喝 iced americano');
    expect(tok('room_101')).toBe('room_101');
    expect(tok('GPT-4o')).toBe('gpt 4o'); // '-' is a separator, not part of a word
  });

  it('NFKC-folds full-width Latin and lowercases', () => {
    expect(tok('ＡＢＣ')).toBe('abc');
    expect(tok('ＡＢＣ123')).toBe('abc123'); // NFKC makes it ONE Latin run
    expect(tok('Hello')).toBe('hello');
  });

  it('mixes CJK and Latin without gluing them together', () => {
    expect(tok('我喝 latte')).toBe('我 我喝 喝 latte');
    expect(tok('cat猫')).toBe('cat 猫');
  });

  it('treats punctuation and whitespace as separators that break the bigram run', () => {
    // '，' is NOT a CJK token here (§8.3 excludes the punctuation blocks) and it splits the run,
    // so no bigram straddles it.
    expect(tok('我累，你呢')).toBe('我 我累 累 你 你呢 呢');
    expect(tok('  \n 我 ')).toBe('我');
    expect(tok('')).toBe('');
    expect(tok('。。。')).toBe('');
  });

  it('emits a lone CJK character as one unigram and no bigram', () => {
    expect(tok('猫')).toBe('猫');
    expect(tokUnigram('猫')).toBe('猫');
  });

  it('tokUnigram is the same walk without bigrams (the §8.4 second pass)', () => {
    expect(tokUnigram('我今天面试')).toBe('我 今 天 面 试');
    expect(tokUnigram('喝 iced americano')).toBe('喝 iced americano');
  });

  it('includes kana and CJK ext-A, excludes the CJK punctuation block', () => {
    expect(tok('ねこ')).toBe('ね ねこ こ');
    expect(tok('㐀㐁')).toBe('㐀 㐀㐁 㐁'); // ext-A, U+3400..
    expect(tok('〇一')).toBe('一'); // U+3007 is CJK punctuation: a separator, not a token
  });
});

describe('toMatchQuery (contracts §8.3)', () => {
  it('quotes every token and OR-joins them', () => {
    expect(toMatchQuery(tok('面试'))).toBe('"面" OR "面试" OR "试"');
    expect(toMatchQuery('a b')).toBe('"a" OR "b"');
  });

  it('returns the empty string for an empty token list, so the caller can skip the MATCH', () => {
    // FTS5 raises `fts5: syntax error near ""` on an empty MATCH string — verified this session.
    expect(toMatchQuery('')).toBe('');
    expect(toMatchQuery('   ')).toBe('');
  });

  it('neutralises FTS5 keywords and embedded quotes so a token cannot reshape the query', () => {
    expect(toMatchQuery('AND NOT NEAR')).toBe('"AND" OR "NOT" OR "NEAR"');
    expect(toMatchQuery('a"b')).toBe('"a""b"');
  });
});

describe('bigramSet / jaccard (contracts §8.3; reused by §4.8 and §8.5)', () => {
  it('is the character-bigram set, whitespace-insensitive and NFKC-folded', () => {
    expect([...bigramSet('面试')]).toEqual(['面试']);
    expect([...bigramSet('abc')]).toEqual(['ab', 'bc']);
    expect(bigramSet('我 累')).toEqual(bigramSet('我累'));
    expect([...bigramSet('猫')]).toEqual(['猫']); // a single character is its own member
    expect(bigramSet('').size).toBe(0);
  });

  it('jaccard is |A∩B| / |A∪B|, 1 for identity and 0 for two empties', () => {
    expect(jaccard(bigramSet('面试'), bigramSet('面试'))).toBe(1);
    expect(jaccard(bigramSet('面试'), bigramSet('医院'))).toBe(0);
    expect(jaccard(bigramSet(''), bigramSet(''))).toBe(0);
    // DEVIATION (task-2 Step 6): the brief writes `toBeGreaterThan(0.6)`, but the value is
    // EXACTLY 0.6 — |A∩B| = 6 (我下 下周 周三 三要 要去 面试), |A∪B| = 10, verified this session.
    // The near-duplicate predicate this pins is `>= FACT_MERGE_JACCARD`, so 0.6 IS a merge, and
    // `toBeGreaterThanOrEqual` is the faithful assertion. The implementation is unchanged.
    expect(
      jaccard(bigramSet('我下周三要去面试'), bigramSet('我下周三要去杭州面试')),
    ).toBeGreaterThanOrEqual(0.6);
  });
});

describe('§0.3 probe, reproduced as a unit test (R3-10 overrules spec §6 trigram)', () => {
  it('a bigram-expanded row is found by MATCH 面试 where a trigram table finds nothing', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE VIRTUAL TABLE f USING fts5(body, alias, tokenize='unicode61')`);
    db.exec(`CREATE VIRTUAL TABLE t USING fts5(b, tokenize='trigram')`);
    db.prepare('INSERT INTO f VALUES (?, ?)').run(tok('我今天面试通过了'), tok('面试 工作'));
    db.prepare('INSERT INTO t VALUES (?)').run('我今天面试通过了');

    const bigram = db
      .prepare('SELECT COUNT(*) AS n FROM f WHERE f MATCH ?')
      .get(toMatchQuery(tok('面试'))) as { n: number };
    const trigram = db
      .prepare(`SELECT COUNT(*) AS n FROM t WHERE t MATCH '面试'`)
      .get() as { n: number };

    expect(bigram.n).toBe(1); // §0.3 recorded: `bigram MATCH 面试 1`
    expect(trigram.n).toBe(0); // §0.3 recorded: `trigram MATCH 面试 0`
    db.close();
  });
});
