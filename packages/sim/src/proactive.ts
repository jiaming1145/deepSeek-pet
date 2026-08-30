// packages/sim/src/proactive.ts — pure; ProactiveController (main) owns the side effects.
import type { ProactiveBucket, ProactiveVerdict } from '@ds/protocol';
import { SIM_DEFAULTS, type SimState } from './state.ts';
import { localHour, nextLocalMidnight } from './phases.ts';
import { livelinessMap } from './liveliness.ts';
import { nextRandom } from './rng.ts';   // Task 3's export, verified (see Interfaces)
// One home for the meal tuple and the 20-min cue window (§5.13). The reducer declares them; a
// benign ES cycle (reduce.ts imports `backoffDelay` from here) — neither side reads the other's
// bindings during module evaluation, only inside function bodies.
import { MEALS, MEAL_CUE_WINDOW_MS } from './reduce.ts';

const D = SIM_DEFAULTS;

export interface GateInput {
  state: SimState;
  nowMono: number;
  nowWall: number;
  /** From the character card: sim.proactive.maxPerDay, clamped to [0, PROACTIVE_PERSONA_CAP_MAX]. */
  personaCap: number;
  /** True while any TurnRunner turn is not idle, or the chat window is open. */
  turnActive: boolean;
  chatOpen: boolean;
  /** A random draw in [0,1) supplied by the caller so the gate stays pure. */
  roll: number;
}

/**
 * §3.10.5: the gate's verdicts are a STRICT SUBSET of `ProactiveVerdict` (which also carries the
 * arms only the controller can reach). This tuple is the single source of `GateVerdict`'s arms, and
 * `satisfies readonly ProactiveVerdict[]` makes a seventh arm a compile error unless the protocol
 * list carries it. `proactive.test.ts` asserts the containment at runtime as well.
 */
export const GATE_VERDICTS = [
  'eligible', 'rateLimited', 'unansweredCap', 'personaCap', 'suppressed', 'muted',
] as const satisfies readonly ProactiveVerdict[];
export type GateVerdictName = (typeof GATE_VERDICTS)[number];

export type GateVerdict =
  | { verdict: 'eligible' }
  | { verdict: Exclude<GateVerdictName, 'eligible'>;
      reason: GateReason; nextEligibleAt: number | null };

export const GATE_REASONS = [
  'rate-20min', 'backoff', 'unanswered-3', 'persona-cap', 'muted',
  'typing', 'fullscreen', 'locked', 'suspended', 'dnd', 'user-hidden',
  'recent-input', 'turn-active', 'chat-open', 'asleep', 'plain-mode',
  'sensor-unknown', 'liveliness-roll',
] as const;
export type GateReason = (typeof GATE_REASONS)[number];

/**
 * CONTRACT GAP (C-2): §3.10.2 says "SimService sets it from ActivitySensor.healthy", but neither
 * SimState (§3.1) nor GateInput (§3.10.1) has a slot for it. Until an Amendment adds one, the
 * sensor is never reported unknown from here; the reason code stays reserved in GATE_REASONS.
 */
export function sensorsUnknown(_state: SimState): boolean { return false; }

const suppressed = (reason: GateReason): GateVerdict => ({ verdict: 'suppressed', reason, nextEligibleAt: null });

