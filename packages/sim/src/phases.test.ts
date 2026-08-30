import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHASE_HOURS, fnv1a32, localDateString, localHour, mealJitter, nextLocalMidnight, phaseOf,
} from './phases.ts';

// Node re-reads TZ at runtime; every wall-clock expectation below is pinned in one zone so the
// suite is identical on any machine. Local dates are the only day key in the system (R3-7).
process.env.TZ = 'Asia/Shanghai';

/** Epoch ms of a LOCAL (Asia/Shanghai) wall time. Built through Date so DST rules (none here) apply. */
const wall = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): number =>
  new Date(y, mo - 1, d, h, mi, s, ms).getTime();

describe('phaseOf (D4, §3.9)', () => {
  it('uses the default boundaries morning [6,11) day [11,18) evening [18,22) night [22,24)+[0,6)', () => {
    expect(DEFAULT_PHASE_HOURS).toEqual({ morning: 6, day: 11, evening: 18, night: 22 });
    expect(phaseOf(0)).toBe('night');
    expect(phaseOf(5.99)).toBe('night');
    expect(phaseOf(6)).toBe('morning');
    expect(phaseOf(10.99)).toBe('morning');
    expect(phaseOf(11)).toBe('day');
    expect(phaseOf(17.99)).toBe('day');
    expect(phaseOf(18)).toBe('evening');
    expect(phaseOf(21.99)).toBe('evening');
    expect(phaseOf(22)).toBe('night');
    expect(phaseOf(23.99)).toBe('night');
  });
  it('honours configured hours (kv sim_phases)', () => {
    const h = { morning: 7, day: 12, evening: 19, night: 23 };
    expect(phaseOf(6.5, h)).toBe('night');
    expect(phaseOf(7, h)).toBe('morning');
    expect(phaseOf(22.5, h)).toBe('evening');
    expect(phaseOf(23, h)).toBe('night');
  });
});

describe('localHour / localDateString / nextLocalMidnight', () => {
  it('localHour is a float in [0,24) from the local wall clock', () => {
    expect(localHour(wall(2026, 8, 30, 0, 0, 0))).toBe(0);
    expect(localHour(wall(2026, 8, 30, 12, 30, 0))).toBe(12.5);
    expect(localHour(wall(2026, 8, 30, 23, 59, 59, 999))).toBeLessThan(24);
    expect(localHour(wall(2026, 8, 30, 1, 30, 0))).toBeCloseTo(1.5, 10);
  });
  it('localDateString is YYYY-MM-DD in local time, zero-padded', () => {
    expect(localDateString(wall(2026, 8, 30, 23, 59, 59))).toBe('2026-08-30');
    expect(localDateString(wall(2026, 1, 5, 0, 0, 0))).toBe('2026-01-05');
    // 2026-08-30 23:30 Shanghai is 2026-08-30 15:30 UTC — same day; 00:30 Shanghai is the 29th in UTC.
    expect(localDateString(wall(2026, 8, 30, 0, 30, 0))).toBe('2026-08-30');
  });
  it('nextLocalMidnight is the next local 00:00 strictly after nowWall', () => {
    expect(nextLocalMidnight(wall(2026, 8, 30, 13, 0, 0))).toBe(wall(2026, 8, 31, 0, 0, 0));
    expect(nextLocalMidnight(wall(2026, 8, 30, 0, 0, 0))).toBe(wall(2026, 8, 31, 0, 0, 0));
    expect(nextLocalMidnight(wall(2026, 8, 30, 23, 59, 59, 999))).toBe(wall(2026, 8, 31, 0, 0, 0));
    expect(nextLocalMidnight(wall(2026, 12, 31, 12, 0, 0))).toBe(wall(2027, 1, 1, 0, 0, 0));
  });
});

describe('mealJitter (FNV-1a, deterministic per local date)', () => {
  it('fnv1a32 matches the published test vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });
  it('is deterministic, bounded by +/-MEAL_JITTER_MAX_MS, and varies across dates and meals', () => {
    const MAX = 1_800_000;
    const a = mealJitter('2026-08-30', 'lunch');
    expect(mealJitter('2026-08-30', 'lunch')).toBe(a);
    expect(Math.abs(a)).toBeLessThanOrEqual(MAX);
    const values = new Set<number>();
    for (let d = 1; d <= 28; d++) {
      const date = `2026-09-${String(d).padStart(2, '0')}`;
      for (const meal of ['breakfast', 'lunch', 'dinner'] as const) {
        const v = mealJitter(date, meal);
        expect(Math.abs(v)).toBeLessThanOrEqual(MAX);
        values.add(v);
      }
    }
    expect(values.size).toBeGreaterThan(70); // 84 draws; a broken hash would collapse them
  });
});
