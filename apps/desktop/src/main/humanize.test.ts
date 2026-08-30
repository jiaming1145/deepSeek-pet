import { describe, expect, it } from 'vitest';
import { humanizeGap } from './humanize';

describe('humanizeGap', () => {
  it('says 刚刚 under five minutes', () => {
    expect(humanizeGap(0)).toBe('刚刚');
    expect(humanizeGap(4 * 60_000 + 59_999)).toBe('刚刚');
  });

  it('counts whole minutes up to an hour', () => {
    expect(humanizeGap(5 * 60_000)).toBe('5分钟');
    expect(humanizeGap(59 * 60_000)).toBe('59分钟');
  });

  it('counts whole hours up to a day', () => {
    expect(humanizeGap(60 * 60_000)).toBe('1小时');
    expect(humanizeGap(23 * 3_600_000)).toBe('23小时');
  });

  it('counts whole days beyond that', () => {
    expect(humanizeGap(24 * 3_600_000)).toBe('1天');
    expect(humanizeGap(72 * 3_600_000)).toBe('3天');
  });

  it('treats a negative gap as 刚刚 instead of producing a negative phrase', () => {
    expect(humanizeGap(-1000)).toBe('刚刚');
  });
});
