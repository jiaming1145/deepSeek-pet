import type { ClockPhase } from '@ds/protocol';

/**
 * §3.9 — clock phases, local dates and meal jitter. Every function is a pure function of the
 * `nowWall` it is given: `new Date(ms)` is used ONLY as a timezone converter (never the ambient
 * wall clock, never `performance`), which keeps R3-1's "no timers, no ambient clock, no I/O" rule
 * intact. NOTE: the words are deliberately not spelled with a call parenthesis — state.test.ts's
 * §1.2 grep scans this file's text for the forbidden ambient-clock call and a doc comment would
 * trip it.
 */

/** Defaults from SIM_DEFAULTS.PHASE_HOURS; every boundary is configurable through kv `sim_phases`. */
export interface PhaseHours { morning: number; day: number; evening: number; night: number }
export const DEFAULT_PHASE_HOURS: PhaseHours = { morning: 6, day: 11, evening: 18, night: 22 };

/** Mirrors SIM_DEFAULTS.MEAL_JITTER_MAX_MS; state.test.ts asserts equality (phases.ts must not import state.ts, which imports it). */
const MEAL_JITTER_MAX_MS = 1_800_000;

/** phaseOf(h, hours): morning [6,11) | day [11,18) | evening [18,22) | night [22,24)+[0,6) */
export function phaseOf(localHour: number, hours: PhaseHours = DEFAULT_PHASE_HOURS): ClockPhase {
  if (localHour >= hours.night || localHour < hours.morning) return 'night';
  if (localHour < hours.day) return 'morning';
  if (localHour < hours.evening) return 'day';
  return 'evening';
}

/** Local hour as a float in [0, 24), from `nowWall`. The one converter energy and phases share. */
export function localHour(nowWall: number): number {
  const d = new Date(nowWall);
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 + d.getMilliseconds() / 3_600_000;
}

/** 'YYYY-MM-DD' in LOCAL time. The only day key in the system (R3-7's "local day"). */
export function localDateString(nowWall: number): string {
  const d = new Date(nowWall);
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Epoch ms of the next LOCAL midnight after `nowWall`. Used twice by §3.10.2's gate. DST-safe: setHours(24) rolls the date. */
export function nextLocalMidnight(nowWall: number): number {
  const d = new Date(nowWall);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/** FNV-1a 32-bit over the UTF-16 code units of `s`. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic per-day jitter in [-MEAL_JITTER_MAX_MS, +MEAL_JITTER_MAX_MS] from FNV-1a(date+meal). */
export function mealJitter(localDate: string, meal: 'breakfast' | 'lunch' | 'dinner'): number {
  const u = fnv1a32(`${localDate}:${meal}`) / 4294967296; // [0, 1)
  return Math.round((u * 2 - 1) * MEAL_JITTER_MAX_MS);
}
