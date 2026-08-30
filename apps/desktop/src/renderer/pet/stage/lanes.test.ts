import { describe, expect, it } from 'vitest';
import { LANE_TTL_MAX_MS, type LaneResult } from '@ds/protocol';
import { LaneHolder, clampTtl, type LaneRequest } from './lanes';

// `tag: string` (not the inferred `LaneSource` from `= source`) — the brief's verbatim signature
// made tsc reject the 'first'/'second'/'g7'/'g8' tags. See Deviations in the task report.
function cmd(source: LaneRequest<string>['source'], ttlMs: number, log: string[], tag: string = source): LaneRequest<string> {
  return { lane: 'body', source, generation: 0, ttlMs, payload: tag, onResult: (r: LaneResult) => log.push(`${tag}:${r}`) };
}

describe('clampTtl', () => {
  it('clamps into [0, LANE_TTL_MAX_MS] and maps NaN to 0', () => {
    expect(clampTtl(-5)).toBe(0);
    expect(clampTtl(Number.NaN)).toBe(0);
    expect(clampTtl(1_000)).toBe(1_000);
    expect(clampTtl(LANE_TTL_MAX_MS + 1)).toBe(LANE_TTL_MAX_MS);
  });
});

describe('LaneHolder', () => {
  it('stamps a monotonic per-lane generation and an owner-clock deadline', () => {
    const h = new LaneHolder<string>('body');
    const a = h.request(cmd('idle', 500, []), 100)!;
    expect(a.generation).toBe(1);
    expect(a.issuedAt).toBe(100);
    expect(a.deadline).toBe(600);
    expect(h.generation).toBe(1);
    const b = h.request(cmd('idle', 200, []), 150)!;
    expect(b.generation).toBe(2);
    expect(h.current).toBe(b);
  });

  it('clamps the requested ttl to LANE_TTL_MAX_MS', () => {
    const h = new LaneHolder<string>('body');
    const a = h.request(cmd('llm', 500_000, []), 0)!;
    expect(a.ttlMs).toBe(LANE_TTL_MAX_MS);
    expect(a.deadline).toBe(LANE_TTL_MAX_MS);
  });

  it('reports preempted on the displaced lease and expired on tick past the deadline', () => {
    const log: string[] = [];
    const h = new LaneHolder<string>('body');
    h.request(cmd('idle', 1_000, log, 'first'), 0);
    h.request(cmd('touch', 300, log, 'second'), 10);
    expect(log).toEqual(['first:preempted']);
    expect(h.tick(309)).toBeNull();
    const ended = h.tick(310);
    expect(ended?.payload).toBe('second');
    expect(log).toEqual(['first:preempted', 'second:expired']);
    expect(h.current).toBeNull();
  });

  it('runs one terminal result per lease, ever', () => {
    const log: string[] = [];
    const h = new LaneHolder<string>('body');
    const a = h.request(cmd('llm', 1_000, log), 0)!;
    h.end('completed', 50);
    a.onResult('expired');
    a.onResult('cancelled');
    expect(log).toEqual(['llm:completed']);
    expect(h.tick(5_000)).toBeNull();
  });

  it('endIf ignores a stale generation (B-06 class)', () => {
    const log: string[] = [];
    const h = new LaneHolder<string>('body');
    const gen7 = h.request(cmd('llm', 1_000, log, 'g7'), 0)!;
    h.request(cmd('llm', 1_000, log, 'g8'), 10);
    expect(h.endIf(gen7.generation, 'completed', 20)).toBe(false);
    expect(h.current?.payload).toBe('g8');
    expect(h.endIf(h.generation, 'completed', 30)).toBe(true);
    expect(log).toEqual(['g7:preempted', 'g8:completed']);
  });

  it('a refusing policy reports preempted for the incoming command and keeps the holder', () => {
    const log: string[] = [];
    const h = new LaneHolder<string>('body', (incoming, current) => !(current.source === 'touch' && incoming.source === 'llm'));
    h.request(cmd('touch', 1_000, log), 0);
    expect(h.request(cmd('llm', 1_000, log), 5)).toBeNull();
    expect(log).toEqual(['llm:preempted']);
    expect(h.current?.source).toBe('touch');
  });

  it('detach removes the lease without a result; restore re-issues it with its original deadline', () => {
    const log: string[] = [];
    const h = new LaneHolder<string>('expression');
    h.request(cmd('llm', 90_000, log), 0);
    const covered = h.detach()!;
    expect(h.current).toBeNull();
    expect(log).toEqual([]);
    h.request(cmd('touch', 1_400, log), 2_000);
    h.end('preempted', 3_400);
    const restored = h.restore(covered, 3_400)!;
    expect(restored.issuedAt).toBe(0);
    expect(restored.deadline).toBe(90_000);
    expect(restored.generation).toBe(3);
    expect(log).toEqual(['touch:preempted']);
    h.tick(90_000);
    expect(log).toEqual(['touch:preempted', 'llm:expired']);
  });

  it('restore of a lease already past its deadline reports expired and grants nothing', () => {
    const log: string[] = [];
    const h = new LaneHolder<string>('expression');
    h.request(cmd('llm', 1_000, log), 0);
    const covered = h.detach()!;
    expect(h.restore(covered, 1_000)).toBeNull();
    expect(log).toEqual(['llm:expired']);
  });
});
