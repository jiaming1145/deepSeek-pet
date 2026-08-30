import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { WeightedShuffleBag } from './bag.ts';
import { bindResources, type BoundPack } from './bind.ts';
import type { ConditionFacts } from './conditions.ts';
import { BehaviorSchema, parseBehaviorPack, type Behavior } from './schema.ts';
import {
  BehaviorSelector, DENSITY_GUARD_MIN_LIVELINESS, DENSITY_MAX_PERIOD_MS, DENSITY_MIN_STARTS, DENSITY_WINDOW_MS,
  RECENCY_LENGTH, type LivelinessMap,
} from './selector.ts';
import { HARU_CATALOGUE, mapAt, mulberry32 } from './test-util.ts';

// mapAt's inferred shape must be assignable to the selector's structural LivelinessMap.
const _shape: LivelinessMap = mapAt(0);
void _shape;
const FACTS: ConditionFacts = {
  phase: 'day', present: true, presentation: 'awake', liveliness: 0.30, mood: 0.1, energy: 60,
  onFloor: true, nearEdge: false, cursorNear: false, userIdleS: 30, affection: 20, probableTyping: false,
};
const b = (patch: Partial<Behavior> & { id: string }): Behavior =>
  BehaviorSchema.parse({ weight: 1, minMs: 5000, maxMs: 9000, ...patch });
const packOf = (behaviors: Behavior[]): BoundPack => ({ character: 'test', behaviors, dropped: [], warnings: [] });
/** rng that replays a script, then repeats its last value. */
const scripted = (vals: number[]) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)] as number; };

describe('constants (§4.6)', () => {
  it('pins the density guard', () => {
    expect(DENSITY_WINDOW_MS).toBe(60_000); expect(DENSITY_MIN_STARTS).toBe(4);
    expect(DENSITY_GUARD_MIN_LIVELINESS).toBe(0.30); expect(DENSITY_MAX_PERIOD_MS).toBe(14_000);
    expect(RECENCY_LENGTH).toBe(3);
  });
});

