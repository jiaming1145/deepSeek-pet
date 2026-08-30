import { describe, expect, it } from 'vitest';
import type { LaneResult } from '@ds/protocol';
import type { ConditionFacts, Selection } from '@ds/behaviors';
import { BehaviourRunner, CONDITION_POLL_MS } from './behaviour-runner';
import type { BehaviourCommand } from './arbiter';

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

function harness(opts: { grant?: boolean } = {}) {
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
