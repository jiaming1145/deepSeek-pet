import { describe, expect, it } from 'vitest';
import type { LaneResult } from '@ds/protocol';
import type { ConditionFacts, Selection } from '@ds/behaviors';
import { BehaviourRunner, CONDITION_POLL_MS } from './behaviour-runner';
import { Arbiter, type ArbTraceRecord, type ArbiterPorts, type BehaviourCommand } from './arbiter';

const facts: ConditionFacts = {
  phase: 'day', present: true, presentation: 'awake', liveliness: 0.3, mood: 0.1, energy: 60,
  onFloor: true, nearEdge: false, cursorNear: false, userIdleS: 3, affection: 5, probableTyping: false,
};

function selection(id: string, now: number): Selection {
  return {
    behavior: { id, weight: 1, minMs: 5000, maxMs: 8000, cooldownMs: 0, minLiveliness: 0, motion: ['Idle', 0], expression: null,
      expressionWeight: 0.55, gaze: 'follow', overlay: 'none', locomotion: null, tags: [] } as Selection['behavior'],
    durationMs: 6000, nextDecisionAt: now + 14_000, trace: { eligible: [id, 'other'], weights: [1, 1], seed: 42 },
  };
}

function harness(opts: { grant?: boolean; mayTake?: boolean } = {}) {
  let now = 0;
  const log: string[] = [];
  const traces: unknown[] = [];
  let listener: ((id: string, result: LaneResult) => void) | null = null;
  let nextId = 'a';
  const selector = {
    update: () => { log.push('update'); },
    select: (_f: ConditionFacts, n: number) => { log.push(`select@${n}`); return nextId ? selection(nextId, n) : null; },
    finish: (id: string, n: number, r: LaneResult) => { log.push(`finish:${id}:${r}@${n}`); },
    setLivelinessMap: () => {},
  };
  const arbiter = {
    behaviour: (cmd: BehaviourCommand) => { log.push(`behaviour:${cmd.id}:${cmd.durationMs}`); return opts.grant ?? true; },
    onBehaviourResult: (cb: (id: string, result: LaneResult) => void) => { listener = cb; },
    mayTake: () => opts.mayTake ?? true,
  };
  const runner = new BehaviourRunner({ selector, arbiter, facts: () => facts, now: () => now, trace: (r) => traces.push(r) });
  return { runner, log, traces, set now(v: number) { now = v; }, setNext: (id: string) => { nextId = id; }, end: (id: string, r: LaneResult) => listener!(id, r) };
}

