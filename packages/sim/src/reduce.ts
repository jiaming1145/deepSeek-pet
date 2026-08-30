// packages/sim/src/reduce.ts — contracts §3.2, §3.3, §3.6.2, §3.7, §3.8, §3.9. Pure and total.
import type { Emotion, SimEventPayload } from '@ds/protocol';
import { SIM_DEFAULTS, type SimState } from './state.ts';
import type { ReduceResult, SimEffect, SimEvent } from './events.ts';
import { grantAffection } from './affection.ts';
import { decayToward, moodNudge } from './mood.ts';
import { localDateString, localHour, mealJitter, phaseOf } from './phases.ts';
import { isPresent } from './presence.ts';   // Task 3 owns the ONE definition (§3.3)
import { backoffDelay } from './proactive.ts';

const D = SIM_DEFAULTS;
const MEALS = ['breakfast', 'lunch', 'dinner'] as const;
const AWAY_MAX_MS = 604_800_000;
/** A meal cue fires only inside this window after its jittered time (§3.9 "forward jump skips"; §3.10.5's 20 min). */
export const MEAL_CUE_WINDOW_MS = 1_200_000;
/** §3.12 "written every 60 s": a `persist` effect on every 60-s WALL boundary the reducer crosses (see Concern C-5). */
export const PERSIST_EVERY_MS = 60_000;

/** §3.7.2, [dValence, dArousal]. The numbers are mood.ts's MOOD_NUDGES.emotion; reduce.test.ts asserts equality. */
export const EMOTION_NUDGES: Record<Emotion, readonly [number, number]> = {
  happy: [0.05, 0.04], surprised: [0.02, 0.10], curious: [0.02, 0.04], think: [0, -0.02],
  question: [0, 0.01], neutral: [0, 0], awkward: [-0.01, 0.03], sad: [-0.05, -0.04], angry: [-0.04, 0.08],
};

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const num = (x: number, fallback = 0): number => (Number.isFinite(x) ? x : fallback);

const nudge = (s: SimState, dv: number, da: number): SimState =>
  dv === 0 && da === 0 ? s : { ...s, valence: clamp(s.valence + dv, -1, 1), arousal: clamp(s.arousal + da, 0, 1) };
const interacted = (s: SimState): SimState =>
  s.sinceInteractionMs === 0 && s.neglect === 0 ? s : { ...s, sinceInteractionMs: 0, neglect: 0 };
const spend = (s: SimState, pts: number): SimState =>
  isPresent(s) ? { ...s, expenditure: clamp(s.expenditure + pts, 0, D.ENERGY_EXPENDITURE_MAX) } : s;
const grant = (s: SimState, amount: number): SimState => ({ ...s, ...grantAffection(s, amount) });
const ev = (payload: SimEventPayload): SimEffect => ({ kind: 'simEvent', payload });

/** §3.3 row 5. Recomputes presence/presentationMode from the flags; emits `returned` and settles. */
function applyPresence(s: SimState, nowMono: number, fx: SimEffect[]): SimState {
  const presence = s.locked || s.suspended || s.inputAgeMs >= D.IDLE_PRESENT_MAX_MS ? 'absent'
    : s.inputAgeMs >= D.PRESENT_INPUT_MAX_MS ? 'idle-present' : 'active';
  const presentationMode = presence === 'active' ? 'awake'
    : s.phase === 'night' && s.inputAgeMs >= D.SLEEP_PHASE_IDLE_MS ? 'sleep' : 'nap';
  if (presence === s.presence && presentationMode === s.presentationMode) return s;
  const next: SimState = { ...s, presence, presentationMode };
  if (presence !== 'active' && s.presence === 'active') next.absentSinceMono = nowMono;   // mood freezes by not integrating
  if (presence === 'active' && s.presence !== 'active') {
    const awayMs = clamp(nowMono - (s.absentSinceMono ?? nowMono), 0, AWAY_MAX_MS);
    fx.push(ev({ kind: 'returned', tsMain: nowMono, awayMs }), { kind: 'proactiveEvaluate' });
    next.absentSinceMono = null;
    if (awayMs > D.RETURN_SETTLE_AFTER_MS) {                       // §3.7.3 — ONLY the adverse component moves
      const base = s.valenceBase + s.neglect;
      next.valence = s.valence < base ? s.valence + (base - s.valence) * D.RETURN_SETTLE_FRACTION : s.valence;
      next.arousal = s.arousal + (s.arousalBase - s.arousal) * D.RETURN_SETTLE_FRACTION;
    }
  }
  return next;
}

