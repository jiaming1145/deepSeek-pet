import { describe, expect, it } from 'vitest';
import { RevealPlan } from './reveal';

describe('RevealPlan', () => {
  const T = '一二三四五六七八九十一二三四五六七八九十，。'; // 20 hanzi + 1 comma + 1 period

  it('costs 20*70 + (70+150) + (70+300) ms', () => {
    expect(new RevealPlan(T).totalMs()).toBe(1990);
  });

  it('closes the mouth on punctuation', () => {
    const s = new RevealPlan(T).steps();
    expect(s[20].mouth).toBe(false); // ，
    expect(s[21].mouth).toBe(false); // 。
    expect(s[0].mouth).toBe(true);
  });

  it('reveals Latin faster', () => {
    expect(new RevealPlan('abc').totalMs()).toBe(105);
  });

  it('keeps a ZWJ emoji as one step', () => {
    const s = new RevealPlan('好👨‍👩‍👧').steps();
    expect(s).toHaveLength(2);
    expect(s[1].grapheme).toBe('👨‍👩‍👧');
    expect(s[1].delayMs).toBe(70);
  });
});
