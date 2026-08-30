import { describe, expect, it } from 'vitest';
import { SIM_EVENT_TYPES, type SimEvent, type SimEffect } from './events.ts';

describe('§3.2 SimEvent union', () => {
  it('lists every §3.2 event type exactly once, plus the C-1 gap event', () => {
    expect([...SIM_EVENT_TYPES]).toEqual([
      'TICK', 'USER_INPUT', 'LOCKED', 'UNLOCKED', 'SUSPEND', 'RESUME', 'FULLSCREEN', 'DND',
      'USER_HIDDEN', 'BATTERY', 'TOUCH', 'CHAT_OPEN', 'TURN_DONE', 'TURN_USER', 'EMOTION',
      'LIVELINESS', 'MODE', 'PROACTIVE_MUTE', 'PROACTIVE_RESERVE', 'PROACTIVE_OUTCOME',
      'PROACTIVE_ANSWERED', 'PROACTIVE_UNANSWERED',
    ]);
    expect(new Set(SIM_EVENT_TYPES).size).toBe(SIM_EVENT_TYPES.length);
  });
  it('types are erasable: a literal of each shape is assignable', () => {
    const evs: SimEvent[] = [
      { type: 'TICK', inputAgeMs: 0, cursorDeltaDip: 0, cursorNear: false, onFloor: true, nearEdge: false },
      { type: 'TOUCH', part: 'head', annoyed: false },
      { type: 'PROACTIVE_OUTCOME', reservationId: 'r', outcome: 'displayed' },
    ];
    const fx: SimEffect[] = [{ kind: 'snapshotDirty' }, { kind: 'persist' }, { kind: 'proactiveEvaluate' }];
    // The type annotations are the tsc half; these are the runtime half, so the case can actually
    // fail in the vitest lane (which does not typecheck) if a discriminant is renamed.
    expect(evs.map(e => e.type)).toEqual(['TICK', 'TOUCH', 'PROACTIVE_OUTCOME']);
    expect(fx.map(f => f.kind)).toEqual(['snapshotDirty', 'persist', 'proactiveEvaluate']);
    for (const e of evs) expect(SIM_EVENT_TYPES).toContain(e.type);
  });
});
