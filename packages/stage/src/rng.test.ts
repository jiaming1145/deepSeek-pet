import { describe, expect, it } from 'vitest';
import { pickIndex } from './rng';

describe('pickIndex', () => {
  it('always picks index 0 with a zero rng (spec §9 fixed seed)', () => {
    const rng = () => 0;
    for (const count of [1, 2, 8]) {
      expect(pickIndex(count, rng)).toBe(0);
    }
  });

  it('spreads uniformly across the range', () => {
    expect(pickIndex(4, () => 0.0)).toBe(0);
    expect(pickIndex(4, () => 0.24)).toBe(0);
    expect(pickIndex(4, () => 0.25)).toBe(1);
    expect(pickIndex(4, () => 0.99)).toBe(3);
  });

  it('never returns an out-of-range index', () => {
    expect(pickIndex(3, () => 1)).toBe(2); // Math.random never returns 1; an injected rng might
    expect(pickIndex(3, () => 1.5)).toBe(2);
    expect(pickIndex(3, () => -1)).toBe(0);
    expect(pickIndex(3, () => Number.NaN)).toBe(0);
    expect(pickIndex(0, () => 0.5)).toBe(0);
  });
});
