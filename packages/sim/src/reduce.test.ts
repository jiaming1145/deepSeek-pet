import { describe, expect, it } from 'vitest';
import { EMOTIONS, HIT_PARTS, SimEventSchema, type SimEventPayload } from '@ds/protocol';
import { initialSimState, SIM_DEFAULTS, SimStateSchema, type SimState } from './state.ts';
import { reduce, reduceWithEffects, EMOTION_NUDGES } from './reduce.ts';
import { isPresent } from './presence.ts';   // Task 3 owns it; reduce.ts imports it too
import { MOOD_NUDGES, neglectTick, settleOnReturn } from './mood.ts';   // the one nudge table + arithmetic (Task 3)
import { SIM_EVENT_TYPES, type ReduceResult, type SimEvent, type SimEffect } from './events.ts';
import { nextRandom } from './rng.ts';

const D = SIM_DEFAULTS;
const T0 = new Date(2026, 8, 1, 14, 0, 0).getTime();   // local Tue 14:00, phase 'day', lunch passed
const tickEv = (inputAgeMs = 0, cursorDeltaDip = 50): SimEvent =>
  ({ type: 'TICK', inputAgeMs, cursorDeltaDip, cursorNear: false, onFloor: true, nearEdge: false });
const tick = (s: SimState, mono: number, wall: number, inputAgeMs = 0, cd = 50) =>
  reduceWithEffects(s, tickEv(inputAgeMs, cd), mono, wall);
const kinds = (fx: SimEffect[]) => fx.filter(f => f.kind === 'simEvent').map(f => (f as { payload: { kind: string } }).payload.kind);
const fresh = () => reduce(initialSimState(0, T0), tickEv(0), 1, T0);   // 1 ms present: new-day grant fired, passed meals settled

