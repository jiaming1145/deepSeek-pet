import { describe, expect, it } from 'vitest';
import type { StreamChunk } from '@ds/brain';
import { FAKE_BRAIN_ENV, createFakeClient, useFakeBrain } from './fake-client';

describe('useFakeBrain', () => {
  it('is on only when the flag is exactly "1" in an unpackaged run', () => {
    expect(FAKE_BRAIN_ENV).toBe('DS_FAKE_BRAIN');
    expect(useFakeBrain(false, { [FAKE_BRAIN_ENV]: '1' })).toBe(true);
    expect(useFakeBrain(false, { [FAKE_BRAIN_ENV]: 'true' })).toBe(false);
  });

  it('is never reachable in a packaged build (D5 guard shape)', () => {
    expect(useFakeBrain(true, { [FAKE_BRAIN_ENV]: '1' })).toBe(false);
  });

  it('is off when the flag is absent', () => {
    expect(useFakeBrain(false, {})).toBe(false);
  });
});

describe('createFakeClient', () => {
  it('streams an ACT-tagged reply in small chunks, then usage, then done', async () => {
    const client = createFakeClient();
    const chunks: StreamChunk[] = [];
    for await (const c of client.stream(
      { messages: [{ role: 'user', content: '【状态】本地时间 周三 21:14\n\n你好' }] },
      new AbortController().signal,
    )) {
      chunks.push(c);
    }
    const text = chunks.filter((c) => c.kind === 'delta').map((c) => (c.kind === 'delta' ? c.text : '')).join('');
    expect(text.startsWith('<|ACT emotion=')).toBe(true);
    expect(text).toContain('你好');
    expect(chunks.filter((c) => c.kind === 'delta').every((c) => c.kind === 'delta' && c.text.length <= 6)).toBe(true);
    expect(chunks.at(-2)?.kind).toBe('usage');
    expect(chunks.at(-1)?.kind).toBe('done');
  });
});
