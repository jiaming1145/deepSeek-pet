import { describe, expect, it } from 'vitest';
import { PAUSE_MAX_S } from '@ds/protocol';
import { TagScanner, parseTag } from './tags.ts';
import type { ScanItem } from './types.ts';

const run = (chunks: string[]) => { const s = new TagScanner(); const out = chunks.flatMap((c) => s.push(c)); return [...out, ...s.flush()]; };
/** Text items are chunk-granular by design; the invariance checks compare them merged. */
const merged = (items: ScanItem[]): ScanItem[] => items.reduce<ScanItem[]>((acc, it) => {
  const last = acc.at(-1);
  if (it.kind === 'text' && last?.kind === 'text') acc[acc.length - 1] = { kind: 'text', text: last.text + it.text };
  else acc.push(it);
  return acc;
}, []);

describe('TagScanner', () => {
  it('parses a leading ACT with motion', () => {
    expect(run(['<|ACT emotion=happy motion=nod|>你好'])).toEqual([
      { kind: 'tag', tag: { kind: 'act', emotion: 'happy', motion: 'nod' } },
      { kind: 'text', text: '你好' },
    ]);
  });
  it('reassembles a tag split across chunks', () => {
    expect(run(['今天<|ACT emo', 'tion=curious|>怎么样'])).toEqual([
      { kind: 'text', text: '今天' },
      { kind: 'tag', tag: { kind: 'act', emotion: 'curious' } },
      { kind: 'text', text: '怎么样' },
    ]);
  });
  it('parses PAUSE seconds', () => {
    expect(run(['<|PAUSE 1.5|>'])).toEqual([{ kind: 'tag', tag: { kind: 'pause', seconds: 1.5 } }]);
  });
  it('emits an unknown emotion as badtag', () => {
    expect(run(['<|ACT emotion=joy|>'])).toEqual([{ kind: 'badtag', raw: '<|ACT emotion=joy|>' }]);
  });
  it('G-10: gives up on an unterminated <| after 64 chars and emits it as badtag, never text', () => {
    const long = '<|' + 'x'.repeat(70);
    expect(run([long])).toEqual([{ kind: 'badtag', raw: long }]);
  });
  it('reassembles a tag split exactly after the opening <', () => {
    expect(run(['<', '|ACT emotion=happy|>', '你好'])).toEqual([
      { kind: 'tag', tag: { kind: 'act', emotion: 'happy' } },
      { kind: 'text', text: '你好' },
    ]);
  });
  it('holds a trailing < mid-text until the next chunk decides it', () => {
    expect(run(['今天<', '|ACT emotion=curious|>怎么样'])).toEqual([
      { kind: 'text', text: '今天' },
      { kind: 'tag', tag: { kind: 'act', emotion: 'curious' } },
      { kind: 'text', text: '怎么样' },
    ]);
  });
  it('emits a held < once the next chunk proves it is not a tag', () => {
    expect(run(['a<', 'b'])).toEqual([{ kind: 'text', text: 'a' }, { kind: 'text', text: '<b' }]);
  });
  it('flush emits a genuine trailing < at end of stream', () => {
    expect(run(['3 < 5, 5 <'])).toEqual([{ kind: 'text', text: '3 < 5, 5 ' }, { kind: 'text', text: '<' }]);
  });
  it('G-10: flush emits a pending short <| prefix as badtag, never text', () => {
    expect(run(['嗯<|AC'])).toEqual([{ kind: 'text', text: '嗯' }, { kind: 'badtag', raw: '<|AC' }]);
  });
});

describe('TagScanner — chunk boundary on the opening <', () => {
  it('holds a trailing < after text and releases it when it was not a tag', () => {
    expect(run(['a<', 'b'])).toEqual([
      { kind: 'text', text: 'a' },
      { kind: 'text', text: '<b' },
    ]);
  });
  it('flushes a lone trailing < at end of stream as text', () => {
    expect(run(['你好<'])).toEqual([
      { kind: 'text', text: '你好' },
      { kind: 'text', text: '<' },
    ]);
  });
});