/** §3.9: localDate/phase/meals from nowWall only; one-shots keyed by localDate. */
function applyClock(s: SimState, nowMono: number, nowWall: number, fx: SimEffect[]): SimState {
  const localDate = localDateString(nowWall);
  const phase = phaseOf(localHour(nowWall));
  let n = s;
  if (localDate !== s.localDate) {
    n = { ...n, localDate, earnedToday: 0, presentMsToday: 0,
      firedToday: { morningGreeting: false, nightEntry: false, breakfast: false, lunch: false, dinner: false },
      mealJitterMs: { breakfast: mealJitter(localDate, 'breakfast'), lunch: mealJitter(localDate, 'lunch'), dinner: mealJitter(localDate, 'dinner') } };
    if (localDate !== s.gate.lastCountedDate)                    // §3.10 local-day rule
      n = { ...n, gate: { ...n.gate, displayedToday: 0, unansweredToday: 0, lastCountedDate: localDate } };
  }
  if (phase !== n.phase) {
    n = { ...n, phase };
    fx.push(ev({ kind: 'phaseChanged', tsMain: nowMono, phase }));
    if (phase === 'night' && !n.firedToday.nightEntry) n = { ...n, firedToday: { ...n.firedToday, nightEntry: true } };
  }
  const dayMs = localHour(nowWall) * 3_600_000;
  for (const meal of MEALS) {
    if (n.firedToday[meal]) continue;
    const at = D.MEAL_HOURS[meal] * 3_600_000 + n.mealJitterMs[meal];
    if (dayMs < at) continue;
    n = { ...n, firedToday: { ...n.firedToday, [meal]: true } };
    if (dayMs < at + MEAL_CUE_WINDOW_MS) fx.push(ev({ kind: 'mealCue', tsMain: nowMono, meal }));
  }
  return n;
}

function applyTick(s: SimState, e: Extract<SimEvent, { type: 'TICK' }>, nowMono: number, nowWall: number, fx: SimEffect[]): SimState {
  const delta = clamp(num(nowMono - s.lastMono), 0, D.TICK_DELTA_CAP_MS);
  let n: SimState = { ...s, inputAgeMs: clamp(num(e.inputAgeMs), 0, AWAY_MAX_MS),
    cursorNear: !!e.cursorNear, onFloor: !!e.onFloor, nearEdge: !!e.nearEdge };
  // 1 presence  2 phase/localDate
  n = applyClock(n, nowMono, nowWall, fx);
  n = applyPresence(n, nowMono, fx);
  const pd = isPresent(n) ? delta : 0;
  if (pd > 0) {
    if (n.presentMsToday === 0) { n = grant(n, D.AFFECTION_PER_NEW_DAY); n.distinctDaysSeen += 1; }   // §3.3 item 4
    n.presentMsToday += pd;
    // 3 mood  4 energy
    n.valence = clamp(decayToward(n.valence, n.valenceBase + n.neglect, pd, D.MOOD_HALF_LIFE_PRESENT_MS), -1, 1);
    n.arousal = clamp(decayToward(n.arousal, n.arousalBase, pd, D.MOOD_HALF_LIFE_PRESENT_MS), 0, 1);
    n.expenditure = clamp(decayToward(n.expenditure, 0, pd, D.ENERGY_EXPENDITURE_HALF_LIFE_PRESENT_MS), 0, D.ENERGY_EXPENDITURE_MAX);
    // 5 neglect (§3.7.4)
    n.sinceInteractionMs += pd;
    while (n.sinceInteractionMs >= D.NEGLECT_WINDOW_MS) {
      n.sinceInteractionMs -= D.NEGLECT_WINDOW_MS;
      n.neglect = Math.max(D.NEGLECT_FLOOR, n.neglect + D.NEGLECT_STEP);
    }
  }
  // 6 typing (§10.4 predicate over the tick's sample)
  const typingSample = n.inputAgeMs < D.TYPING_INPUT_AGE_MAX_MS && num(e.cursorDeltaDip) < D.TYPING_CURSOR_DELTA_MAX_DIP;
  if (typingSample) { n.typingSamples += 1; n.typingIdleSamples = 0; }
  else { n.typingSamples = 0; n.typingIdleSamples = n.probableTyping ? n.typingIdleSamples + 1 : 0; }   // §3.1: idle samples count only while typing
  if (!n.probableTyping && n.typingSamples >= D.TYPING_ENTER_SAMPLES) {
    n.probableTyping = true; n.typingStreakStartedMono = nowMono - D.TYPING_ENTER_SAMPLES * D.TICK_MS;
    fx.push(ev({ kind: 'typingGlance', tsMain: nowMono }));                           // C-4: cooldown is the adapter's
  } else if (n.probableTyping && n.typingIdleSamples >= D.TYPING_EXIT_SAMPLES) {
    n.probableTyping = false;
    if (nowMono - (n.typingStreakStartedMono ?? nowMono) >= D.TYPING_CHEER_MIN_STREAK_MS) fx.push(ev({ kind: 'cheer', tsMain: nowMono }));
    n.typingStreakStartedMono = null;
  }
  // 8 gate bookkeeping: nothing per tick beyond the local-day reset in applyClock.
  if (Math.floor(nowWall / PERSIST_EVERY_MS) !== Math.floor(s.lastWall / PERSIST_EVERY_MS)) fx.push({ kind: 'persist' });
  return n;
}