describe('§3.3 tick contract', () => {
  it('caps delta at 2 s and treats a negative delta as 0', () => {
    const s = { ...fresh(), valence: 0.9 };
    // DERIVATION (R3-51): fresh() stamps lastMono = 1, so the uncapped comparison tick must run at
    // 1 + TICK_DELTA_CAP_MS = 2_001 for its delta to be exactly the cap. The plan's 2_000 would
    // integrate 1_999 ms and differ from the capped branch by ~2e-7 — deviation recorded.
    const a = reduce(s, tickEv(0), 3_600_000, T0 + 3_600_000);        // 1 h missed -> 2 s
    const b = reduce(s, tickEv(0), s.lastMono + D.TICK_DELTA_CAP_MS, T0 + 2_001);
    expect(a.valence).toBe(b.valence);
    expect(reduce(s, tickEv(0), -5, T0).valence).toBe(0.9);
  });
  it('PRESENT := !locked && !suspended && inputAgeMs < 300 s; visibility does not matter', () => {
    expect(isPresent({ locked: false, suspended: false, inputAgeMs: 299_999 })).toBe(true);
    expect(isPresent({ locked: false, suspended: false, inputAgeMs: 300_000 })).toBe(false);
    const hidden = reduce(fresh(), { type: 'USER_HIDDEN', on: true }, 1, T0);
    expect(tick(hidden, 2_001, T0 + 2_001).state.presentMsToday).toBeGreaterThan(0);
  });
  it('presence table: active -> idle-present (nap, no wake) -> absent -> returned', () => {
    let r = tick(fresh(), 500, T0 + 500, 300_000);
    expect(r.state.presence).toBe('idle-present'); expect(r.state.presentationMode).toBe('nap');
    expect(kinds(r.effects)).toEqual([]);
    r = tick(r.state, 1_000, T0 + 1_000, 1_800_000);
    expect(r.state.presence).toBe('absent');
    r = reduceWithEffects(r.state, { type: 'USER_INPUT' }, 1_500, T0 + 1_500);
    expect(r.state.presence).toBe('active'); expect(r.state.presentationMode).toBe('awake');
    expect(r.effects).toContainEqual({ kind: 'simEvent', payload: { kind: 'returned', tsMain: 1_500, awayMs: 1_000 } });
    expect(r.effects).toContainEqual({ kind: 'proactiveEvaluate' });
  });
  it('sleep: idle >= 15 min during night', () => {
    const night = new Date(2026, 8, 1, 23, 0, 0).getTime();
    const s = reduce(fresh(), tickEv(0), 100, night);
    expect(s.phase).toBe('night');
    expect(reduce(s, tickEv(900_000), 600, night + 500).presentationMode).toBe('sleep');
  });
  it('no-op events return the same reference; a changing tick emits snapshotDirty, an idle one does not', () => {
    const s = fresh();
    const r = reduceWithEffects(s, { type: 'FULLSCREEN', on: false }, 1, T0 + 1);
    expect(r.state).toBe(s); expect(r.effects).toEqual([]);
    const locked = reduce(reduce(s, { type: 'LOCKED' }, 2, T0 + 2), tickEv(600_000), 501, T0 + 501);
    const idle = tick(locked, 1_001, T0 + 1_001, 600_000);            // identical sample -> nothing but the clocks move
    expect(idle.effects.find(f => f.kind === 'snapshotDirty')).toBeUndefined();
    expect(idle.state.lastMono).toBe(1_001);
    expect(tick(s, 501, T0 + 501).effects).toContainEqual({ kind: 'snapshotDirty' });
  });
  it('§3.3 item 3: one-shots follow the typing step, and `returned` precedes phaseChanged/mealCue', () => {
    const away = tick(fresh(), 500, T0 + 500, 1_800_000);                 // -> absent
    expect(away.state.presence).toBe('absent');
    const back = tick(away.state, 1_000, new Date(2026, 8, 1, 22, 0, 0).getTime(), 0);
    expect(kinds(back.effects)).toEqual(['returned', 'phaseChanged']);    // presence (1) before clock (2)
  });
  it('§3.3 item 3: presence is computed BEFORE the phase, so sleep needs the tick after the boundary', () => {
    // A tick that both crosses into `night` and reports >= 15 min idle sees the PREVIOUS phase in
    // the presence step, so it lands on `nap`; the next tick, with phase already `night`, sleeps.
    const night = new Date(2026, 8, 1, 22, 0, 0).getTime();
    const a = tick(fresh(), 500, night, 900_000);
    expect(a.state.phase).toBe('night'); expect(a.state.presentationMode).toBe('nap');
    expect(tick(a.state, 1_000, night + 500, 900_000).state.presentationMode).toBe('sleep');
  });
  it('typingStreakStartedMono is never negative (SimStateSchema declares it .nonnegative())', () => {
    let r = tick(fresh(), 400, T0 + 400, 100, 0);
    for (const m of [800, 1_200, 1_600]) r = tick(r.state, m, T0 + m, 100, 0);
    expect(r.state.probableTyping).toBe(true);
    expect(r.state.typingStreakStartedMono).toBe(0);                      // 1_600 - 4 * 500 = -400, clamped
    expect(SimStateSchema.safeParse(r.state).success).toBe(true);
  });
  it('persist effect once per 60-s wall boundary', () => {
    const s = fresh();
    expect(tick(s, 500, T0 + 30_000).effects.find(f => f.kind === 'persist')).toBeUndefined();
    expect(tick(s, 500, T0 + 60_000).effects).toContainEqual({ kind: 'persist' });
  });
});

