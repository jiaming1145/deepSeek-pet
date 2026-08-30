// packages/sim/src/fixtures/sim/midnight-caps.fixture.ts — B-10
import { initialSimState } from '../../state.ts';
import { reduce, reduceWithEffects } from '../../reduce.ts';
import { shouldSpeak } from '../../proactive.ts';
import { toPersisted } from '../../snapshot.ts';
import { tickEv } from './presence-299-vs-300.fixture.ts';

export function run() {
  const before = new Date(2026, 8, 1, 23, 59, 59).getTime();
  const after = new Date(2026, 8, 2, 0, 0, 1).getTime();
  let s = reduce(initialSimState(0, before), tickEv(0), 0, before);
  s = { ...s, earnedToday: 5, affection: 5, gate: { ...s.gate, displayedToday: 2, unansweredToday: 3 } };
  const gateBefore = shouldSpeak({ state: s, nowMono: 500, nowWall: before, personaCap: 2, turnActive: false, chatOpen: false, roll: 0 });
  const r = reduceWithEffects(s, tickEv(0), 500, after);
  // inputAgeMs 120 s: the tick's sample was age 0, which layer 4 would report as 'recent-input' — the fixture is about layers 2-3.
  const gateAfter = shouldSpeak({ state: { ...r.state, inputAgeMs: 120_000 }, nowMono: 500, nowWall: after + 61_000, personaCap: 2, turnActive: false, chatOpen: false, roll: 0 });
  return { daysBefore: s.distinctDaysSeen, state: r.state, effects: r.effects, gateBefore, gateAfter, persisted: toPersisted(r.state, 500, after) };
}
