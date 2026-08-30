// packages/sim/src/liveliness.ts — the single mapping. No other module may scale by L.
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface LivelinessMap {
  /** Target interval between consecutive behaviour STARTS, ms. Jittered +/-25 % by the selector. */
  idleGapMs: number;
  /** Multiplier on the weight of behaviours tagged `big` in behaviors.json. */
  highEnergyWeight: number;
  /** Mean interval between gaze breaks, ms (D3 clamps the DRAW to [8000, 20000]). */
  saccadeIntervalMs: number;
  /** Multiplier on saccade amplitude (D3's 15-35 deg base range). */
  saccadeAmplitude: number;
  /** Multiplier on the touch reaction VARIANT intensity. A touch is ALWAYS answered (R3-13). */
  touchVariantIntensity: number;
  /** Probability that an idle decision may pick a behaviour with `locomotion !== null`. */
  locomotionProbability: number;
  /** Multiplier on the proactive eligibility roll. Hard caps stay hard (R3-13). */
  proactiveEligibility: number;
}

export function livelinessMap(L: number): LivelinessMap {
  const t = Math.min(1, Math.max(0, L));
  return {
    idleGapMs:             lerp(20_000, 6_000, t),
    highEnergyWeight:      lerp(0.5, 2.0, t),
    saccadeIntervalMs:     lerp(20_000, 8_000, t),
    saccadeAmplitude:      lerp(0.5, 1.0, t),
    touchVariantIntensity: lerp(0.5, 1.0, t),
    locomotionProbability: lerp(0, 0.25, t),
    proactiveEligibility:  lerp(0.5, 1.0, t),
  };
}
