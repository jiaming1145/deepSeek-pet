// packages/sim/src/events.ts — contracts §3.2. Pure types; no runtime beyond SIM_EVENT_TYPES.
import type { Emotion, HitPart, PersonaModeIpc, SimEventPayload } from '@ds/protocol';
import type { SimState } from './state.ts';

export type SimEvent =
  /** The 2 Hz integrator. `inputAgeMs`, `cursorDeltaDip` and the flags come from the sensors. */
  | { type: 'TICK'; inputAgeMs: number; cursorDeltaDip: number; cursorNear: boolean;
      onFloor: boolean; nearEdge: boolean }
  /** Dispatched the MOMENT input is observed at age 0 — never waits for the next tick (R3-1). */
  | { type: 'USER_INPUT' }
  | { type: 'LOCKED' } | { type: 'UNLOCKED' }
  | { type: 'SUSPEND' } | { type: 'RESUME' }
  | { type: 'FULLSCREEN'; on: boolean }
  | { type: 'DND'; on: boolean }
  | { type: 'USER_HIDDEN'; on: boolean }
  | { type: 'BATTERY'; charging: boolean; level: number | null }
  /** From `arb:touch`. `annoyed` is the renderer's burst verdict; the sim only records it. */
  | { type: 'TOUCH'; part: HitPart; annoyed: boolean }
  | { type: 'CHAT_OPEN'; on: boolean }
  /** One completed user<->assistant exchange. `proactive` marks a turn the pet started. */
  | { type: 'TURN_DONE'; proactive: boolean; interrupted: boolean }
  /** The user sent text. Resets the proactive back-off and the neglect accumulator. */
  | { type: 'TURN_USER' }
  | { type: 'EMOTION'; emotion: Emotion }
  | { type: 'LIVELINESS'; value: number }
  | { type: 'MODE'; mode: PersonaModeIpc }
  /** 别打扰. `untilWall === null` clears it. */
  | { type: 'PROACTIVE_MUTE'; untilWall: number | null }
  /** The gate reserved an intent; the reducer records it so a restart cannot double-fire. */
  | { type: 'PROACTIVE_RESERVE'; reservationId: string; templateId: string; bucket: string }
  /** Terminal outcome of the in-flight intent. */
  | { type: 'PROACTIVE_OUTCOME'; reservationId: string;
      outcome: 'displayed' | 'discarded' | 'suppressed' | 'failed' }
  /** The user replied within PROACTIVE_UNANSWERED_AFTER_MS of a displayed line. */
  | { type: 'PROACTIVE_ANSWERED'; reservationId: string }
  /**
   * CONTRACT GAP (C-1): §3.10.3's unanswered timer writes `unansweredToday`, `backoffN`,
   * `backoffUntilMono` and §3.7.2's "-0.03 arousal" nudge, but §3.2's union has no event that
   * carries it into the reducer (the only state writer). ProactiveController dispatches this when
   * PROACTIVE_UNANSWERED_AFTER_MS elapses without TURN_USER. Needs an Amendment.
   */
  | { type: 'PROACTIVE_UNANSWERED'; reservationId: string };

export const SIM_EVENT_TYPES = [
  'TICK', 'USER_INPUT', 'LOCKED', 'UNLOCKED', 'SUSPEND', 'RESUME', 'FULLSCREEN', 'DND',
  'USER_HIDDEN', 'BATTERY', 'TOUCH', 'CHAT_OPEN', 'TURN_DONE', 'TURN_USER', 'EMOTION',
  'LIVELINESS', 'MODE', 'PROACTIVE_MUTE', 'PROACTIVE_RESERVE', 'PROACTIVE_OUTCOME',
  'PROACTIVE_ANSWERED', 'PROACTIVE_UNANSWERED',
] as const satisfies readonly SimEvent['type'][];

/** The one-shots the adapter must emit, so it never re-derives them (§3.2). */
export type SimEffect =
  | { kind: 'simEvent'; payload: SimEventPayload }        // -> `sim:event` (§2.4)
  | { kind: 'snapshotDirty' }                             // -> broadcast `sim:state`
  | { kind: 'persist' }                                   // -> write the kv snapshot now
  | { kind: 'proactiveEvaluate' };                        // -> ProactiveController.evaluate()

export interface ReduceResult { state: SimState; effects: SimEffect[] }