export function shouldSpeak({ state, nowMono, nowWall, personaCap, turnActive, chatOpen, roll }: GateInput): GateVerdict {
  const g = state.gate;
  const cap = Math.min(D.PROACTIVE_PERSONA_CAP_MAX, Math.max(0, personaCap));
  // ---- layer 0: user control ----
  if (g.mutedUntilWall !== null && nowWall < g.mutedUntilWall)
    return { verdict: 'muted', reason: 'muted', nextEligibleAt: g.mutedUntilWall };
  // ---- layer 1: global rate, <= 1 displayed per rolling 20 min ----
  if (g.lastDisplayedMono !== null) {
    const earliest = g.lastDisplayedMono + D.PROACTIVE_RATE_WINDOW_MS;
    if (nowMono < earliest)
      return { verdict: 'rateLimited', reason: 'rate-20min', nextEligibleAt: nowWall + (earliest - nowMono) };
  }
  // ---- layer 2: unanswered cap + full-jitter exponential back-off ----
  if (g.unansweredToday >= D.PROACTIVE_UNANSWERED_CAP)
    return { verdict: 'unansweredCap', reason: 'unanswered-3', nextEligibleAt: nextLocalMidnight(nowWall) };
  if (g.backoffUntilMono !== null && nowMono < g.backoffUntilMono)
    return { verdict: 'rateLimited', reason: 'backoff', nextEligibleAt: nowWall + (g.backoffUntilMono - nowMono) };
  // ---- layer 3: persona cap on DISPLAYED lines ----
  if (g.displayedToday >= cap)
    return { verdict: 'personaCap', reason: 'persona-cap', nextEligibleAt: nextLocalMidnight(nowWall) };
  // ---- layer 4: suppression. Every one is re-checked again before display (R3-7). ----
  if (state.mode === 'plain') return suppressed('plain-mode');
  if (state.probableTyping) return suppressed('typing');
  if (state.fullscreen) return suppressed('fullscreen');
  if (state.locked) return suppressed('locked');
  if (state.suspended) return suppressed('suspended');
  if (state.dnd) return suppressed('dnd');
  if (state.userHidden) return suppressed('user-hidden');
  if (state.inputAgeMs < D.PROACTIVE_SINCE_INPUT_MIN_MS) return suppressed('recent-input');
  if (turnActive) return suppressed('turn-active');
  if (chatOpen) return suppressed('chat-open');
  if (state.phase === 'night' && state.presentationMode !== 'awake') return suppressed('asleep');
  if (sensorsUnknown(state)) return suppressed('sensor-unknown');
  // ---- the liveliness roll. NEVER widens a hard cap; only makes a quiet pet quieter. ----
  if (roll >= livelinessMap(state.liveliness).proactiveEligibility) return suppressed('liveliness-roll');
  return { verdict: 'eligible' };
}

/** §3.10.3: delay = random(0, min(CAP, BASE * 2^(n-1))) from the reducer's seeded rng. */
export function backoffDelay(backoffN: number, rngState: number): { delayMs: number; rngState: number } {
  const n = Math.max(1, Math.min(8, Math.floor(backoffN)));
  const upper = Math.min(D.PROACTIVE_BACKOFF_CAP_MS, D.PROACTIVE_BACKOFF_BASE_MS * 2 ** (n - 1));
  const r = nextRandom(rngState);
  return { delayMs: Math.floor(r.value * upper), rngState: r.rngState };
}

/**
 * CONTRACT GAP (C-3): §3.10.5's `longGap` needs "the last returned effect's awayMs and whether a
 * line was spoken since", and `callback` needs HistoryStore.countSince + a >=0.6 fact — none of
 * which SimState carries and bucketFor(state) cannot read. The optional second argument lets
 * ProactiveController (Task 14) supply them; without it those two buckets are never offered.
 */
export interface BucketExternals {
  returnedAwayMs: number | null;
  spokenSinceReturn: boolean;
  hasCallbackMaterial: boolean;
}

export function bucketFor(state: SimState, ext?: BucketExternals): ProactiveBucket | null {
  if (state.phase === 'morning' && !state.firedToday.morningGreeting) return 'greeting';
  if (state.phase === 'night' && state.presentationMode === 'awake') return 'night';
  const dayMs = localHour(state.lastWall) * 3_600_000;
  for (const m of MEALS) {
    if (!state.firedToday[m]) continue;
    const at = D.MEAL_HOURS[m] * 3_600_000 + state.mealJitterMs[m];
    if (dayMs >= at && dayMs < at + MEAL_CUE_WINDOW_MS) return 'meal';
  }
  if (ext && ext.returnedAwayMs !== null && ext.returnedAwayMs >= 21_600_000 && !ext.spokenSinceReturn) return 'longGap';
  if (ext && ext.hasCallbackMaterial) return 'callback';
  return 'world';
}
