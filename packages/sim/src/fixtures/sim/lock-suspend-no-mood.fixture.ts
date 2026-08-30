// packages/sim/src/fixtures/sim/lock-suspend-no-mood.fixture.ts — B-02
import { initialSimState, SIM_DEFAULTS } from '../../state.ts';
import { reduce, reduceWithEffects } from '../../reduce.ts';
import type { SimEffect, SimEvent } from '../../events.ts';
import { toPersisted } from '../../snapshot.ts';
import { tickEv } from './presence-299-vs-300.fixture.ts';

const H3 = 3 * 3_600_000;
/** 11:00:05 local: both 3-h gaps stay inside phase 'day' (11:00-17:59), so no phaseChanged can leak into the effect list. */
const T0 = new Date(2026, 8, 1, 11, 0, 5).getTime();
export function run() {
  let s = reduce(initialSimState(0, T0), tickEv(0), 0, T0);
  s = { ...s, valence: 0.55, arousal: 0.7, neglect: -0.05, expenditure: 3, affection: 4, earnedToday: 4,
    firedToday: { morningGreeting: true, nightEntry: false, breakfast: true, lunch: true, dinner: true } };   // no meal cue during the gaps
  const fx: SimEffect[] = [];
  const gap = (s0: typeof s, enter: SimEvent, leave: SimEvent, mono0: number) => {
    let r = reduceWithEffects(s0, enter, mono0, T0 + mono0); fx.push(...r.effects);
    const frozen = { valence: r.state.valence, arousal: r.state.arousal };
    for (let m = mono0 + 500; m <= mono0 + H3; m += 500) { r = reduceWithEffects(r.state, tickEv(m - mono0), m, T0 + m); fx.push(...r.effects); }
    const during = { valence: r.state.valence, arousal: r.state.arousal };
    r = reduceWithEffects(r.state, leave, mono0 + H3 + 100, T0 + mono0 + H3 + 100); fx.push(...r.effects);
    r = reduceWithEffects(r.state, { type: 'USER_INPUT' }, mono0 + H3 + 200, T0 + mono0 + H3 + 200); fx.push(...r.effects);
    return { state: r.state, frozen, during };
  };
  const lock = gap(s, { type: 'LOCKED' }, { type: 'UNLOCKED' }, 1_000);
  const susp = gap(lock.state, { type: 'SUSPEND' }, { type: 'RESUME' }, 1_000 + H3 + 1_000);
  const simEventKinds = fx.filter(f => f.kind === 'simEvent').map(f => (f as { payload: { kind: string } }).payload.kind);
  return { start: s, lock, susp, simEventKinds, state: susp.state, persisted: toPersisted(susp.state, 2 * H3 + 3_000, T0 + 2 * H3 + 3_000) };
}
export const expected = { settle: SIM_DEFAULTS.RETURN_SETTLE_FRACTION, simEventKinds: ['returned', 'returned'] };
