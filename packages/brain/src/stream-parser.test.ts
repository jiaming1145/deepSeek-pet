import { describe, expect, it } from 'vitest';
import { StreamParser } from './stream-parser.ts';

const run = (chunks: string[]) => {
  const p = new StreamParser('t1');
  const ev = chunks.flatMap((c) => p.push(c));
  return { events: [...ev, ...p.flush()], miss: p.complianceMiss };
};

describe('StreamParser', () => {
  it('emits sentences carrying the current ACT and increasing seq', () => {
    const { events, miss } = run(['<|ACT emotion=happy motion=nod|>你回来啦！', '<|ACT emotion=curious|>今天做了什么？']);
    expect(miss).toBe(false);
    expect(events).toEqual([
      { turnId: 't1', seq: 0, text: '你回来啦！', emotion: 'happy', motion: 'nod' },
      { turnId: 't1', seq: 1, text: '今天做了什么？', emotion: 'curious' },
    ]);
  });

  it('defaults to neutral and flags a compliance miss when the reply has no leading ACT', () => {
    const { events, miss } = run(['嗯。']);
    expect(miss).toBe(true);
    expect(events[0]).toMatchObject({ emotion: 'neutral', text: '嗯。' });
  });

  it('attaches PAUSE to the following sentence', () => {
    const { events } = run(['<|ACT emotion=think|>让我想想。<|PAUSE 1|>好吧。']);
    expect(events[1]).toMatchObject({ text: '好吧。', pause: 1 });
  });

  it('ignores badtags and keeps text flowing', () => {
    const { events } = run(['<|ACT emotion=joy|>你好。']);
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('你好。');
    expect(events[0].emotion).toBe('neutral');
  });

  it('reassembles a control token split across chunks', () => {
    const { events, miss } = run(['<|ACT emo', 'tion=happy|>你回', '来啦！']);
    expect(miss).toBe(false);
    expect(events).toEqual([{ turnId: 't1', seq: 0, text: '你回来啦！', emotion: 'happy' }]);
  });

  it('attaches a motion to exactly one sentence and keeps the emotion', () => {
    const { events } = run(['<|ACT emotion=happy motion=nod|>你回来啦！今天怎么样？']);
    expect(events).toEqual([
      { turnId: 't1', seq: 0, text: '你回来啦！', emotion: 'happy', motion: 'nod' },
      { turnId: 't1', seq: 1, text: '今天怎么样？', emotion: 'happy' },
    ]);
  });

  it('leaves the sentence text raw so the linter sees what the model wrote', () => {
    const { events } = run(['<|ACT emotion=neutral|>**加粗**。']);
    expect(events[0].text).toBe('**加粗**。');
  });

  it('flushes a trailing sentence that never closed', () => {
    const { events } = run(['<|ACT emotion=neutral|>好']);
    expect(events).toEqual([{ turnId: 't1', seq: 0, text: '好', emotion: 'neutral' }]);
  });

  it('carries a PAUSE that arrives in its own chunk', () => {
    const { events } = run(['<|ACT emotion=sad|>不知道。', '<|PAUSE 0.5|>', '算了。']);
    expect(events[1]).toEqual({ turnId: 't1', seq: 1, text: '算了。', emotion: 'sad', pause: 0.5 });
  });
});

describe('StreamParser — compliance bookkeeping (G-13)', () => {
  it('leading whitespace before the ACT does not count as text', () => {
    const { events, miss } = run(['\n', '<|ACT emotion=happy|>你好。']);
    expect(miss).toBe(false);
    expect(events[0]).toMatchObject({ text: '你好。', emotion: 'happy' });
  });
  it('text that only arrives via flush still flags the compliance miss', () => {
    const { miss } = run(['嗯<|AC']);
    expect(miss).toBe(true);
  });
  it('an unclosed tag at end of stream is never painted as text', () => {
    const { events } = run(['<|ACT emotion=happy|>好。<|ACT emotion=sad']);
    expect(events.map((e) => e.text)).toEqual(['好。']);
  });
  it('a PAUSE beyond the bound is clamped on the event (I-5)', () => {
    const { events } = run(['<|ACT emotion=think|>让我想想。<|PAUSE 100000|>好吧。']);
    expect(events[1]).toMatchObject({ text: '好吧。', pause: 3 });
  });
});

describe('StreamParser { dropAct: true } — plain mode (§9.4)', () => {
  const runPlain = (chunks: string[]) => {
    const p = new StreamParser('t2', { dropAct: true });
    const ev = chunks.flatMap((c) => p.push(c));
    return { events: [...ev, ...p.flush()], miss: p.complianceMiss };
  };

  it('consumes and discards ACT tags, forces neutral, omits motion', () => {
    const { events, miss } = runPlain(['<|ACT emotion=happy motion=nod|>你好。', '<|ACT emotion=sad|>再见。']);
    expect(miss).toBe(false);
    expect(events).toEqual([
      { turnId: 't2', seq: 0, text: '你好。', emotion: 'neutral' },
      { turnId: 't2', seq: 1, text: '再见。', emotion: 'neutral' },
    ]);
  });

  it('does not raise complianceMiss when the reply has no ACT at all', () => {
    const { events, miss } = runPlain(['嗯。好的。']);
    expect(miss).toBe(false);
    expect(events.map((e) => e.emotion)).toEqual(['neutral', 'neutral']);
  });

  it('drops PAUSE entirely', () => {
    const { events } = runPlain(['让我想想。<|PAUSE 1|>好吧。']);
    expect(events[1]).toEqual({ turnId: 't2', seq: 1, text: '好吧。', emotion: 'neutral' });
    expect('pause' in events[1]).toBe(false);
  });

  it('a tag split across chunks is still discarded, never painted', () => {
    const { events } = runPlain(['<|ACT emo', 'tion=happy|>你回', '来啦！']);
    expect(events).toEqual([{ turnId: 't2', seq: 0, text: '你回来啦！', emotion: 'neutral' }]);
  });

  it('default options keep Phase 2 behaviour byte-for-byte', () => {
    const p = new StreamParser('t3', {});
    const events = [...p.push('嗯。'), ...p.flush()];
    expect(p.complianceMiss).toBe(true);
    expect(events[0]).toMatchObject({ emotion: 'neutral' });
  });
});