describe('BehaviorSelector', () => {
  it('excludes the last 3 started ids (recency) and cooled-down ids', () => {
    const pack = packOf([b({ id: 'a1' }), b({ id: 'a2' }), b({ id: 'a3' }), b({ id: 'a4' }), b({ id: 'c1', cooldownMs: 30_000 })]);
    const sel = new BehaviorSelector({ pack, rng: mulberry32(5), map: mapAt(0.3) });
    const started: string[] = [];
    for (let t = 0; t < 10; t++) {
      const s = sel.select(FACTS, t * 20_000);
      expect(s).not.toBeNull();
      const id = s!.behavior.id;
      expect(started.slice(-RECENCY_LENGTH)).not.toContain(id);
      for (const r of started.slice(-RECENCY_LENGTH)) expect(s!.trace.eligible, `t=${t}`).not.toContain(r);
      started.push(id);
      sel.finish(id, t * 20_000 + s!.durationMs, 'completed');
    }
    expect(new Set(started).size).toBeGreaterThanOrEqual(4);
  });
  it('cooldown is measured from the behaviour\'s own last START, not its finish', () => {
    // The pack is large enough that recency rotates past `only` while it cools, so the boundary is
    // observable on trace.eligible: excluded at 24 000 (start + cooldown = 30 000 not yet reached),
    // admitted at 30 000. Stamping the cooldown in finish() (6000 + 30 000) or dropping cooldowns
    // altogether each break one of the two assertions. Fix round 2, finding 1.
    const pack = packOf([b({ id: 'only', cooldownMs: 30_000 }), b({ id: 's1' }), b({ id: 's2' }), b({ id: 's3' }), b({ id: 's4' })]);
    const sel = new BehaviorSelector({ pack, rng: scripted([0]), map: mapAt(0.3) });
    expect(sel.select(FACTS, 0)!.behavior.id).toBe('only');
    sel.finish('only', 6000, 'completed');
    for (const t of [6000, 12_000, 18_000]) sel.select(FACTS, t);
    expect(sel.select(FACTS, 24_000)!.trace.eligible).not.toContain('only');
    expect(sel.select(FACTS, 30_000)!.trace.eligible).toContain('only');
  });
  it('holds rather than repeat the id just started, even once it has cooled (D1)', () => {
    const pack = packOf([b({ id: 'only', cooldownMs: 30_000 })]);
    const sel = new BehaviorSelector({ pack, rng: mulberry32(1), map: mapAt(0.3) });
    expect(sel.select(FACTS, 0)!.behavior.id).toBe('only');
    sel.finish('only', 6000, 'completed');
    expect(sel.select(FACTS, 10_000)).toBeNull();
    expect(sel.select(FACTS, 29_999)).toBeNull();
    // Cooled at 30 000 — but `only` is also the id just started, and the LRU fallback relaxes the
    // recency exclusion WITHOUT ever repeating the last id (D1). With nothing else base-eligible
    // the selector holds instead (§4.4's last rule). Fix round 1, finding 3.
    expect(sel.select(FACTS, 30_000)).toBeNull();
  });
  it('a cooled-down behaviour is re-admitted as soon as one other behaviour has run', () => {
    const pack = packOf([b({ id: 'cooled', cooldownMs: 30_000 }), b({ id: 'filler' })]);
    const sel = new BehaviorSelector({ pack, rng: mulberry32(1), map: mapAt(0.3) });
    const ids = [0, 15_000, 31_000, 46_000].map((t) => sel.select(FACTS, t)!.behavior.id);
    expect(new Set(ids).size).toBe(2);                       // the fallback still fills gaps
    for (let i = 1; i < ids.length; i++) expect(ids[i], `step ${i}`).not.toBe(ids[i - 1]);
  });
  it('LRU fallback relaxes ONLY recency and never repeats the last id', () => {
    const pack = packOf([b({ id: 'p1' }), b({ id: 'q1' }), b({ id: 'gated', when: { fact: 'phase', eq: 'night' } })]);
    const sel = new BehaviorSelector({ pack, rng: mulberry32(9), map: mapAt(0.3) });
    let prev: string | null = null;
    for (let t = 0; t < 20; t++) {
      const s = sel.select(FACTS, t * 15_000)!;
      expect(s.behavior.id).not.toBe('gated');
      expect(s.behavior.id).not.toBe(prev);
      prev = s.behavior.id;
    }
  });
  it('returns null when every behaviour is gated by conditions, minLiveliness or cooldown', () => {
    const pack = packOf([b({ id: 'n1', when: { fact: 'phase', eq: 'night' } }), b({ id: 'n2', minLiveliness: 0.5 }), b({ id: 'n3', cooldownMs: 60_000 })]);
    const sel = new BehaviorSelector({ pack, rng: mulberry32(1), map: mapAt(0.3) });
    expect(sel.select(FACTS, 0)!.behavior.id).toBe('n3');
    expect(sel.select(FACTS, 1000)).toBeNull();
    expect(sel.select({ ...FACTS, liveliness: 0.5 }, 2000)!.behavior.id).toBe('n2');
  });
  it('locomotion entries need the per-decision roll', () => {
    const pack = packOf([b({ id: 'walk', locomotion: 'stroll' })]);
    const never = new BehaviorSelector({ pack, rng: scripted([0.5]), map: { ...mapAt(0.3), locomotionProbability: 0 } });
    expect(never.select(FACTS, 0)).toBeNull();
    const always = new BehaviorSelector({ pack, rng: scripted([0.5]), map: { ...mapAt(0.3), locomotionProbability: 1 } });
    expect(always.select(FACTS, 0)!.behavior.id).toBe('walk');
  });
  it('multiplies `big` weights by map.highEnergyWeight and reports them in trace.weights', () => {
    const pack = packOf([b({ id: 'small', weight: 1 }), b({ id: 'large1', weight: 1, tags: ['big'] }), b({ id: 'large2', weight: 2, tags: ['big'] })]);
    const sel = new BehaviorSelector({ pack, rng: mulberry32(2), map: mapAt(0.7) });
    const s = sel.select(FACTS, 0)!;
    expect(s.trace.eligible).toEqual(['small', 'large1', 'large2']);
    expect(s.trace.weights[0]).toBe(1);
    expect(s.trace.weights[1]).toBeCloseTo(1.55, 10);
    expect(s.trace.weights[2]).toBeCloseTo(3.10, 10);
    expect(Number.isInteger(s.trace.seed)).toBe(true);
    sel.setLivelinessMap(mapAt(0));
    sel.finish(s.behavior.id, 5000, 'completed');
    const s2 = sel.select(FACTS, 40_000)!;
    const bigs = s2.trace.eligible.map((id, i) => [id, s2.trace.weights[i]] as const).filter(([id]) => id.startsWith('large'));
    expect(bigs.length).toBeGreaterThanOrEqual(1);
    for (const [id, w] of bigs) expect(w, id).toBe(id === 'large1' ? 0.5 : 1);
  });
  it('durations are uniform in [minMs, maxMs] and clamped to [5000, 20000]', () => {
    const pack = packOf([b({ id: 'd1', minMs: 7000, maxMs: 13_000 }), b({ id: 'e1', minMs: 7000, maxMs: 13_000 })]);
    const sel = new BehaviorSelector({ pack, rng: mulberry32(3), map: mapAt(0.3) });
    for (let t = 0; t < 200; t++) {
      const s = sel.select(FACTS, t * 20_000)!;
      expect(s.durationMs).toBeGreaterThanOrEqual(7000); expect(s.durationMs).toBeLessThanOrEqual(13_000);
      expect(Number.isInteger(s.durationMs)).toBe(true);
    }
  });
  it('density guard clamps nextDecisionAt to start + 14 000 only at L >= 0.30', () => {
    const pack = packOf([b({ id: 'x1', minMs: 20_000, maxMs: 20_000 }), b({ id: 'y1', minMs: 20_000, maxMs: 20_000 })]);
    const on = new BehaviorSelector({ pack, rng: mulberry32(4), map: mapAt(0.30) });
    expect(on.select({ ...FACTS, liveliness: 0.30 }, 1000)!.nextDecisionAt).toBe(1000 + DENSITY_MAX_PERIOD_MS);
    const off = new BehaviorSelector({ pack, rng: mulberry32(4), map: { ...mapAt(0.15), idleGapMs: 10_000 } });
    expect(off.select({ ...FACTS, liveliness: 0.15 }, 1000)!.nextDecisionAt).toBe(21_000);   // max(20000, ≤12500) unclamped
  });
  it('update() only refills the bag when the eligible set changes', () => {
    const pack = packOf([b({ id: 'u1' }), b({ id: 'u2' }), b({ id: 'u3', when: { fact: 'cursorNear', eq: true } })]);
    const calls: number[] = [];
    const rng = () => { calls.push(1); return 0.5; };
    const sel = new BehaviorSelector({ pack, rng, map: mapAt(0.3) });
    sel.update(FACTS, 0); const n1 = calls.length;
    sel.update(FACTS, 1000); expect(calls.length).toBe(n1);          // same set → no rng consumed
    sel.update({ ...FACTS, cursorNear: true }, 2000); expect(calls.length).toBeGreaterThan(n1);
  });
  it('keeps ONE deck across decisions — the bag is not rebuilt because recency rotated', () => {
    // Fix round 1, finding 1: the bag used to be keyed on the recency-filtered list, which changes
    // at every decision, so refill() ran before every draw and the deck never dealt past position 0.
    // Deck = 5 ids x round(1 * 4) = 20 cards; 30 decisions consume 30 allowed cards plus the cards
    // skipped for the <= 3 recent ids, so the only refills possible are the initial fill and the
    // ones draw() itself does when the deck runs out.
    const pack = packOf([b({ id: 'k1' }), b({ id: 'k2' }), b({ id: 'k3' }), b({ id: 'k4' }), b({ id: 'k5' })]);
    const spy = vi.spyOn(WeightedShuffleBag.prototype, 'refill');
    try {
      const sel = new BehaviorSelector({ pack, rng: mulberry32(6), map: mapAt(0.3) });
      const ids: string[] = [];
      for (let t = 0; t < 30; t++) {
        const s = sel.select(FACTS, t * 20_000)!;
        expect(s, `t=${t}`).not.toBeNull();
        ids.push(s.behavior.id);
        sel.finish(s.behavior.id, t * 20_000 + s.durationMs, 'completed');
      }
      expect(new Set(ids).size).toBe(5);
      // Measured: 3 refills for 30 decisions (~75 draws over a 20-card deck). Before the fix this
      // was one refill per decision. The bound is loose on purpose — the claim is "far fewer than
      // one per decision", not an exact deal order.
      expect(spy.mock.calls.length, 'refills per 30 decisions').toBeLessThanOrEqual(6);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('10-minute seeded simulation at L = 0.30 on the committed Haru pack (§4.6)', () => {
  const loadHaru = (): BoundPack => bindResources(parseBehaviorPack(JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../characters/haru/behaviors.json', import.meta.url)), 'utf8'))), HARU_CATALOGUE);
  for (const seed of [1, 7, 42]) {
    it(`seed ${seed}: >= 4 starts per rolling 60 s, no consecutive repeat, durations in [5000, 20000]`, () => {
      const sel = new BehaviorSelector({ pack: loadHaru(), rng: mulberry32(seed), map: mapAt(0.30) });
      const starts: { t: number; id: string }[] = [];
      let t = 0;
      while (t < 600_000) {
        sel.update(FACTS, t);
        const s = sel.select(FACTS, t);
        expect(s, `t=${t}`).not.toBeNull();
        const id = s!.behavior.id;
        expect(s!.durationMs).toBeGreaterThanOrEqual(5000); expect(s!.durationMs).toBeLessThanOrEqual(20_000);
        expect(s!.nextDecisionAt - t).toBeLessThanOrEqual(DENSITY_MAX_PERIOD_MS);
        expect(s!.nextDecisionAt).toBeGreaterThan(t);
        if (starts.length > 0) expect(id, `t=${t}`).not.toBe(starts[starts.length - 1]!.id);
        starts.push({ t, id });
        const end = Math.min(t + s!.durationMs, s!.nextDecisionAt);
        sel.finish(id, end, end < t + s!.durationMs ? 'preempted' : 'completed');
        t = s!.nextDecisionAt;
      }
      for (const s0 of starts) {
        if (s0.t > 600_000 - DENSITY_WINDOW_MS) break;
        const n = starts.filter((s) => s.t >= s0.t && s.t < s0.t + DENSITY_WINDOW_MS).length;
        expect(n, `window from ${s0.t}`).toBeGreaterThanOrEqual(DENSITY_MIN_STARTS);
      }
      expect(new Set(starts.map((s) => s.id)).size).toBeGreaterThanOrEqual(5);
      expect(starts.map((s) => s.id)).not.toContain('wander');   // R3-23: gated at minLiveliness 0.4
    });
  }
});