describe('§3.6.2 grants, §3.7 mood, §3.8 energy', () => {
  it('grant table: exchange 1.0, touch 0.5 (not when annoyed), answered 1.0, new day 0.5 + distinctDaysSeen', () => {
    const s = fresh();
    expect(s.distinctDaysSeen).toBe(1); expect(s.affection).toBe(0.5);
    expect(reduce(s, { type: 'TURN_DONE', proactive: false, interrupted: false }, 1, T0).affection).toBe(1.5);
    expect(reduce(s, { type: 'TURN_DONE', proactive: true, interrupted: false }, 1, T0).affection).toBe(0.5);
    expect(reduce(s, { type: 'TOUCH', part: 'head', annoyed: false }, 1, T0).affection).toBe(1.0);
    expect(reduce(s, { type: 'TOUCH', part: 'head', annoyed: true }, 1, T0).affection).toBe(0.5);
    expect(reduce(s, { type: 'PROACTIVE_ANSWERED', reservationId: 'x' }, 1, T0).affection).toBe(1.5);
  });
  it('daily cap 12 and reset at the local-date change', () => {
    let s = fresh();
    for (let i = 0; i < 20; i++) s = reduce(s, { type: 'TURN_DONE', proactive: false, interrupted: false }, i, T0);
    expect(s.earnedToday).toBe(12); expect(s.affection).toBe(12);
    const next = reduce(s, tickEv(0), 100, T0 + 86_400_000);
    expect(next.earnedToday).toBe(0.5); expect(next.distinctDaysSeen).toBe(2);
  });
  it('EMOTION nudges follow the §3.7.2 table and clamp', () => {
    for (const e of EMOTIONS) {
      const s = { ...fresh(), valence: 0, arousal: 0.5 };
      const n = reduce(s, { type: 'EMOTION', emotion: e }, 1, T0);
      expect([n.valence, n.arousal]).toEqual([EMOTION_NUDGES[e][0], 0.5 + EMOTION_NUDGES[e][1]]);
    }
    const hi = reduce({ ...fresh(), valence: 0.99, arousal: 0.99 }, { type: 'EMOTION', emotion: 'angry' }, 1, T0);
    expect(hi.arousal).toBe(1); expect(hi.valence).toBeCloseTo(0.95, 10);
  });
  it('EMOTION_NUDGES mirrors mood.ts MOOD_NUDGES.emotion — one table, no drift (C-10)', () => {
    for (const e of EMOTIONS)
      expect([...EMOTION_NUDGES[e]]).toEqual([MOOD_NUDGES.emotion[e].dValence, MOOD_NUDGES.emotion[e].dArousal]);
  });
  it('the touch / interrupted / unanswered nudges are mood.ts numbers too', () => {
    const s = { ...fresh(), valence: 0, arousal: 0.5 };
    const t = reduce(s, { type: 'TOUCH', part: 'head', annoyed: false }, 1, T0);
    expect(t.valence).toBeCloseTo(MOOD_NUDGES.touch.dValence, 10);
    expect(t.arousal).toBeCloseTo(0.5 + MOOD_NUDGES.touch.dArousal, 10);
    const a = reduce(s, { type: 'TOUCH', part: 'head', annoyed: true }, 1, T0);
    expect(a.valence).toBeCloseTo(MOOD_NUDGES.touchAnnoyed.dValence, 10);
    expect(a.arousal).toBeCloseTo(0.5 + MOOD_NUDGES.touchAnnoyed.dArousal, 10);
    const i = reduce(s, { type: 'TURN_DONE', proactive: false, interrupted: true }, 1, T0);
    expect(i.valence).toBeCloseTo(MOOD_NUDGES.turnInterrupted.dValence, 10);
    const u = reduce(s, { type: 'PROACTIVE_UNANSWERED', reservationId: 'r' }, 1, T0);
    expect(u.arousal).toBeCloseTo(0.5 + MOOD_NUDGES.proactiveUnanswered.dArousal, 10);
  });
  it('mood decays toward base only while PRESENT; frozen when idle-present or locked', () => {
    const s = { ...fresh(), valence: 0.8 };
    expect(reduce(s, tickEv(0), 2_000, T0 + 2_000).valence).toBeLessThan(0.8);
    expect(reduce(s, tickEv(400_000), 2_000, T0 + 2_000).valence).toBe(0.8);
    expect(reduce(reduce(s, { type: 'LOCKED' }, 1, T0), tickEv(0), 2_000, T0 + 2_000).valence).toBe(0.8);
  });
  it('neglect: 45 min PRESENT without interaction -> -0.05, floor -0.2, reset by TOUCH', () => {
    let s = fresh();
    for (let i = 1; i <= 4 * 1_350 + 1; i++) s = reduce(s, tickEv(0), i * 2_000, T0 + i * 2_000);   // > 3 h present
    expect(s.neglect).toBe(-0.2);
    expect(reduce(s, { type: 'TOUCH', part: 'body', annoyed: false }, 1e9, T0 + 1e9).neglect).toBe(0);
  });
  it('expenditure: +0.5 per TURN_DONE, +0.15 per TOUCH, max 40, decays while present', () => {
    let s = fresh();
    for (let i = 0; i < 100; i++) s = reduce(s, { type: 'TURN_DONE', proactive: false, interrupted: false }, i, T0);
    expect(s.expenditure).toBe(40);
    expect(reduce(s, tickEv(0), 2_000, T0 + 2_000).expenditure).toBeLessThan(40);
    expect(reduce(fresh(), { type: 'TOUCH', part: 'arm', annoyed: false }, 1, T0).expenditure).toBeCloseTo(0.15, 10);
  });
});

