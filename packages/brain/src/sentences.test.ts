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
