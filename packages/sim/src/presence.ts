import type { ClockPhase, Presence, PresentationMode } from '@ds/protocol';
import { SIM_DEFAULTS, type SimState } from './state.ts';

/** The three inputs of the PRESENT predicate. Visibility of the pet is deliberately NOT one (R3-1). */
export interface PresenceInputs { locked: boolean; suspended: boolean; inputAgeMs: number }

/** §3.3 item 2: PRESENT := !locked && !suspended && inputAgeMs < PRESENT_INPUT_MAX_MS. Drives presentDelta. */
export function isPresent(i: PresenceInputs): boolean {
  return !i.locked && !i.suspended && i.inputAgeMs < SIM_DEFAULTS.PRESENT_INPUT_MAX_MS;
}

/**
 * §3.3 item 5's states: `active` while PRESENT; `idle-present` from PRESENT_INPUT_MAX_MS up to
 * IDLE_PRESENT_MAX_MS while unlocked and not suspended; `absent` otherwise. The transition table
 * (effects, absentSinceMono, the settling step) is the reducer's (Task 9).
 */
export function presenceOf(i: PresenceInputs): Presence {
  if (i.locked || i.suspended || i.inputAgeMs >= SIM_DEFAULTS.IDLE_PRESENT_MAX_MS) return 'absent';
  if (i.inputAgeMs >= SIM_DEFAULTS.PRESENT_INPUT_MAX_MS) return 'idle-present';
  return 'active';
}

/** D5: >= NAP_IDLE_MS -> 'nap'; D4: during 'night', >= SLEEP_PHASE_IDLE_MS -> 'sleep'. */
export function presentationModeOf(phase: ClockPhase, inputAgeMs: number): PresentationMode {
  if (phase === 'night' && inputAgeMs >= SIM_DEFAULTS.SLEEP_PHASE_IDLE_MS) return 'sleep';
  if (inputAgeMs >= SIM_DEFAULTS.NAP_IDLE_MS) return 'nap';
  return 'awake';
}

// ---- §10.4 the probableTyping predicate --------------------------------------------------------
/** One 2 Hz sensor sample. `null` = the sensor could not read it (never a typing sample). */
export interface TypingSample { inputAgeMs: number | null; cursorDeltaDip: number | null }
export type TypingState = Pick<SimState, 'probableTyping' | 'typingSamples' | 'typingIdleSamples' | 'typingStreakStartedMono'>;

/**
 * Exactly R3-9: enter after TYPING_ENTER_SAMPLES consecutive samples with input age <
 * TYPING_INPUT_AGE_MAX_MS and cursor delta < TYPING_CURSOR_DELTA_MAX_DIP; exit after
 * TYPING_EXIT_SAMPLES consecutive non-matching samples. `rose`/`fell` are this call's edges; the
 * reducer turns `rose` into the rate-limited typingGlance and `fell` into the delayed cheer check.
 * The sensor tick and the sim tick are both 500 ms (§10.3 SENSOR_TICK_MS === SIM_DEFAULTS.TICK_MS).
 */
export function typingStep(
  prev: TypingState, sample: TypingSample, nowMono: number,
): TypingState & { rose: boolean; fell: boolean } {
  const d = SIM_DEFAULTS;
  const isTypingSample = sample.inputAgeMs !== null && sample.inputAgeMs < d.TYPING_INPUT_AGE_MAX_MS
    && sample.cursorDeltaDip !== null && sample.cursorDeltaDip < d.TYPING_CURSOR_DELTA_MAX_DIP;
  let typingSamples = isTypingSample ? prev.typingSamples + 1 : 0;
  let typingIdleSamples = isTypingSample ? 0 : prev.typingIdleSamples + 1;
  let probableTyping = prev.probableTyping;
  let typingStreakStartedMono = prev.typingStreakStartedMono;
  let rose = false;
  let fell = false;
  if (!probableTyping && typingSamples >= d.TYPING_ENTER_SAMPLES) {
    probableTyping = true;
    typingStreakStartedMono = Math.max(0, nowMono - d.TYPING_ENTER_SAMPLES * d.TICK_MS);
    rose = true;
  }
  if (probableTyping && !rose && typingIdleSamples >= d.TYPING_EXIT_SAMPLES) {
    probableTyping = false;
    typingStreakStartedMono = null;
    typingSamples = 0;
    typingIdleSamples = 0;
    fell = true;
  }
  return { probableTyping, typingSamples, typingIdleSamples, typingStreakStartedMono, rose, fell };
}