describe('§3.9 phases, meals, §3.2 one-shots', () => {
  it('phaseChanged fires on the boundary once; nightEntry set', () => {
    const s = fresh();
    const r = tick(s, 10, new Date(2026, 8, 1, 22, 0, 0).getTime());
    expect(kinds(r.effects)).toEqual(['phaseChanged']); expect(r.state.firedToday.nightEntry).toBe(true);
    expect(kinds(tick(r.state, 20, new Date(2026, 8, 1, 22, 0, 1).getTime()).effects)).toEqual([]);
  });
  it('§3.9 "at most once per localDate per marker": a clock oscillation across 22:00 fires night once', () => {
    // Repro from fix round 1, finding 1: 21:59 -> 22:00:01 -> 21:59:59 -> 22:00:02, one localDate.
    const at = (h: number, m: number, sec: number) => new Date(2026, 8, 1, h, m, sec).getTime();
    const seen: string[] = [];
    let s = fresh();
    let mono = 10;
    for (const w of [at(21, 59, 0), at(22, 0, 1), at(21, 59, 59), at(22, 0, 2)]) {
      const r = tick(s, (mono += 10), w);
      s = r.state;
      for (const f of r.effects)
        if (f.kind === 'simEvent' && f.payload.kind === 'phaseChanged') seen.push(f.payload.phase!);
    }
    expect(s.localDate).toBe('2026-09-01');                       // one localDate throughout
    expect(seen.filter(p => p === 'night')).toEqual(['night']);   // the night marker fired ONCE
    expect(seen).toEqual(['evening', 'night']);                   // and each other marker at most once
    expect(s.phase).toBe('night');                                // the field still follows the wall clock
    expect(s.firedToday.nightEntry).toBe(true);
  });
  it('mealCue fires inside its 20-min window, once per day; a forward jump past the window skips it', () => {
    const s = { ...fresh(), mealJitterMs: { breakfast: 0, lunch: 0, dinner: 0 } };
    const dinner = new Date(2026, 8, 1, 19, 0, 0).getTime();
    const r = tick(s, 10, dinner + 1_000);
    expect(r.effects).toContainEqual({ kind: 'simEvent', payload: { kind: 'mealCue', tsMain: 10, meal: 'dinner' } });
    expect(kinds(tick(r.state, 20, dinner + 2_000).effects)).toEqual([]);
    const skipped = tick(s, 10, dinner + 25 * 60_000);
    // DERIVATION (R3-51): `s` is at 14:00 ('day'); the jump to 19:25 also crosses into 'evening', so
    // the effect list carries phaseChanged. The assertion is about mealCue being SKIPPED — deviation
    // from the plan's `toEqual([])` recorded.
    expect(kinds(skipped.effects)).toEqual(['phaseChanged']);
    expect(kinds(skipped.effects)).not.toContain('mealCue');
    expect(skipped.state.firedToday.dinner).toBe(true);
  });
  it('typing: 4 samples in -> typingGlance; 2 samples out after a >= 5 min streak -> cheer', () => {
    let r = tick(fresh(), 500, T0 + 500, 100, 0);
    for (let i = 2; i <= 4; i++) r = tick(r.state, i * 500, T0 + i * 500, 100, 0);
    expect(r.state.probableTyping).toBe(true); expect(kinds(r.effects)).toEqual(['typingGlance']);
    let m = 4 * 500;
    for (let i = 0; i < 700; i++) { m += 500; r = tick(r.state, m, T0 + m, 100, 0); }   // 350 s streak
    r = tick(r.state, m + 500, T0 + m + 500, 5_000, 30);
    r = tick(r.state, m + 1_000, T0 + m + 1_000, 5_500, 30);
    expect(r.state.probableTyping).toBe(false); expect(kinds(r.effects)).toEqual(['cheer']);
  });
  it('battery: batteryLow below 0.20 while discharging (once), onCharger on the charging edge', () => {
    const s = fresh();
    const low = reduceWithEffects(s, { type: 'BATTERY', charging: false, level: 0.19 }, 1, T0);
    expect(kinds(low.effects)).toEqual(['batteryLow']);
    expect(kinds(reduceWithEffects(low.state, { type: 'BATTERY', charging: false, level: 0.10 }, 2, T0).effects)).toEqual([]);
    expect(kinds(reduceWithEffects(low.state, { type: 'BATTERY', charging: true, level: 0.10 }, 3, T0).effects)).toEqual(['onCharger']);
    expect(reduce(s, { type: 'BATTERY', charging: false, level: 7 }, 1, T0).battery.level).toBe(1);
  });
  it('TOUCH annoyed emits `annoyed`; LIVELINESS clamps; MODE plain stored', () => {
    expect(kinds(reduceWithEffects(fresh(), { type: 'TOUCH', part: 'face', annoyed: true }, 1, T0).effects)).toEqual(['annoyed']);
    expect(reduce(fresh(), { type: 'LIVELINESS', value: 7 }, 1, T0).liveliness).toBe(1);
    expect(reduce(fresh(), { type: 'LIVELINESS', value: -1 }, 1, T0).liveliness).toBe(0);
    expect(reduce(fresh(), { type: 'MODE', mode: 'plain' }, 1, T0).mode).toBe('plain');
  });
});

