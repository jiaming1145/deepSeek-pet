import { SIM_DEFAULTS, clamp, type SimState } from './state.ts';
import { localHour } from './phases.ts';
import { decayToward } from './mood.ts';

/** Piecewise-linear over LOCAL hours, wrapping at 24. These anchors ARE the curve. */
export const CIRCADIAN_ANCHORS: readonly (readonly [hour: number, value: number])[] = [
  [0, 18], [3, 8], [6, 22], [8, 62], [10, 85], [13, 78], [15, 68], [18, 80], [21, 58], [23, 34], [24, 18],
];

/** `hour` is a float local hour in [0, 24). Linear between anchors; exact at every anchor. */
export function circadian(hour: number): number {
  const h = clamp(hour, 0, 24);
  for (let i = 1; i < CIRCADIAN_ANCHORS.length; i++) {
    const [h0, v0] = CIRCADIAN_ANCHORS[i - 1];
    const [h1, v1] = CIRCADIAN_ANCHORS[i];
    if (h <= h1) return v0 + (v1 - v0) * ((h - h0) / (h1 - h0));
  }
  return CIRCADIAN_ANCHORS[CIRCADIAN_ANCHORS.length - 1][1];
}

/** energy = clamp(circadian(localHour(nowWall)) - expenditure, 0, 100). Recomputable from the
 *  clock alone after any gap — which is what kills the whole class of catch-up bugs. */
export function energyOf(state: Pick<SimState, 'expenditure'>, nowWall: number): number {
  return clamp(circadian(localHour(nowWall)) - state.expenditure, 0, 100);
}

/** Present-time recovery of the expenditure (decays toward 0), clamped to [0, ENERGY_EXPENDITURE_MAX]. */
export function expenditureTick(expenditure: number, presentDeltaMs: number): number {
  return clamp(
    decayToward(expenditure, 0, presentDeltaMs, SIM_DEFAULTS.ENERGY_EXPENDITURE_HALF_LIFE_PRESENT_MS),
    0, SIM_DEFAULTS.ENERGY_EXPENDITURE_MAX,
  );
}
