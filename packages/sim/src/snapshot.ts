// packages/sim/src/snapshot.ts — contracts §3.12 + the §2.4 broadcast subset.
import { z } from 'zod';
import type { SimSnapshot } from '@ds/protocol';
import { initialSimState, SIM_DEFAULTS, SimStateSchema, type SimState } from './state.ts';
import { affectionShown } from './affection.ts';
import { energyOf } from './energy.ts';

const D = SIM_DEFAULTS;
export const SIM_SNAPSHOT_VERSION = 1;

export const SimPersistedSchema = z.object({
  version: z.literal(SIM_SNAPSHOT_VERSION),
  /** Epoch ms the snapshot was written. Used only to detect a wall-clock jump on restore. */
  writtenWall: z.number().nonnegative(),
  /** Everything from SimState EXCEPT every monotonic field, which is rebased on restore. */
  state: SimStateSchema.omit({
    lastMono: true, absentSinceMono: true, typingStreakStartedMono: true, gate: true,
  }).extend({
    gate: SimStateSchema.shape.gate.omit({
      lastDisplayedMono: true, backoffUntilMono: true, intent: true,
    }),
  }),
  /** Every live monotonic deadline, stored as a REMAINING duration in ms (R3-1). */
  remainingMs: z.object({
    /** PROACTIVE_RATE_WINDOW_MS minus the elapsed part, or null when no line was displayed. */
    proactiveRate: z.number().min(0).nullable(),
    /** Remaining back-off, or null. */
    proactiveBackoff: z.number().min(0).nullable(),
    /** Remaining deferral for the in-flight intent, or null. */
    proactiveDefer: z.number().min(0).nullable(),
  }),
  /** The in-flight intent WITHOUT its monotonic fields; reserved_at lives in proactive_log. */
  intent: z.object({
    reservationId: z.string(), templateId: z.string(), bucket: z.string(),
  }).nullable(),
});
export type SimPersisted = z.infer<typeof SimPersistedSchema>;

const remaining = (deadline: number | null, nowMono: number): number | null =>
  deadline === null ? null : Math.max(0, deadline - nowMono);

export function toPersisted(state: SimState, nowMono: number, nowWall: number): SimPersisted {
  const { lastMono: _m, absentSinceMono: _a, typingStreakStartedMono: _t, gate, ...rest } = state;
  const { lastDisplayedMono, backoffUntilMono, intent, ...gateRest } = gate;
  return {
    version: SIM_SNAPSHOT_VERSION,
    writtenWall: nowWall,
    state: { ...rest, gate: gateRest },
    remainingMs: {
      proactiveRate: lastDisplayedMono === null ? null : remaining(lastDisplayedMono + D.PROACTIVE_RATE_WINDOW_MS, nowMono),
      proactiveBackoff: remaining(backoffUntilMono, nowMono),
      proactiveDefer: intent === null ? null : remaining(intent.deferUntilMono, nowMono),
    },
    intent: intent === null ? null : { reservationId: intent.reservationId, templateId: intent.templateId, bucket: intent.bucket },
  };
}

export function fromPersisted(p: SimPersisted, nowMono: number, _nowWall: number): SimState {
  const r = p.remainingMs;
  return {
    ...p.state,
    lastMono: nowMono,                                   // the first tick integrates 0 present time
    absentSinceMono: null,
    typingStreakStartedMono: null,
    probableTyping: false, typingSamples: 0, typingIdleSamples: 0,
    sinceInteractionMs: Math.min(p.state.sinceInteractionMs, D.NEGLECT_WINDOW_MS),   // preflight F-5
    gate: {
      ...p.state.gate,
      // CONCERN C-11 — NEEDS A RULING; the fix is BLOCKED outside this owner group.
      // `SimStateSchema` declares this `.nonnegative()` (Task 3's `state.ts`), and a restart starts
      // at a small nowMono, so the exact rebase `nowMono - elapsed` is normally negative and would
      // not parse. Clamping at 0 can only push the earliest eligible instant LATER, never earlier —
      // the safe direction — but it RE-ARMS THE FULL 20-MINUTE WINDOW: a restart 15 min after a
      // proactive line makes the pet wait 20 more minutes instead of 5. §3.12 asks for
      // `nowMono + remainingMs`, which needs one of (a) Task 3 relaxing `.nonnegative()`,
      // (b) a `gate.rateUntilMono` deadline field (Task 3's schema), or (c) Task 12 offsetting the
      // injected mono origin. None of the three is inside Task 9's owner group.
      lastDisplayedMono: r.proactiveRate === null ? null : Math.max(0, nowMono - (D.PROACTIVE_RATE_WINDOW_MS - r.proactiveRate)),
      backoffUntilMono: r.proactiveBackoff === null ? null : nowMono + r.proactiveBackoff,
      intent: p.intent === null ? null : { ...p.intent, reservedMono: nowMono, deferUntilMono: nowMono + (r.proactiveDefer ?? 0) },
    },
  };
}