// R3-47: SimEventSchema is flat-optional by design, so the exclusivity of the kind-specific fields
// is pinned HERE, producer-side (Task 12 pins the same thing at the dispatch boundary).
describe('R3-47 conditional payload fields', () => {
  it('only `returned` carries awayMs, only `phaseChanged` carries phase, only `mealCue` carries meal', () => {
    const payloads: SimEventPayload[] = [];
    const take = (r: ReduceResult): SimState => {
      for (const f of r.effects) if (f.kind === 'simEvent') payloads.push(f.payload);
      return r.state;
    };
    let s = fresh();
    s = take(tick(s, 500, T0 + 500, 300_000));                                              // -> nap
    s = take(reduceWithEffects(s, { type: 'USER_INPUT' }, 1_000, T0 + 1_000));               // returned
    s = take(reduceWithEffects(s, { type: 'TOUCH', part: 'head', annoyed: true }, 1_100, T0 + 1_100));   // annoyed
    s = take(reduceWithEffects(s, { type: 'BATTERY', charging: false, level: 0.1 }, 1_200, T0 + 1_200)); // batteryLow
    s = take(reduceWithEffects(s, { type: 'BATTERY', charging: true, level: 0.1 }, 1_300, T0 + 1_300));  // onCharger
    s = { ...s, mealJitterMs: { breakfast: 0, lunch: 0, dinner: 0 } };
    const DIN = new Date(2026, 8, 1, 19, 0, 10).getTime();
    s = take(tick(s, 1_400, DIN));                                                          // phaseChanged + mealCue
    let m = 1_400;
    for (let i = 0; i < 4; i++) { m += 500; s = take(tick(s, m, DIN + (m - 1_400), 100, 0)); }   // typingGlance
    for (let i = 0; i < 700; i++) { m += 500; s = take(tick(s, m, DIN + (m - 1_400), 100, 0)); } // 350 s streak
    for (let i = 0; i < 2; i++) { m += 500; s = take(tick(s, m, DIN + (m - 1_400), 5_000, 30)); } // cheer

    expect(new Set(payloads.map(p => p.kind))).toEqual(new Set(
      ['returned', 'annoyed', 'batteryLow', 'onCharger', 'phaseChanged', 'mealCue', 'typingGlance', 'cheer']));
    for (const p of payloads) {
      expect(SimEventSchema.parse(p)).toEqual(p);
      expect(Object.hasOwn(p, 'awayMs'), p.kind).toBe(p.kind === 'returned');
      expect(Object.hasOwn(p, 'phase'), p.kind).toBe(p.kind === 'phaseChanged');
      expect(Object.hasOwn(p, 'meal'), p.kind).toBe(p.kind === 'mealCue');
      expect(Object.hasOwn(p, 'tsMain'), p.kind).toBe(true);
    }
  });
});

