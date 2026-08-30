// packages/sim/src/fixtures/sim/presence-299-vs-300.fixture.ts — B-01
import type { SimEventPayload } from '@ds/protocol';
import { initialSimState } from '../../state.ts';
import { reduce, reduceWithEffects } from '../../reduce.ts';
import type { SimEvent } from '../../events.ts';
import { toPersisted } from '../../snapshot.ts';

export const T0 = new Date(2026, 8, 1, 14, 0, 0).getTime();
export const tickEv = (inputAgeMs: number): SimEvent =>
  ({ type: 'TICK', inputAgeMs, cursorDeltaDip: 50, cursorNear: false, onFloor: true, nearEdge: false });

export function run() {
  const s0 = reduce(initialSimState(0, T0), tickEv(0), 0, T0);
  const a = reduceWithEffects(s0, tickEv(299_900), 500, T0 + 500);
  const b = reduceWithEffects(a.state, tickEv(300_000), 1_000, T0 + 1_000);
  const c = reduceWithEffects(b.state, { type: 'USER_INPUT' }, 1_400, T0 + 1_400);   // input observed < 1 000 ms after the nap began
  return { presences: [a.state.presence, b.state.presence, c.state.presence] as const,
    modes: [a.state.presentationMode, b.state.presentationMode, c.state.presentationMode] as const,
    effects: c.effects, returnedLatencyMs: 1_400 - 1_000,
    affectionBefore: a.state.affection,               // after the first PRESENT tick's new-day grant; s0 itself ticked with delta 0
    state: c.state, persisted: toPersisted(c.state, 1_400, T0 + 1_400) };
}
export const expected = { presences: ['active', 'idle-present', 'active'], modes: ['awake', 'nap', 'awake'],
  returned: { kind: 'returned', tsMain: 1_400, awayMs: 400 } satisfies SimEventPayload, maxLatencyMs: 1_000 };