function core(s: SimState, e: SimEvent, nowMono: number, nowWall: number, fx: SimEffect[]): SimState {
  switch (e.type) {
    case 'TICK': return applyTick(s, e, nowMono, nowWall, fx);
    case 'USER_INPUT': return applyPresence({ ...s, inputAgeMs: 0 }, nowMono, fx);
    case 'LOCKED': return s.locked ? s : applyPresence({ ...s, locked: true }, nowMono, fx);
    case 'UNLOCKED': { if (!s.locked) return s; fx.push({ kind: 'proactiveEvaluate' }); return applyPresence({ ...s, locked: false }, nowMono, fx); }
    case 'SUSPEND': return s.suspended ? s : applyPresence({ ...s, suspended: true }, nowMono, fx);
    case 'RESUME': { if (!s.suspended) return s; fx.push({ kind: 'proactiveEvaluate' }); return applyPresence({ ...s, suspended: false }, nowMono, fx); }
    case 'FULLSCREEN': { if (s.fullscreen === e.on) return s; if (!e.on) fx.push({ kind: 'proactiveEvaluate' }); return { ...s, fullscreen: e.on }; }
    case 'DND': { if (s.dnd === e.on) return s; if (!e.on) fx.push({ kind: 'proactiveEvaluate' }); return { ...s, dnd: e.on }; }
    case 'USER_HIDDEN': return s.userHidden === e.on ? s : { ...s, userHidden: e.on };
    case 'CHAT_OPEN': { if (!e.on) fx.push({ kind: 'proactiveEvaluate' }); return s; }   // C-6: SimState has no chatOpen field
    case 'BATTERY': {
      const level = e.level === null ? null : clamp(num(e.level), 0, 1);
      const charging = !!e.charging;
      const n: SimState = { ...s, battery: { charging, level } };
      if (charging && !s.battery.charging) { fx.push(ev({ kind: 'onCharger', tsMain: nowMono })); n.batteryLowFired = false; }
      if (!charging && level !== null && level < D.BATTERY_LOW_LEVEL && !s.batteryLowFired) {
        fx.push(ev({ kind: 'batteryLow', tsMain: nowMono })); n.batteryLowFired = true;
      }
      return n;
    }
    case 'TOUCH': {
      const n = e.annoyed ? nudge(s, -0.05, 0.10) : grant(nudge(s, 0.02, 0.03), D.AFFECTION_PER_TOUCH);
      if (e.annoyed) fx.push(ev({ kind: 'annoyed', tsMain: nowMono }));
      return interacted(spend(n, D.ENERGY_PER_TOUCH));
    }
    case 'TURN_DONE': {
      let n = s;
      if (!e.proactive && !e.interrupted) n = grant(n, D.AFFECTION_PER_EXCHANGE);
      if (e.interrupted) n = nudge(n, -0.02, 0);
      fx.push({ kind: 'proactiveEvaluate' });
      return interacted(spend(n, D.ENERGY_PER_EXCHANGE));
    }
    case 'TURN_USER': return interacted({ ...s, gate: { ...s.gate, backoffN: 0, backoffUntilMono: null } });
    case 'EMOTION': { const t = EMOTION_NUDGES[e.emotion]; return t ? nudge(s, t[0], t[1]) : s; }
    case 'LIVELINESS': { const v = clamp(num(e.value, s.liveliness), 0, 1); return v === s.liveliness ? s : { ...s, liveliness: v }; }
    case 'MODE': { if (s.mode === e.mode) return s; if (e.mode === 'character') fx.push({ kind: 'proactiveEvaluate' }); return { ...s, mode: e.mode }; }
    case 'PROACTIVE_MUTE': {
      const untilWall = e.untilWall === null ? null : Math.max(0, num(e.untilWall));
      fx.push({ kind: 'proactiveEvaluate' });
      return untilWall === s.gate.mutedUntilWall ? s : { ...s, gate: { ...s.gate, mutedUntilWall: untilWall } };
    }
    case 'PROACTIVE_RESERVE': return { ...s, gate: { ...s.gate, intent: {
      reservationId: e.reservationId, templateId: e.templateId, bucket: e.bucket,
      reservedMono: nowMono, deferUntilMono: nowMono + D.PROACTIVE_DEFER_MAX_MS } } };
    case 'PROACTIVE_OUTCOME': {
      const it = s.gate.intent;
      if (it === null || it.reservationId !== e.reservationId) return s;
      if (e.outcome !== 'displayed') return { ...s, gate: { ...s.gate, intent: null } };
      const n: SimState = { ...s, gate: { ...s.gate, intent: null, lastDisplayedMono: nowMono, displayedToday: s.gate.displayedToday + 1 } };
      if (it.bucket === 'greeting') n.firedToday = { ...n.firedToday, morningGreeting: true };
      return n;
    }
    case 'PROACTIVE_ANSWERED':
      return interacted(grant({ ...s, gate: { ...s.gate, backoffN: 0, backoffUntilMono: null } }, D.AFFECTION_PER_EXCHANGE));
    case 'PROACTIVE_UNANSWERED': {
      const backoffN = Math.min(8, s.gate.backoffN + 1);
      const draw = backoffDelay(backoffN, s.rngState);
      // §3.7.2's "displayed then unanswered" row. The numbers live in Task 3's mood.ts, so this
      // emits its `proactiveUnanswered` nudge event rather than repeating the literal -0.03.
      const mn = moodNudge({ kind: 'proactiveUnanswered' });
      return nudge({ ...s, rngState: draw.rngState, gate: { ...s.gate, unansweredToday: s.gate.unansweredToday + 1,
        backoffN, backoffUntilMono: nowMono + draw.delayMs } }, mn.dValence, mn.dArousal);
    }
    default: return s;
  }
}

/** Plain-data equality over SimState (every field is a primitive or a nested plain object). */
function sameState(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!sameState((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

export function reduceWithEffects(state: SimState, event: SimEvent, nowMono: number, nowWall: number): ReduceResult {
  const fx: SimEffect[] = [];
  const mono = Math.max(0, num(nowMono, state.lastMono));
  const wall = Math.max(0, num(nowWall, state.lastWall));
  const next = core(state, event, mono, wall, fx);
  const changed = next !== state && !sameState(state, next);
  if (changed) fx.push({ kind: 'snapshotDirty' });
  // Structural sharing (§3.2): a non-tick no-op returns the SAME reference. A tick always stamps
  // its clocks (the next delta depends on it) but is only `snapshotDirty` when something else moved.
  if (!changed && event.type !== 'TICK') return { state, effects: fx };
  return { state: { ...next, lastMono: mono, lastWall: wall }, effects: fx };
}

export const reduce = (state: SimState, event: SimEvent, nowMono: number, nowWall: number): SimState =>
  reduceWithEffects(state, event, nowMono, nowWall).state;
