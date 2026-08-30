import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AFFECTION_BUCKET_FLOORS, AFFECTION_DAY_THRESHOLDS, affectionShown, grantAffection } from './affection.ts';
import { SIM_DEFAULTS, initialSimState } from './state.ts';
import { nextRandom } from './rng.ts';

const base = () => initialSimState(0, 1_700_000_000_000);

describe('grantAffection (§3.6.1 — the ONLY write path)', () => {
  it('grants up to the daily cap and never past 100', () => {
    const s = base();
    expect(grantAffection(s, 1.0)).toEqual({ affection: 1.0, earnedToday: 1.0 });
    expect(grantAffection({ ...s, earnedToday: 11.5 }, 1.0)).toEqual({ affection: 0.5, earnedToday: 12 });
    expect(grantAffection({ ...s, earnedToday: 12 }, 1.0)).toEqual({ affection: 0, earnedToday: 12 });
    expect(grantAffection({ ...s, affection: 99.8 }, 1.0)).toEqual({ affection: 100, earnedToday: 1.0 });
    expect(SIM_DEFAULTS.AFFECTION_DAILY_CAP).toBe(12);
  });
  it('ignores a non-positive or NaN amount (returns the same numbers)', () => {
    const s = { ...base(), affection: 5, earnedToday: 2 };
    for (const a of [0, -1, -0.5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(grantAffection(s, a)).toEqual({ affection: 5, earnedToday: 2 });
    }
  });
  it('has no branch that can decrement affection', () => {
    const src = readFileSync(new URL('./affection.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/affection\s*[-]=|affection\s*-\s*[A-Za-z0-9_.]/);
  });
  it('never decreases affection across a 10 000-draw fuzz of amounts in [-20, 20] and NaN', () => {
    let s = base();
    let rng = 1;
    for (let i = 0; i < 10_000; i++) {
      const r = nextRandom(rng); rng = r.rngState;
      const amount = i % 97 === 0 ? Number.NaN : r.value * 40 - 20;
      if (i % 500 === 0) s = { ...s, earnedToday: 0 }; // a local-date rollover, reset by the reducer (Task 9)
      const g = grantAffection(s, amount);
      expect(g.affection).toBeGreaterThanOrEqual(s.affection);
      expect(g.earnedToday).toBeGreaterThanOrEqual(s.earnedToday);
      expect(g.earnedToday).toBeLessThanOrEqual(SIM_DEFAULTS.AFFECTION_DAILY_CAP);
      expect(g.affection).toBeLessThanOrEqual(100);
      s = { ...s, ...g };
    }
  });
});

describe('affectionShown (§3.6.3 — dual-path milestones)', () => {
  it('pins the two tables', () => {
    expect(AFFECTION_DAY_THRESHOLDS).toEqual([0, 2, 7, 20, 45, 90]);
    expect(AFFECTION_BUCKET_FLOORS).toEqual([0, 10, 30, 55, 75, 90]);
  });
  it('is never lower than the raw ledger and rises with distinct days', () => {
    const s = base();
    expect(affectionShown({ ...s, affection: 3, distinctDaysSeen: 0 })).toBe(3);
    expect(affectionShown({ ...s, affection: 3, distinctDaysSeen: 1 })).toBe(3);
    expect(affectionShown({ ...s, affection: 3, distinctDaysSeen: 2 })).toBe(10);
    expect(affectionShown({ ...s, affection: 3, distinctDaysSeen: 7 })).toBe(30);
    expect(affectionShown({ ...s, affection: 3, distinctDaysSeen: 20 })).toBe(55);
    expect(affectionShown({ ...s, affection: 3, distinctDaysSeen: 45 })).toBe(75);
    expect(affectionShown({ ...s, affection: 3, distinctDaysSeen: 90 })).toBe(90);
    expect(affectionShown({ ...s, affection: 3, distinctDaysSeen: 400 })).toBe(90);
    expect(affectionShown({ ...s, affection: 64, distinctDaysSeen: 20 })).toBe(64);
    expect(affectionShown({ ...s, affection: 100, distinctDaysSeen: 0 })).toBe(100);
  });
});
