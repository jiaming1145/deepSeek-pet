// packages/sim/src/fixtures/sim/clock-rollback-dst.fixture.ts — B-03
import { initialSimState, type SimState } from '../../state.ts';
import { reduceWithEffects } from '../../reduce.ts';
import type { SimEffect } from '../../events.ts';
import { tickEv } from './presence-299-vs-300.fixture.ts';

const H = 3_600_000;
export function run() {
  const start = new Date(2026, 8, 1, 18, 30, 0).getTime();      // evening, dinner window (19:00 +/- 30) ahead
  let s: SimState = { ...initialSimState(0, start), mealJitterMs: { breakfast: 0, lunch: 0, dinner: 0 } };
  s = { ...s, gate: { ...s.gate, displayedToday: 2 } };
  const log: { wall: number; phase: string; fx: SimEffect[]; date: string; displayed: number }[] = [];
  let mono = 0;
  const step = (wall: number) => { mono += 500; const r = reduceWithEffects(s, tickEv(0), mono, wall); s = r.state;
    log.push({ wall, phase: s.phase, fx: r.effects, date: s.localDate, displayed: s.gate.displayedToday }); };
  step(start);
  step(start + H);                     // DST forward: 19:30 -> dinner cue window passed? (19:00..19:20) -> skipped, marked fired
  step(start + H - H);                 // DST back: 18:30 again, same localDate -> no re-arm
  step(start + 2 * H);                 // 20:30
  step(start + 4 * H);                 // 22:30 -> phase night
  step(start + 4 * H - 26 * H);        // manual -26 h rollback: previous day 20:30 -> localDate changes, one-shots re-armed ONCE
  step(start + 4 * H - 26 * H + 500);
  step(start + 4 * H);                 // forward again to the original day: counters NOT reset (lastCountedDate rule) — see Concern C-7
  return { log, state: s };
}

/**
 * B-03, second leg: a wall-clock OSCILLATION across one phase boundary inside a single `localDate`
 * (an NTP correction, a DST-back nudge or a manual set). §3.9: "`phaseChanged` and `mealCue` effects
 * fire at most once per `localDate` per marker" — so the night marker must fire exactly once even
 * though the boundary is crossed forward twice.
 */
export function runNightOscillation() {
  const at = (h: number, m: number, sec: number) => new Date(2026, 8, 1, h, m, sec).getTime();
  let s: SimState = { ...initialSimState(0, at(21, 59, 0)), mealJitterMs: { breakfast: 0, lunch: 0, dinner: 0 } };
  const phaseChanged: string[] = [];
  const dates = new Set<string>([s.localDate]);
  let mono = 0;
  for (const wall of [at(21, 59, 0), at(22, 0, 1), at(21, 59, 59), at(22, 0, 2)]) {
    mono += 500;
    const r = reduceWithEffects(s, tickEv(0), mono, wall);
    s = r.state;
    dates.add(s.localDate);
    for (const f of r.effects)
      if (f.kind === 'simEvent' && f.payload.kind === 'phaseChanged') phaseChanged.push(String(f.payload.phase));
  }
  return { phaseChanged, dates, phase: s.phase, nightEntry: s.firedToday.nightEntry };
}
