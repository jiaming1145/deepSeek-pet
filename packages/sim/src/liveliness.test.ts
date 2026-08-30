import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { LIVELINESS_PRESETS } from '@ds/protocol';
import { livelinessMap, type LivelinessMap } from './liveliness.ts';

const KEYS: (keyof LivelinessMap)[] = [
  'idleGapMs', 'highEnergyWeight', 'saccadeIntervalMs', 'saccadeAmplitude',
  'touchVariantIntensity', 'locomotionProbability', 'proactiveEligibility',
];

describe('livelinessMap (R3-13, §3.4 — the ONE monotonic table)', () => {
  it('pins the preset table', () => {
    const rows: [number, LivelinessMap][] = [
      [0.00, { idleGapMs: 20_000, highEnergyWeight: 0.50, saccadeIntervalMs: 20_000, saccadeAmplitude: 0.50, touchVariantIntensity: 0.50, locomotionProbability: 0.000, proactiveEligibility: 0.500 }],
      [0.15, { idleGapMs: 17_900, highEnergyWeight: 0.725, saccadeIntervalMs: 18_200, saccadeAmplitude: 0.575, touchVariantIntensity: 0.575, locomotionProbability: 0.0375, proactiveEligibility: 0.575 }],
      [0.30, { idleGapMs: 15_800, highEnergyWeight: 0.95, saccadeIntervalMs: 16_400, saccadeAmplitude: 0.65, touchVariantIntensity: 0.65, locomotionProbability: 0.075, proactiveEligibility: 0.65 }],
      [0.70, { idleGapMs: 10_200, highEnergyWeight: 1.55, saccadeIntervalMs: 11_600, saccadeAmplitude: 0.85, touchVariantIntensity: 0.85, locomotionProbability: 0.175, proactiveEligibility: 0.85 }],
      [1.00, { idleGapMs: 6_000, highEnergyWeight: 2.00, saccadeIntervalMs: 8_000, saccadeAmplitude: 1.00, touchVariantIntensity: 1.00, locomotionProbability: 0.250, proactiveEligibility: 1.000 }],
    ];
    for (const [L, want] of rows) {
      const got = livelinessMap(L);
      for (const k of KEYS) expect(got[k], `${k} at L=${L}`).toBeCloseTo(want[k], 9);
    }
    expect(Object.keys(livelinessMap(0.5)).sort()).toEqual([...KEYS].sort());
    expect(LIVELINESS_PRESETS).toEqual({ quiet: 0.15, default: 0.30, lively: 0.70 });
  });

  it('idleGapMs and saccadeIntervalMs are non-increasing over L in {0, 0.01, …, 1}', () => {
    let prev = livelinessMap(0);
    for (let i = 1; i <= 100; i++) {
      const cur = livelinessMap(i / 100);
      expect(cur.idleGapMs).toBeLessThanOrEqual(prev.idleGapMs);
      expect(cur.saccadeIntervalMs).toBeLessThanOrEqual(prev.saccadeIntervalMs);
      prev = cur;
    }
  });

  it('every other field is non-decreasing over L in {0, 0.01, …, 1}', () => {
    let prev = livelinessMap(0);
    for (let i = 1; i <= 100; i++) {
      const cur = livelinessMap(i / 100);
      for (const k of ['highEnergyWeight', 'saccadeAmplitude', 'touchVariantIntensity', 'locomotionProbability', 'proactiveEligibility'] as const) {
        expect(cur[k], k).toBeGreaterThanOrEqual(prev[k]);
      }
      prev = cur;
    }
  });

  it('clamps L into [0,1] (§3.5)', () => {
    expect(livelinessMap(-3)).toEqual(livelinessMap(0));
    expect(livelinessMap(7)).toEqual(livelinessMap(1));
  });

  it('is imported by nothing in affection/mood/energy/presence/phases/state/rng (R3-13: never alters affection, honesty, memory, safety, absence rules)', () => {
    const dir = new URL('./', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'liveliness.ts' && f !== 'index.ts');
    for (const f of files) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      if (f === 'proactive.ts') {
        // §3.10.2: the roll is the ONLY permitted use, and it may only make the pet quieter.
        expect(src.match(/livelinessMap\(/g)?.length ?? 0, 'proactive.ts uses the map at most once').toBeLessThanOrEqual(1);
        continue;
      }
      expect(src, `${f} must not import liveliness.ts`).not.toMatch(/liveliness\.ts/);
    }
  });
});