describe('TagScanner — malformed candidates (I-1 / G-10 / G-11)', () => {
  it('I-1: a candidate missing its | does not swallow prose up to the next |>', () => {
    expect(run(['<|ACT emotion=happy>你好。', '<|ACT emotion=sad|>今天。'])).toEqual([
      { kind: 'badtag', raw: '<|ACT emotion=happy>' },
      { kind: 'text', text: '你好。' },
      { kind: 'tag', tag: { kind: 'act', emotion: 'sad' } },
      { kind: 'text', text: '今天。' },
    ]);
  });
  it('I-1: a candidate missing its > keeps the sentences between as text', () => {
    expect(run(['<|ACT emotion=happy|你好。今天怎么样。', '<|ACT emotion=sad|>嗯。'])).toEqual([
      { kind: 'badtag', raw: '<|ACT emotion=happy|' },
      { kind: 'text', text: '你好。今天怎么样。' },
      { kind: 'tag', tag: { kind: 'act', emotion: 'sad' } },
      { kind: 'text', text: '嗯。' },
    ]);
  });
  it('I-1: a closed candidate longer than MAX_TAG is rejected, not parsed', () => {
    const prose = '你'.repeat(70);
    expect(run([`<|ACT emotion=happy>${prose}<|ACT emotion=sad|>嗯。`])).toEqual([
      { kind: 'badtag', raw: '<|ACT emotion=happy>' },
      { kind: 'text', text: prose },
      { kind: 'tag', tag: { kind: 'act', emotion: 'sad' } },
      { kind: 'text', text: '嗯。' },
    ]);
  });
  it('I-1: the rejection is chunk-invariant (same items whether the second <| arrives in one chunk or many)', () => {
    const whole = '<|ACT emotion=happy>你好。<|ACT emotion=sad|>今天。';
    const expected = merged(run([whole]));
    for (let i = 1; i < whole.length; i++) expect(merged(run([whole.slice(0, i), whole.slice(i)]))).toEqual(expected);
  });
  it('G-10: an unclosed candidate at end of stream is badtag, never text', () => {
    expect(run(['<|ACT emotion=happy'])).toEqual([{ kind: 'badtag', raw: '<|ACT emotion=happy' }]);
    expect(run(['好。<|ACT emotion=happy'])).toEqual([{ kind: 'text', text: '好。' }, { kind: 'badtag', raw: '<|ACT emotion=happy' }]);
  });
  it('G-10: an oversized unclosed candidate is discarded up to its tag-ish head and scanning resumes', () => {
    const prose = '你'.repeat(70);
    expect(run(['<|ACT emotion=happy>' + prose])).toEqual([
      { kind: 'badtag', raw: '<|ACT emotion=happy>' },
      { kind: 'text', text: prose },
    ]);
  });
  it('G-11: ACTIVATE is not ACT', () => {
    expect(run(['<|ACTIVATE emotion=happy|>'])).toEqual([{ kind: 'badtag', raw: '<|ACTIVATE emotion=happy|>' }]);
  });
  it('G-11: unknown, duplicate and missing attributes are badtag', () => {
    expect(run(['<|ACT emotion=happy foo=bar|>'])).toEqual([{ kind: 'badtag', raw: '<|ACT emotion=happy foo=bar|>' }]);
    expect(run(['<|ACT emotion=happy emotion=sad|>'])).toEqual([{ kind: 'badtag', raw: '<|ACT emotion=happy emotion=sad|>' }]);
    expect(run(['<|ACT motion=nod|>'])).toEqual([{ kind: 'badtag', raw: '<|ACT motion=nod|>' }]);
    expect(run(['<|ACT|>'])).toEqual([{ kind: 'badtag', raw: '<|ACT|>' }]);
    expect(run(['<|ACT emotion=happy junk|>'])).toEqual([{ kind: 'badtag', raw: '<|ACT emotion=happy junk|>' }]);
  });
  it('G-11: motion before emotion is still one anchored grammar', () => {
    expect(run(['<|ACT motion=nod emotion=happy|>'])).toEqual([{ kind: 'tag', tag: { kind: 'act', emotion: 'happy', motion: 'nod' } }]);
  });
  it('splits a valid tag at every character and always reassembles it', () => {
    const whole = '<|ACT emotion=happy motion=x|>你好';
    for (let i = 1; i < whole.length; i++) {
      expect(merged(run([whole.slice(0, i), whole.slice(i)]))).toEqual([
        { kind: 'tag', tag: { kind: 'act', emotion: 'happy', motion: 'x' } },
        { kind: 'text', text: '你好' },
      ]);
    }
  });
});

describe('parseTag — PAUSE bound (I-5)', () => {
  it('clamps <|PAUSE n|> to PAUSE_MAX_S', () => {
    expect(PAUSE_MAX_S).toBe(3);
    expect(parseTag('<|PAUSE 100000|>')).toEqual({ kind: 'pause', seconds: PAUSE_MAX_S });
    expect(parseTag('<|PAUSE 1.5|>')).toEqual({ kind: 'pause', seconds: 1.5 });
  });
});