describe('gate bookkeeping', () => {
  it('reserve -> displayed charges caps and clears the intent; discarded charges nothing', () => {
    const s = fresh();
    const res = reduce(s, { type: 'PROACTIVE_RESERVE', reservationId: 'r1', templateId: 't', bucket: 'greeting' }, 1_000, T0);
    expect(res.gate.intent).toEqual({ reservationId: 'r1', templateId: 't', bucket: 'greeting', reservedMono: 1_000, deferUntilMono: 1_000 + D.PROACTIVE_DEFER_MAX_MS });
    const shown = reduce(res, { type: 'PROACTIVE_OUTCOME', reservationId: 'r1', outcome: 'displayed' }, 2_000, T0);
    expect(shown.gate).toMatchObject({ intent: null, lastDisplayedMono: 2_000, displayedToday: 1 });
    expect(shown.firedToday.morningGreeting).toBe(true);
    const dropped = reduce(res, { type: 'PROACTIVE_OUTCOME', reservationId: 'r1', outcome: 'discarded' }, 2_000, T0);
    expect(dropped.gate).toMatchObject({ intent: null, lastDisplayedMono: null, displayedToday: 0 });
    expect(reduce(res, { type: 'PROACTIVE_OUTCOME', reservationId: 'other', outcome: 'displayed' }, 2_000, T0)).toBe(res);
  });
  it('unanswered: counter, backoffN, seeded back-off, -0.03 arousal; TURN_USER resets the back-off', () => {
    const s = { ...fresh(), arousal: 0.5 };
    const u = reduce(s, { type: 'PROACTIVE_UNANSWERED', reservationId: 'r1' }, 5_000, T0);
    expect(u.gate.unansweredToday).toBe(1); expect(u.gate.backoffN).toBe(1);
    expect(u.gate.backoffUntilMono).toBeGreaterThanOrEqual(5_000);
    expect(u.gate.backoffUntilMono!).toBeLessThan(5_000 + D.PROACTIVE_BACKOFF_BASE_MS);
    expect(u.rngState).toBe(nextRandom(s.rngState).rngState);
    expect(u.arousal).toBeCloseTo(0.47, 10);
    const reset = reduce(u, { type: 'TURN_USER' }, 6_000, T0);
    expect(reset.gate).toMatchObject({ backoffN: 0, backoffUntilMono: null });
  });
  it('PROACTIVE_MUTE sets/clears mutedUntilWall and asks for a re-evaluation', () => {
    const r = reduceWithEffects(fresh(), { type: 'PROACTIVE_MUTE', untilWall: 8.64e15 }, 1, T0);
    expect(r.state.gate.mutedUntilWall).toBe(8.64e15); expect(r.effects).toContainEqual({ kind: 'proactiveEvaluate' });
    expect(reduce(r.state, { type: 'PROACTIVE_MUTE', untilWall: null }, 2, T0).gate.mutedUntilWall).toBeNull();
  });
});