describe('BehaviourRunner (§5.3)', () => {
  it('exports the 1 Hz re-poll constant', () => { expect(CONDITION_POLL_MS).toBe(1_000); });

  it('selects on the first update, requests the three lanes with ttl = durationMs, and traces behaviourStart', () => {
    const h = harness();
    h.runner.update();
    expect(h.log).toEqual(['update', 'select@0', 'behaviour:a:6000']);
    expect(h.traces[0]).toMatchObject({ kind: 'behaviourStart', id: 'a', durationMs: 6000, eligible: ['a', 'other'], weights: [1, 1], seed: 42, bagSize: 2, lane: null, source: null, generation: null, result: null, value: null });
    expect(h.runner.current()).toBe('a');
  });

  it('never re-selects between boundaries: the 1 Hz update only re-polls conditions', () => {
    const h = harness();
    h.runner.update();
    h.now = 1000; h.runner.update();
    h.now = 5000; h.runner.update();
    expect(h.log.filter((l) => l.startsWith('select'))).toHaveLength(1);
    expect(h.log.filter((l) => l === 'update')).toHaveLength(3);
  });

  it('re-decides at a body-lane result and at nextDecisionAt, whichever comes first', () => {
    const h = harness();
    h.runner.update();
    h.setNext('b');
    h.now = 6000; h.end('a', 'expired');
    expect(h.log.at(-3)).toBe('finish:a:expired@6000');
    expect(h.log.at(-1)).toBe('behaviour:b:6000');
    expect(h.traces.at(-2)).toMatchObject({ kind: 'behaviourEnd', id: 'a', result: 'expired' });
    h.setNext('c');
    h.now = 6000 + 14_000; h.runner.update();
    expect(h.log.at(-1)).toBe('behaviour:c:6000');
  });

  it('holds when the arbiter refuses (llm/touch live) and when the selector returns null', () => {
    const h = harness({ grant: false });
    h.runner.update();
    expect(h.runner.current()).toBeNull();
    expect(h.traces).toHaveLength(0);
    expect(h.log.at(-1)).toBe('behaviour:a:6000');
    h.now = 1000; h.runner.update();
    expect(h.log.filter((l) => l.startsWith('select'))).toHaveLength(2);
    h.setNext('');
    h.now = 2000; h.runner.update();
    expect(h.log.at(-1)).toBe('select@2000');
  });

  it('never draws a Selection the arbiter would refuse (fix round 2, finding 3)', () => {
    // `select()` mutates the selector (cooldown, `lastStartedAt`, the 3-slot recency list), so a draw
    // the arbiter then refuses is not free: it is a burnt cooldown for a behaviour that never played.
    const h = harness({ mayTake: false });
    h.runner.update();
    h.now = 1000; h.runner.update();
    expect(h.log).toEqual(['update', 'update']);
    expect(h.log.some((l) => l.startsWith('select'))).toBe(false);
    expect(h.runner.current()).toBeNull();
  });

  it('setFrozen(true) stops selection without ending the current behaviour (D7)', () => {
    const h = harness();
    h.runner.update();
    h.runner.setFrozen(true);
    h.setNext('b');
    h.now = 6000; h.end('a', 'expired');
    expect(h.log.at(-1)).toBe('finish:a:expired@6000');
    expect(h.runner.current()).toBeNull();
    h.runner.setFrozen(false);
    expect(h.log.at(-1)).toBe('behaviour:b:6000');
  });
});

describe('BehaviourRunner + the REAL Arbiter (fix round 1, finding 1)', () => {
  /** Everything the arbiter needs and nothing this seam cares about. */
  function realArbiter() {
    let now = 0;
    const ports: ArbiterPorts = {
      now: () => now, schedule: () => {}, trace: () => {},
      motion: { startMotionForced: () => true },
      expression: { setExpression: () => {}, setExpressionWeight: () => {} },
      gaze: { apply: () => {}, release: () => {} },
      overlay: { set: () => {} },
      blink: { force: () => {}, setSleepy: () => {} },
    };
    const arbiter = new Arbiter(ports);
    return { arbiter, at: (t: number) => { now = t; return t; } };
  }

  it('a tap (dragStart) ends the running behaviour and the runner picks a new one at the next boundary', () => {
    // main.ts calls arbiter.dragStart() on EVERY arb:grab. Before the fix the runner never heard, so
    // `current()` reported a behaviour with an empty body lane and no re-selection happened until
    // `nextDecisionAt` — verified in the browser: `look_around` with all three lanes null for 7 s.
    const { arbiter, at } = realArbiter();
    const log: string[] = [];
    let nextId = 'a';
    const runner = new BehaviourRunner({
      selector: {
        update: () => {},
        select: (_f: ConditionFacts, n: number) => (nextId ? selection(nextId, n) : null),
        finish: (id, _n, r) => log.push(`finish:${id}:${r}`),
      },
      arbiter, facts: () => facts, now: () => at(0), trace: () => {},
    });
    runner.update();
    expect(runner.current()).toBe('a');
    expect(arbiter.lanes().find((l) => l.lane === 'body')).toMatchObject({ source: 'behaviour' });

    nextId = 'b';
    arbiter.dragStart(at(2_000));
    expect(log).toEqual(['finish:a:preempted']);      // the selector's recency/cooldown stay honest
    expect(runner.current()).toBeNull();              // ... and `__stage.behaviour()` no longer lies
    expect(arbiter.lanes().find((l) => l.lane === 'body')).toMatchObject({ source: 'drag' });

    arbiter.dragEnd(at(2_100));
    runner.update();                                  // the next 1 Hz poll, a full 12 s before nextDecisionAt
    expect(runner.current()).toBe('b');
    expect(arbiter.lanes().find((l) => l.lane === 'body')).toMatchObject({ source: 'behaviour' });
  });
});

