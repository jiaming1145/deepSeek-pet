import type { ResourceCatalogue } from './bind.ts';

/** Seeded mulberry32 — a local copy; @ds/behaviors may not import @ds/sim (§1.2). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Haru's live catalogue as CompanionModel reports it (Haru.model3.json: Idle x2, TapBody x4, F01-F08). */
export const HARU_CATALOGUE: ResourceCatalogue = {
  motionGroups: { Idle: 2, TapBody: 4 },
  expressions: ['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08'],
  parameters: ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ', 'ParamTere', 'ParamEyeLOpen'],
  parts: ['Part01Face001', 'Part01Body001', 'Part01ArmLA001'],
  drawables: ['ArtMesh12'],
};

/** §3.4's table, re-derived locally (no @ds/sim import). Shape = selector.ts LivelinessMap. */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const mapAt = (L: number) => ({
  idleGapMs: lerp(20_000, 6_000, L), highEnergyWeight: lerp(0.5, 2.0, L), saccadeIntervalMs: lerp(20_000, 8_000, L),
  saccadeAmplitude: lerp(0.5, 1.0, L), touchVariantIntensity: lerp(0.5, 1.0, L),
  locomotionProbability: lerp(0, 0.25, L), proactiveEligibility: lerp(0.5, 1.0, L),
});