describe('§3.6 fuzz: 10 000 random events never decrease affection (R3-8)', () => {
  it('holds for every SimEvent type with random clocks, including 26-h rollbacks', () => {
    let rng = 0xC0FFEE;
    const rand = () => { const r = nextRandom(rng); rng = r.rngState; return r.value; };
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    const gen = (): SimEvent => {
      const t = pick(SIM_EVENT_TYPES);
      switch (t) {
        case 'TICK': return tickEv(Math.floor(rand() * 3_600_000), rand() * 10);
        case 'FULLSCREEN': case 'DND': case 'USER_HIDDEN': case 'CHAT_OPEN': return { type: t, on: rand() < 0.5 };
        case 'BATTERY': return { type: t, charging: rand() < 0.5, level: rand() < 0.2 ? null : rand() * 2 - 0.5 };
        case 'TOUCH': return { type: t, part: pick(HIT_PARTS), annoyed: rand() < 0.3 };
        case 'TURN_DONE': return { type: t, proactive: rand() < 0.3, interrupted: rand() < 0.3 };
        case 'EMOTION': return { type: t, emotion: pick(EMOTIONS) };
        case 'LIVELINESS': return { type: t, value: rand() * 3 - 1 };
        case 'MODE': return { type: t, mode: rand() < 0.5 ? 'plain' : 'character' };
        case 'PROACTIVE_MUTE': return { type: t, untilWall: rand() < 0.5 ? null : T0 + rand() * 1e8 };
        case 'PROACTIVE_RESERVE': return { type: t, reservationId: 'r' + Math.floor(rand() * 3), templateId: 't', bucket: 'world' };
        case 'PROACTIVE_OUTCOME': return { type: t, reservationId: 'r' + Math.floor(rand() * 3), outcome: pick(['displayed', 'discarded', 'suppressed', 'failed'] as const) };
        case 'PROACTIVE_ANSWERED': case 'PROACTIVE_UNANSWERED': return { type: t, reservationId: 'r' + Math.floor(rand() * 3) };
        default: return { type: t } as SimEvent;
      }
    };
    let s = fresh(); let mono = 0; let wall = T0;
    for (let i = 0; i < 10_000; i++) {
      mono += Math.floor(rand() * 5_000);
      wall += rand() < 0.01 ? -26 * 3_600_000 : Math.floor(rand() * 5_000);
      const before = s.affection;
      s = reduce(s, gen(), mono, wall);
      expect(s.affection).toBeGreaterThanOrEqual(before);
      expect(s.valence).toBeGreaterThanOrEqual(-1); expect(s.valence).toBeLessThanOrEqual(1);
      expect(s.arousal).toBeGreaterThanOrEqual(0); expect(s.arousal).toBeLessThanOrEqual(1);
      expect(s.neglect).toBeGreaterThanOrEqual(-0.2); expect(s.expenditure).toBeLessThanOrEqual(40);
      // The reducer's own state invariants, not just the four scalars: every field must still
      // satisfy §3.1's schema (this is what caught the negative typingStreakStartedMono).
      if (i % 10 === 0) expect(SimStateSchema.safeParse(s).success, `iteration ${i}`).toBe(true);
    }
    expect(SimStateSchema.safeParse(s).success).toBe(true);
  });
});

describe('§3.7 the reducer calls mood.ts — no second copy of the arithmetic (§5.13)', () => {
  it('the return settle is settleOnReturn(s), bit-identical', () => {
    // > RETURN_SETTLE_AFTER_MS away, with an ADVERSE valence so both axes move.
    const s0 = { ...fresh(), valence: -0.6, arousal: 0.9 };
    const away = tick(s0, 500, T0 + 500, 1_800_000);
    const wall = T0 + 500 + 3 * 3_600_000;
    const back = reduceWithEffects(away.state, { type: 'USER_INPUT' }, 500 + 3 * 3_600_000, wall);
    const expected = settleOnReturn(away.state);
    expect(back.state.valence).toBe(expected.valence);
    expect(back.state.arousal).toBe(expected.arousal);
    expect(back.state.valence).not.toBe(away.state.valence);       // it really did settle
  });
  it('the neglect accumulator is neglectTick(...), and is O(1) in sinceInteractionMs', () => {
    const s0 = { ...fresh(), sinceInteractionMs: 9e9 };            // schema is only .min(0)
    const t0 = Date.now();
    const r = tick(s0, s0.lastMono + 2_000, T0 + 2_000);
    const expected = neglectTick(9e9, s0.neglect, D.TICK_DELTA_CAP_MS);
    expect(r.state.sinceInteractionMs).toBe(expected.sinceInteractionMs);
    expect(r.state.neglect).toBe(expected.neglect);
    expect(Date.now() - t0).toBeLessThan(1_000);                   // the old `while` span ~3 333 turns
  });
});
