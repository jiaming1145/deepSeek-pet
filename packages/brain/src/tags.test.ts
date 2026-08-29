import { describe, expect, it } from 'vitest';
import { TagScanner } from './tags.ts';

const run = (chunks: string[]) => { const s = new TagScanner(); const out = chunks.flatMap((c) => s.push(c)); return [...out, ...s.flush()]; };

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
  it('gives up on an unterminated <| after 64 chars and emits it as text', () => {
    const long = '<|' + 'x'.repeat(70);
    expect(run([long])).toEqual([{ kind: 'text', text: long }]);
  });
  it('flush emits a pending short prefix as text', () => {
    expect(run(['嗯<|AC'])).toEqual([{ kind: 'text', text: '嗯' }, { kind: 'text', text: '<|AC' }]);
  });
});
