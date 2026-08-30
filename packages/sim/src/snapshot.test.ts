import { describe, expect, it } from 'vitest';
import { SimSnapshotSchema } from '@ds/protocol';
import { initialSimState, SIM_DEFAULTS, SimStateSchema, type SimState } from './state.ts';
import { affectionShown } from './affection.ts';
import { SIM_SNAPSHOT_VERSION, SimPersistedSchema, toPersisted, fromPersisted, restoreSim, toSnapshot } from './snapshot.ts';

const D = SIM_DEFAULTS;
const T0 = new Date(2026, 8, 1, 14, 0, 0).getTime();
const live = (): SimState => ({ ...initialSimState(50_000, T0), inputAgeMs: 1_000, sinceInteractionMs: 9e9, valence: 0.42,
  absentSinceMono: 40_000, typingStreakStartedMono: 41_000,
  gate: { ...initialSimState(0, T0).gate, lastDisplayedMono: 50_000 - 300_000, backoffUntilMono: 50_000 + 600_000,
    intent: { reservationId: 'r', templateId: 't', bucket: 'world', reservedMono: 49_000, deferUntilMono: 49_000 + D.PROACTIVE_DEFER_MAX_MS } } });

describe('§3.12 persisted snapshot', () => {
  it('version 1; stores remaining durations, never monotonic timestamps', () => {
    expect(SIM_SNAPSHOT_VERSION).toBe(1);
    const p = toPersisted(live(), 50_000, T0);
    expect(SimPersistedSchema.parse(p)).toEqual(p);
    expect(p.remainingMs).toEqual({ proactiveRate: D.PROACTIVE_RATE_WINDOW_MS - 300_000, proactiveBackoff: 600_000, proactiveDefer: D.PROACTIVE_DEFER_MAX_MS - 1_000 });
    expect(p.intent).toEqual({ reservationId: 'r', templateId: 't', bucket: 'world' });
    expect(JSON.stringify(p)).not.toMatch(/Mono"/);
    expect(p.writtenWall).toBe(T0);
  });
  it('round-trips through JSON and rebases every monotonic field on the new nowMono', () => {
    const p = SimPersistedSchema.parse(JSON.parse(JSON.stringify(toPersisted(live(), 50_000, T0))));
    const s = fromPersisted(p, 7, T0 + 3_600_000);
    expect(SimStateSchema.parse(s)).toEqual(s);
    expect(s.lastMono).toBe(7);
    // DERIVATION (R3-51 / concern C-11): `SimStateSchema.gate.lastDisplayedMono` is `.nonnegative()`
    // (Task 3), and a fresh process starts at a small nowMono, so `nowMono - elapsed` is normally
    // negative — the plan's literal `7 - 300_000` would fail the parse asserted two lines above.
    // The rebase therefore clamps at 0, which can only make the rate window LONGER, never shorter.
    expect(s.gate.lastDisplayedMono).toBe(Math.max(0, 7 - 300_000));
    expect(s.gate.lastDisplayedMono! + D.PROACTIVE_RATE_WINDOW_MS)
      .toBeGreaterThanOrEqual(7 + p.remainingMs.proactiveRate!);      // never eligible EARLIER than persisted
    expect(s.gate.backoffUntilMono).toBe(7 + 600_000);
    expect(s.gate.intent).toMatchObject({ reservationId: 'r', reservedMono: 7, deferUntilMono: 7 + D.PROACTIVE_DEFER_MAX_MS - 1_000 });
    expect(s.absentSinceMono).toBeNull(); expect(s.typingStreakStartedMono).toBeNull(); expect(s.probableTyping).toBe(false);
    expect(s.sinceInteractionMs).toBe(D.NEGLECT_WINDOW_MS);          // preflight F-5 clamp
    expect(s.lastWall).toBe(T0); expect(s.localDate).toBe(live().localDate);   // the first tick sees the jump
    expect(s.valence).toBe(0.42);
  });
  it('null remaining stays null', () => {
    const s = fromPersisted(toPersisted(initialSimState(5, T0), 5, T0), 9, T0);
    expect(s.gate).toMatchObject({ lastDisplayedMono: null, backoffUntilMono: null, intent: null });
  });
  it('restoreSim discards on version mismatch, bad JSON shape and non-objects; keeps a good one', () => {
    const good = toPersisted(live(), 50_000, T0);
    expect(restoreSim(good, 1, T0).discarded).toBeNull();
    expect(restoreSim({ ...good, version: 2 }, 1, T0).discarded).toMatch(/version/);
    expect(restoreSim({ ...good, state: { ...good.state, neglect: -0.5 } }, 1, T0).discarded).toMatch(/neglect/);
    expect(restoreSim('garbage', 1, T0).discarded).not.toBeNull();
    expect(restoreSim(null, 1, T0, { seed: 7 }).state).toEqual(initialSimState(1, T0, { seed: 7 }));
  });
});

describe('§2.4 SimSnapshot builder', () => {
  it('is the broadcast subset: affectionShown applied, userIdleS clamped to 3600, no gate/rng', () => {
    const s = { ...live(), inputAgeMs: 7_200_000, distinctDaysSeen: 20, affection: 3 };
    const snap = toSnapshot(s, 123, T0);
    expect(SimSnapshotSchema.parse(snap)).toEqual(snap);
    expect(snap.tsMain).toBe(123); expect(snap.userIdleS).toBe(3600);
    expect(snap.affection).toBe(affectionShown(s)); expect(snap.affection).toBe(55);
    expect(snap.energy).toBeGreaterThanOrEqual(0); expect(snap.energy).toBeLessThanOrEqual(100);
    expect(Object.keys(snap).sort()).toEqual(['affection', 'arousal', 'battery', 'cursorNear', 'dnd', 'energy', 'liveliness', 'localDate',
      'mode', 'nearEdge', 'onFloor', 'phase', 'presence', 'presentationMode', 'probableTyping', 'userIdleS', 'valence', 'tsMain',
      'uiWorkMode', 'uiSfxMuted'].sort());
  });

  // R3-35 / A3-1: the two UI booleans are on the SNAPSHOT, not on SimState. Task 1 landed them as
  // REQUIRED `z.boolean()` (no `.default()`), so this builder must emit them or the payload fails
  // `SimSnapshotSchema.parse`; it emits `false`, the shipped off state, and `SimService` overlays the
  // tray's live values (Task 12's `setUiFlags`). The reducer must never integrate either.
  it('emits uiWorkMode/uiSfxMuted as false — required fields the reducer has no state for', () => {
    const snap = toSnapshot(live(), 1, T0);
    expect(snap.uiWorkMode).toBe(false);
    expect(snap.uiSfxMuted).toBe(false);
    expect(Object.keys(SimStateSchema.shape)).not.toContain('uiWorkMode');
    expect(Object.keys(SimStateSchema.shape)).not.toContain('uiSfxMuted');
  });

  // R3-49 is runtime-critical: every `sim:state` broadcast goes through the protocol schema, so a
  // snapshot straight off the reducer must parse without any overlay.
  it('R3-49: a snapshot built from a real reduced state parses as the sim:state payload', () => {
    const s = initialSimState(0, T0);
    const snap = toSnapshot(s, 0, T0);
    const parsed = SimSnapshotSchema.safeParse(snap);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(snap);
  });
});
