import type { Emotion } from '@ds/protocol';
import { SIM_DEFAULTS, clamp, type SimState } from './state.ts';

// ---- §3.7.1 integration ------------------------------------------------------------------------
export function decayToward(x: number, base: number, presentDeltaMs: number, halfLifeMs: number): number {
  if (presentDeltaMs <= 0) return x;
  return base + (x - base) * Math.exp(-Math.LN2 * presentDeltaMs / halfLifeMs);
}

/** One tick of present-time integration for both axes. `presentDeltaMs` is 0 while absent (frozen). */
export function moodTick(
  state: Pick<SimState, 'valence' | 'arousal' | 'valenceBase' | 'arousalBase' | 'neglect'>,
  presentDeltaMs: number,
): Pick<SimState, 'valence' | 'arousal'> {
  const hl = SIM_DEFAULTS.MOOD_HALF_LIFE_PRESENT_MS;
  return {
    valence: clamp(decayToward(state.valence, state.valenceBase + state.neglect, presentDeltaMs, hl), -1, 1),
    arousal: clamp(decayToward(state.arousal, state.arousalBase, presentDeltaMs, hl), 0, 1),
  };
}

// ---- §3.7.2 event nudges -----------------------------------------------------------------------
/** The reducer (Task 9) maps SimEvent -> MoodNudgeEvent; this module owns only the numbers. */
export type MoodNudgeEvent =
  | { kind: 'emotion'; emotion: Emotion }
  | { kind: 'touch'; annoyed: boolean }
  | { kind: 'turnInterrupted' }
  /** `PROACTIVE_OUTCOME {outcome:'displayed'}` then no answer for PROACTIVE_UNANSWERED_AFTER_MS. */
  | { kind: 'proactiveUnanswered' };

export interface MoodNudge { dValence: number; dArousal: number }

export const MOOD_NUDGES = {
  emotion: {
    happy:     { dValence: 0.05,  dArousal: 0.04 },
    surprised: { dValence: 0.02,  dArousal: 0.10 },
    curious:   { dValence: 0.02,  dArousal: 0.04 },
    think:     { dValence: 0,     dArousal: -0.02 },
    question:  { dValence: 0,     dArousal: 0.01 },
    neutral:   { dValence: 0,     dArousal: 0 },
    awkward:   { dValence: -0.01, dArousal: 0.03 },
    sad:       { dValence: -0.05, dArousal: -0.04 },
    angry:     { dValence: -0.04, dArousal: 0.08 },
  } satisfies Record<Emotion, MoodNudge>,
  touch:          { dValence: 0.02,  dArousal: 0.03 },
  touchAnnoyed:   { dValence: -0.05, dArousal: 0.10 },
  turnInterrupted:     { dValence: -0.02, dArousal: 0 },
  proactiveUnanswered: { dValence: 0,     dArousal: -0.03 },
} as const;

export function moodNudge(e: MoodNudgeEvent): MoodNudge {
  switch (e.kind) {
    case 'emotion': return MOOD_NUDGES.emotion[e.emotion];
    case 'touch': return e.annoyed ? MOOD_NUDGES.touchAnnoyed : MOOD_NUDGES.touch;
    case 'turnInterrupted': return MOOD_NUDGES.turnInterrupted;
    case 'proactiveUnanswered': return MOOD_NUDGES.proactiveUnanswered;
  }
}

/** Applies one nudge, clamped: valence to [-1, 1], arousal to [0, 1]. */
export function applyNudge(valence: number, arousal: number, e: MoodNudgeEvent): Pick<SimState, 'valence' | 'arousal'> {
  const n = moodNudge(e);
  return { valence: clamp(valence + n.dValence, -1, 1), arousal: clamp(arousal + n.dArousal, 0, 1) };
}

// ---- §3.7.3 absence and return -----------------------------------------------------------------
/** The ONE settling step on return after > RETURN_SETTLE_AFTER_MS. Only the adverse component moves. */
export function settleOnReturn(
  state: Pick<SimState, 'valence' | 'arousal' | 'valenceBase' | 'arousalBase' | 'neglect'>,
): Pick<SimState, 'valence' | 'arousal'> {
  // ONLY the adverse component moves. Positive valence is never reduced by absence (R3-8).
  const base = state.valenceBase + state.neglect;
  const valence = state.valence < base
    ? state.valence + (base - state.valence) * SIM_DEFAULTS.RETURN_SETTLE_FRACTION
    : state.valence;                                   // positive valence survives absence intact
  const arousal = state.arousal + (state.arousalBase - state.arousal) * SIM_DEFAULTS.RETURN_SETTLE_FRACTION;
  return { valence: clamp(valence, -1, 1), arousal: clamp(arousal, 0, 1) };
}

// ---- §3.7.4 neglect ----------------------------------------------------------------------------
/**
 * One PRESENT tick of the neglect accumulator. The reducer resets both fields to 0 on
 * TOUCH | TURN_USER | TURN_DONE | PROACTIVE_ANSWERED (fully recoverable, immediately).
 * The window loop is bounded arithmetically (no while over a corrupted value).
 */
export function neglectTick(
  sinceInteractionMs: number, neglect: number, presentDeltaMs: number,
): Pick<SimState, 'sinceInteractionMs' | 'neglect'> {
  const W = SIM_DEFAULTS.NEGLECT_WINDOW_MS;
  const total = sinceInteractionMs + Math.max(0, presentDeltaMs);
  const windows = Math.floor(total / W);
  return {
    sinceInteractionMs: total - windows * W,
    neglect: Math.max(SIM_DEFAULTS.NEGLECT_FLOOR, neglect + windows * SIM_DEFAULTS.NEGLECT_STEP),
  };
}
