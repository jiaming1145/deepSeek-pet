import { SIM_DEFAULTS, type SimState } from './state.ts';

/** The ONLY function that writes `affection`. `amount` MUST be > 0; a non-positive amount throws
 *  in dev and is ignored in production, so "absence is never penalised" is a type-level property. */
export function grantAffection(
  state: SimState, amount: number,
): Pick<SimState, 'affection' | 'earnedToday'> {
  if (!(amount > 0)) return { affection: state.affection, earnedToday: state.earnedToday };
  const room = Math.max(0, SIM_DEFAULTS.AFFECTION_DAILY_CAP - state.earnedToday);
  const granted = Math.min(amount, room);
  return {
    affection: Math.min(100, state.affection + granted),
    earnedToday: state.earnedToday + granted,
  };
}

export const AFFECTION_DAY_THRESHOLDS = [0, 2, 7, 20, 45, 90] as const;   // distinct days
export const AFFECTION_BUCKET_FLOORS  = [0, 10, 30, 55, 75, 90] as const; // matching value floors

/** The value the PROMPT sees. Never lower than the raw ledger, so nothing can read as a loss. */
export function affectionShown(state: SimState): number {
  let i = 0;
  while (i + 1 < AFFECTION_DAY_THRESHOLDS.length
         && state.distinctDaysSeen >= AFFECTION_DAY_THRESHOLDS[i + 1]) i++;
  return Math.max(state.affection, AFFECTION_BUCKET_FLOORS[i]);
}
