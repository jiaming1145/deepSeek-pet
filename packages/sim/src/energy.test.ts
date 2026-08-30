import { describe, expect, it } from 'vitest';
import { CIRCADIAN_ANCHORS, circadian, energyOf, expenditureTick } from './energy.ts';
import { SIM_DEFAULTS, initialSimState } from './state.ts';
import { localHour } from './phases.ts';

process.env.TZ = 'Asia/Shanghai';
const wall = (y: number, mo: number, d: number, h = 0, mi = 0): number => new Date(y, mo - 1, d, h, mi).getTime();

describe('circadian (§3.8 — the anchors ARE the curve)', () => {
  it('pins the anchor table', () => {
    expect(CIRCADIAN_ANCHORS).toEqual([
      [0, 18], [3, 8], [6, 22], [8, 62], [10, 85], [13, 78], [15, 68], [18, 80], [21, 58], [23, 34], [24, 18],
    ]);
  });
  it('is exact at every anchor', () => {
    for (const [h, v] of CIRCADIAN_ANCHORS) expect(circadian(h)).toBe(v);
  });
  it('wraps: circadian(24) === circadian(0) === 18, and 23.5 is the 23->24 midpoint', () => {
    expect(circadian(24)).toBe(18);
    expect(circadian(0)).toBe(18);
    expect(circadian(23.5)).toBe(26);
  });
  it('interpolates linearly between anchors: circadian(1.5) === 13', () => {
    expect(circadian(1.5)).toBe(13);
    expect(circadian(9)).toBe(73.5);
  });
  it('clamps an out-of-range hour into [0, 24]', () => {
    expect(circadian(-1)).toBe(18);
    expect(circadian(30)).toBe(18);
  });
});

describe('energyOf (§3.8 — a pure function of (nowWall, expenditure))', () => {
  it('equals clamp(circadian(localHour) - expenditure, 0, 100)', () => {
    const t = wall(2026, 8, 30, 10, 0);
    const s = { ...initialSimState(0, t), expenditure: 5 };
    expect(energyOf(s, t)).toBe(80);
    expect(circadian(localHour(t))).toBe(85);
    expect(energyOf({ ...s, expenditure: 0 }, wall(2026, 8, 30, 3, 0))).toBe(8);
    expect(energyOf({ ...s, expenditure: 40 }, wall(2026, 8, 30, 3, 0))).toBe(0);
  });
  it('two states that differ only in how long the app was closed produce the same energy', () => {
    const t = wall(2026, 8, 30, 15, 0);
    const a = { ...initialSimState(0, t), expenditure: 7, lastMono: 0, lastWall: t - 3 * 86_400_000, absentSinceMono: 0 };
    const b = { ...initialSimState(99_999_999, t), expenditure: 7, lastMono: 99_999_999, lastWall: t - 1_000, absentSinceMono: null };
    expect(energyOf(a, t)).toBe(energyOf(b, t));
    expect(energyOf(a, t)).toBe(61);
  });
});

describe('expenditureTick', () => {
  const HL = SIM_DEFAULTS.ENERGY_EXPENDITURE_HALF_LIFE_PRESENT_MS;
  it('decays toward 0 with the 25-min PRESENT half-life and clamps to [0, 40]', () => {
    expect(expenditureTick(10, HL)).toBeCloseTo(5, 12);
    expect(expenditureTick(10, 0)).toBe(10);
    expect(expenditureTick(55, 0)).toBe(40);
    expect(expenditureTick(-3, 0)).toBe(0);
  });
});
