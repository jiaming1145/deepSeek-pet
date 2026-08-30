import { describe, expect, it } from 'vitest';
import { SentenceSplitter } from './sentences.ts';

const run = (chunks: string[]) => { const s = new SentenceSplitter(); const out = chunks.flatMap((c) => s.push(c)); return [...out, ...s.flush()]; };

describe('SentenceSplitter', () => {
  it('splits on Chinese terminal punctuation', () => {
    expect(run(['你回来啦！今天累不累？'])).toEqual(['你回来啦！', '今天累不累？']);
  });
  it('keeps trailing text until flush', () => {
    const s = new SentenceSplitter();
    expect(s.push('我在想')).toEqual([]);
    expect(s.flush()).toEqual(['我在想']);
  });
  it('splits the FIRST sentence on a comma after 6 chars for a fast first reaction', () => {
    expect(run(['你终于回来了，我等了好久。'])).toEqual(['你终于回来了，', '我等了好久。']);
  });
  it('does not comma-split later sentences', () => {
    expect(run(['好。那个，我想说，其实没什么。'])).toEqual(['好。', '那个，我想说，其实没什么。']);
  });
  it('does not comma-split before 6 chars', () => {
    expect(run(['嗯，好的。'])).toEqual(['嗯，好的。']);
  });
  it('treats ellipsis and newline as boundaries and drops empty pieces', () => {
    expect(run(['等等……\n\n好吧'])).toEqual(['等等……', '好吧']);
  });
  it('handles a boundary split across chunks', () => {
    expect(run(['今天天气真好', '！走吧'])).toEqual(['今天天气真好！', '走吧']);
  });
});

describe('SentenceSplitter — chunk invariance (G-12)', () => {
  it('groups adjacent hard punctuation instead of splitting a cluster', () => {
    expect(run(['真的？！不会吧。'])).toEqual(['真的？！', '不会吧。']);
    expect(run(['太好了！！走。'])).toEqual(['太好了！！', '走。']);
    expect(run(['她说「好。」然后走了。'])).toEqual(['她说「好。」', '然后走了。']);
  });
  it('keeps a trailing extendable run until the next chunk or flush', () => {
    const s = new SentenceSplitter();
    expect(s.push('好吧…')).toEqual([]);
    expect(s.push('…再说')).toEqual(['好吧……']);
    expect(s.flush()).toEqual(['再说']);
  });
  it('settle() closes a held run at a definite boundary (a control tag)', () => {
    const s = new SentenceSplitter();
    expect(s.push('回来啦！')).toEqual([]);
    expect(s.settle()).toEqual(['回来啦！']);
    expect(s.settle()).toEqual([]);
    expect(s.push('今天')).toEqual([]);
    expect(s.settle()).toEqual([]);
    expect(s.flush()).toEqual(['今天']);
  });
  it('finds the first eligible comma at or after minFirstChars', () => {
    expect(run(['嗯，好的好的好的，我知道了。'])).toEqual(['嗯，好的好的好的，', '我知道了。']);
  });

  const FIXTURES = [
    '真的？！不会吧。',
    '好吧……再说吧。',
    '太好了！！走。',
    '嗯，好的好的好的，我知道了。',
    '你回来啦！今天累不累？',
    '等等……\n\n好吧',
    '她说「好。」然后走了。',
    '你终于回来了，我等了好久。',
    '好。那个，我想说，其实没什么。',
    '嗯，好的。',
    '主人今天又熬夜了对吧？睡觉！！！明天再说……好不好？',
    '3.14 是圆周率，Hello, world! 对吧？嗯……',
  ];

  function* splits(len: number, parts: number, from = 0): Generator<number[]> {
    if (parts === 1) { yield []; return; }
    for (let i = from + 1; i < len; i++) for (const rest of splits(len, parts - 1, i)) yield [i, ...rest];
  }
  const chunk = (s: string, cuts: number[]): string[] => {
    const out: string[] = [];
    let prev = 0;
    for (const c of cuts) { out.push(s.slice(prev, c)); prev = c; }
    out.push(s.slice(prev));
    return out;
  };
  const rng = (seed: number) => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  it.each(FIXTURES)('yields the same sentences for every 2-way split of %s', (text) => {
    const expected = run([text]);
    for (const cuts of splits(text.length, 2)) expect(run(chunk(text, cuts)), JSON.stringify(cuts)).toEqual(expected);
  });
  it.each(FIXTURES.filter((t) => t.length <= 12))('yields the same sentences for every 3-way split of %s', (text) => {
    const expected = run([text]);
    for (const cuts of splits(text.length, 3)) expect(run(chunk(text, cuts)), JSON.stringify(cuts)).toEqual(expected);
  });
  it.each(FIXTURES)('yields the same sentences for seeded random chunkings of %s', (text) => {
    const expected = run([text]);
    const random = rng(42);
    for (let trial = 0; trial < 60; trial++) {
      const cuts = [...new Set(Array.from({ length: 1 + Math.floor(random() * 5) }, () => 1 + Math.floor(random() * (text.length - 1))))].sort((a, b) => a - b);
      expect(run(chunk(text, cuts)), JSON.stringify(cuts)).toEqual(expected);
    }
  });
  it('yields the same sentences character by character', () => {
    for (const text of FIXTURES) expect(run([...text])).toEqual(run([text]));
  });
});
