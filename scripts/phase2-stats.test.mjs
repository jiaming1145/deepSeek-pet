import { describe, expect, it } from 'vitest';
import { cacheHitRatio, percentile, renderSessionMarkdown, verdict } from './phase2-stats.mjs';

const sample = {
  startedAt: '2026-08-29T14:03:11.000Z',
  model: 'deepseek-v4-flash',
  dry: false,
  summary: {
    firstSentenceP50: 1100,
    firstSentenceP90: 1500,
    ttftP50: 620,
    firstEmitP50: 1800,
    cacheHitFrom3: 0.78,
  },
  turns: [
    { turn: 1, promptId: 'bland-01', firstSentenceMs: 1100, ttftMs: 620, totalMs: 1810, promptTokens: 812, cacheHit: 768, sentences: 2 },
  ],
};

describe('percentile', () => {
  it('takes the nearest rank at p50', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
  });
  it('returns the only sample', () => {
    expect(percentile([10], 50)).toBe(10);
  });
  it('sorts its input first', () => {
    expect(percentile([5, 1, 3], 50)).toBe(3);
  });
  it('takes the nearest rank at p90', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });
  it('refuses an empty sample', () => {
    expect(() => percentile([], 50)).toThrow('percentile: empty sample');
  });
});

describe('cacheHitRatio', () => {
  it('sums hit and prompt tokens from the given turn on', () => {
    const turns = [
      { turn: 1, promptTokens: 100, cacheHit: 0 },
      { turn: 2, promptTokens: 100, cacheHit: 0 },
      { turn: 3, promptTokens: 100, cacheHit: 80 },
      { turn: 4, promptTokens: 100, cacheHit: 60 },
    ];
    expect(cacheHitRatio(turns, 3)).toBe(0.7);
  });
  it('defaults to turn 3', () => {
    const turns = [
      { turn: 1, promptTokens: 100, cacheHit: 100 },
      { turn: 3, promptTokens: 100, cacheHit: 50 },
    ];
    expect(cacheHitRatio(turns)).toBe(0.5);
  });
  it('is 0 when no turn qualifies', () => {
    expect(cacheHitRatio([{ turn: 1, promptTokens: 100, cacheHit: 0 }], 9)).toBe(0);
  });
});

describe('verdict', () => {
  it('compares in both directions, inclusively', () => {
    expect(verdict(1100, 1200, 'max')).toBe(true);
    expect(verdict(1200, 1200, 'max')).toBe(true);
    expect(verdict(1300, 1200, 'max')).toBe(false);
    expect(verdict(0.7, 0.7, 'min')).toBe(true);
    expect(verdict(0.69, 0.7, 'min')).toBe(false);
  });
});

describe('renderSessionMarkdown', () => {
  it('renders the passing bars and the per-turn row', () => {
    const md = renderSessionMarkdown(sample);
    expect(md.startsWith('# Phase 2 session — 1 turns')).toBe(true);
    expect(md).toContain('| first-sentence close p50 | 1100 ms | <= 1200 ms | PASS |');
    expect(md).toContain('| prompt-cache hit, turns 3+ | 78.0 % | >= 70.0 % | PASS |');
    expect(md).toContain('| first emit after send p50 | 1800 ms | (recorded) | - |');
    expect(md).toContain('| 1 | bland-01 | 1100 | 620 | 1810 | 812 | 768 | 2 |');
  });
  it('renders FAIL when a bar is missed', () => {
    const md = renderSessionMarkdown({
      ...sample,
      summary: { ...sample.summary, firstSentenceP50: 1300, cacheHitFrom3: 0.5 },
    });
    expect(md).toContain('| first-sentence close p50 | 1300 ms | <= 1200 ms | FAIL |');
    expect(md).toContain('| prompt-cache hit, turns 3+ | 50.0 % | >= 70.0 % | FAIL |');
  });
});