describe('BehaviourRunner + the REAL Arbiter (fix round 2, finding 1)', () => {
  /** A behaviour whose body lease OUTLIVES its own `nextDecisionAt` — the shipped default: the
   *  selector clamps `nextDecisionAt` to now + DENSITY_MAX_PERIOD_MS (14 s) at liveliness >= 0.30,
   *  while the body ttl is the drawn duration, and Haru's `idle_breathe` draws 8-16 s. */
  function longSelection(id: string, index: number, now: number): Selection {
    return {
      behavior: { id, weight: 1, minMs: 20_000, maxMs: 20_000, cooldownMs: 0, minLiveliness: 0,
        motion: ['Idle', index], expression: `E_${id}`, expressionWeight: 0.55, gaze: 'follow',
        overlay: 'none', locomotion: null, tags: [] } as Selection['behavior'],
      durationMs: 20_000, nextDecisionAt: now + 14_000, trace: { eligible: [id], weights: [1], seed: 1 },
    };
  }

  it('re-deciding while the body lease is still live swaps ONE behaviour on all three lanes', () => {
    // Pre-fix this produced body `Idle_2` (a third behaviour) over expression/gaze `E_b`, with
    // `runner.current()` still reporting `b` and three `behaviourStart` records for one boundary.
    let now = 0;
    const calls: string[] = [];
    const traces: ArbTraceRecord[] = [];
    const ports: ArbiterPorts = {
      now: () => now, schedule: () => {}, trace: (r) => traces.push(r),
      motion: { startMotionForced: (g, i) => { calls.push(`body:${g}_${i}`); return true; } },
      expression: { setExpression: (n) => { calls.push(`expr:${n}`); }, setExpressionWeight: () => {} },
      gaze: { apply: (t) => { calls.push(`gaze:${t.kind === 'pattern' ? t.pattern : t.kind}`); }, release: () => {} },
      overlay: { set: () => {} },
      blink: { force: () => {}, setSleepy: () => {} },
    };
    const arbiter = new Arbiter(ports);
    let n = 0;
    const runner = new BehaviourRunner({
      selector: {
        update: () => {},
        select: (_f: ConditionFacts, at: number) => longSelection(String.fromCharCode(97 + n), n++, at),
        finish: () => {},
      },
      arbiter, facts: () => facts, now: () => now, trace: (r) => traces.push(r as ArbTraceRecord),
    });

    runner.update();                       // t=0: `a`, body ttl 20 000, nextDecisionAt 14 000
    now = 14_000;
    arbiter.update(now);                   // `a`'s body lease is STILL live here
    runner.update();                       // the 1 Hz poll at the boundary

    expect(traces.filter((t) => t.kind === 'behaviourStart').map((t) => t.id)).toEqual(['a', 'b']);
    expect(traces.filter((t) => t.kind === 'behaviourEnd').map((t) => `${t.id}:${t.result}`)).toEqual(['a:preempted']);
    expect(runner.current()).toBe('b');
    expect(calls.filter((c) => c.startsWith('body:')).at(-1)).toBe('body:Idle_1');
    expect(calls.filter((c) => c.startsWith('expr:')).at(-1)).toBe('expr:E_b');
    expect(calls.filter((c) => c.startsWith('gaze:')).at(-1)).toBe('gaze:follow');
    // Every lane grant of the second boundary belongs to `b`, and nothing else was drawn.
    expect(traces.filter((t) => t.kind === 'laneGrant' && t.source === 'behaviour').slice(-3).map((t) => t.id))
      .toEqual(['Idle_1', 'E_b', 'follow']);
    expect(n).toBe(2);
    // No `behaviourEnd` may precede its own `behaviourStart` (§12.2 / D16).
    for (const [i, rec] of traces.entries()) {
      if (rec.kind !== 'behaviourEnd') continue;
      const start = traces.findIndex((t) => t.kind === 'behaviourStart' && t.id === rec.id);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(start).toBeLessThan(i);
    }
  });
});