/**
 * §3.12 discard-on-mismatch. The caller logs `console.warn('[sim] snapshot discarded:', discarded)`.
 *
 * ABSENCE IS NOT CORRUPTION (fix round 1, finding 5): first launch and every kv reset hand this
 * `null`/`undefined`, and returning a `discarded` reason there would print a corruption-flavoured
 * warning on every clean start. Those two cases return `discarded: null` with a fresh state.
 */
export function restoreSim(raw: unknown, nowMono: number, nowWall: number, opts?: { seed?: number }):
  { state: SimState; discarded: string | null } {
  if (raw === null || raw === undefined) return { state: initialSimState(nowMono, nowWall, opts), discarded: null };
  if (typeof raw === 'object' && (raw as { version?: unknown }).version !== SIM_SNAPSHOT_VERSION)
    return { state: initialSimState(nowMono, nowWall, opts), discarded: `version ${String((raw as { version?: unknown }).version)} != ${SIM_SNAPSHOT_VERSION}` };
  const parsed = SimPersistedSchema.safeParse(raw);
  if (!parsed.success) return { state: initialSimState(nowMono, nowWall, opts), discarded: parsed.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; ') || 'unparseable' };
  return { state: fromPersisted(parsed.data, nowMono, nowWall), discarded: null };
}

/**
 * The `sim:state` payload (§2.4). Gate counters, rng and the reservation never cross to a renderer.
 *
 * R3-35 / contract Amendment A3-1: `uiWorkMode` and `uiSfxMuted` are on `SimSnapshot` but NOT on
 * `SimState` — they are UI toggles read from kv (`ui_work_mode` / `ui_sfx_muted`) that the reducer
 * has no opinion about and must never integrate. Task 1 landed them as REQUIRED `z.boolean()` (no
 * `.default()`), so this builder MUST write them or the payload fails `SimSnapshotSchema.parse`; it
 * writes `false`, the shipped-off state, and `SimService.snapshot()` overlays the live values it was
 * handed by the tray relay (`setUiFlags`, Task 12). Emitting them here rather than omitting them
 * keeps the return type a whole `SimSnapshot`, so `tsc` catches the day a third UI flag is added and
 * nobody overlays it.
 */
export function toSnapshot(state: SimState, nowMono: number, nowWall: number): SimSnapshot {
  return {
    tsMain: nowMono,
    presence: state.presence, presentationMode: state.presentationMode, phase: state.phase,
    valence: state.valence, arousal: state.arousal,
    energy: energyOf(state, nowWall),
    affection: affectionShown(state),
    liveliness: state.liveliness,
    userIdleS: Math.min(3600, Math.floor(state.inputAgeMs / 1000)),
    probableTyping: state.probableTyping,
    cursorNear: state.cursorNear, onFloor: state.onFloor, nearEdge: state.nearEdge,
    dnd: state.dnd, battery: { charging: state.battery.charging, level: state.battery.level },
    mode: state.mode, localDate: state.localDate,
    // R3-35 / A3-1 — required on the schema (Task 1 shipped them without `.default()`), so they are
    // written here as the shipped-off state; SimService.setUiFlags supplies the live values.
    uiWorkMode: false, uiSfxMuted: false,
  };
}
