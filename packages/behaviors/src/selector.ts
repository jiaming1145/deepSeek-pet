import type { LaneResult } from '@ds/protocol';
import { WeightedShuffleBag, type BagEntry } from './bag.ts';
import type { BoundBehavior, BoundPack } from './bind.ts';
import { evaluate, type ConditionFacts } from './conditions.ts';

/**
 * §3.4's LivelinessMap, declared STRUCTURALLY here because §1.2 forbids importing @ds/sim.
 * Field names and types are identical; packages/sim/src/liveliness.test.ts asserts the identity.
 */
export interface LivelinessMap {
  idleGapMs: number;
  highEnergyWeight: number;
  saccadeIntervalMs: number;
  saccadeAmplitude: number;
  touchVariantIntensity: number;
  locomotionProbability: number;
  proactiveEligibility: number;
}

export const DENSITY_WINDOW_MS = 60_000;      // bar §0's "60-s unattended recording"
export const DENSITY_MIN_STARTS = 4;          // bar §0's ">= 4 distinct behaviours"
export const DENSITY_GUARD_MIN_LIVELINESS = 0.30;   // R3-2: a MINIMUM, only at L >= 0.3
export const DENSITY_MAX_PERIOD_MS = 14_000;  // 60_000 / 14_000 = 4.28 starts per window
/** §4.4: the last 3 started ids are excluded (R3-2 fixes it at 3). */
export const RECENCY_LENGTH = 3;
/** §4.6: periodMs = idleGapMs * uniform(0.75, 1.25). */
export const PERIOD_JITTER = 0.25;
const DURATION_MIN_MS = 5_000;
const DURATION_MAX_MS = 20_000;

export interface SelectorOptions {
  pack: BoundPack;
  rng: () => number;
  /** livelinessMap(L) from @ds/sim — injected, so behaviors has no dependency on sim. */
  map: LivelinessMap;
}
export interface Selection {
  behavior: BoundBehavior;
  /** Drawn duration, ms: clamp(uniform(minMs, maxMs), 5000, 20000). */
  durationMs: number;
  /** Monotonic ms at which the runner must decide again (§4.6). */
  nextDecisionAt: number;
  /** Trace payload for `arb:trace` kind 'behaviourStart' (§2.4). */
  trace: { eligible: string[]; weights: number[]; seed: number };
}

export class BehaviorSelector {
  private readonly pack: BoundPack;
  private readonly rng: () => number;
  private map: LivelinessMap;
  private readonly bag: WeightedShuffleBag;
  private bagKey = '';
  private readonly recent: string[] = [];
  private readonly cooldownUntil = new Map<string, number>();
  private readonly lastStartedAt = new Map<string, number>();
  private readonly lastResult = new Map<string, LaneResult>();

  constructor(opts: SelectorOptions) {
    this.pack = opts.pack;
    this.rng = opts.rng;
    this.map = opts.map;
    this.bag = new WeightedShuffleBag(opts.rng);
  }

  setLivelinessMap(map: LivelinessMap): void {
    this.map = map;
    this.bagKey = '';   // weights changed: the next update/select refills
  }

  /** Conditions ∧ minLiveliness ∧ cooldown. Recency and the locomotion roll are applied by the caller. */
  private baseEligible(facts: ConditionFacts, nowMono: number): BoundBehavior[] {
    return this.pack.behaviors.filter((b) =>
      facts.liveliness >= b.minLiveliness
      && (this.cooldownUntil.get(b.id) ?? -Infinity) <= nowMono
      && evaluate(b.when, facts));
  }

  private effectiveWeight(b: BoundBehavior): number {
    return b.weight * (b.tags.includes('big') ? this.map.highEnergyWeight : 1);
  }

  /** Refills the bag only when the (id, weight) set differs from the bag's current one. */
  private rebag(list: readonly BoundBehavior[]): BagEntry[] {
    const entries = list.map((b) => ({ id: b.id, weight: this.effectiveWeight(b) }));
    const key = entries.map((e) => `${e.id}:${e.weight}`).join('|');
    if (key !== this.bagKey) { this.bag.refill(entries); this.bagKey = key; }
    return entries;
  }

  /** Re-evaluates conditions and refills the bag only when the eligible SET changed.
   *  Locomotion entries are left out here (their roll is per decision, §4.5). */
  update(facts: ConditionFacts, nowMono: number): void {
    this.rebag(this.baseEligible(facts, nowMono).filter((b) => b.locomotion === null && !this.recent.includes(b.id)));
  }

  /** Draws the next behaviour. Returns null when nothing is eligible (the runner then holds). */
  select(facts: ConditionFacts, nowMono: number): Selection | null {
    const seed = Math.floor(this.rng() * 0x7fffffff);
    const locomotionOk = this.rng() < this.map.locomotionProbability;
    const base = this.baseEligible(facts, nowMono).filter((b) => b.locomotion === null || locomotionOk);
    if (base.length === 0) return null;
    const afterRecency = base.filter((b) => !this.recent.includes(b.id));

    let chosen: BoundBehavior;
    let entries: BagEntry[];
    if (afterRecency.length > 0) {
      entries = this.rebag(afterRecency);
      const id = this.bag.draw();
      if (id === null) return null;
      chosen = afterRecency.find((b) => b.id === id) as BoundBehavior;
    } else {
      // §4.4 LRU fallback: relax ONLY the recency exclusion; pick the least-recently-started.
      entries = base.map((b) => ({ id: b.id, weight: this.effectiveWeight(b) }));
      chosen = [...base].sort((a, b) =>
        (this.lastStartedAt.get(a.id) ?? -Infinity) - (this.lastStartedAt.get(b.id) ?? -Infinity))[0] as BoundBehavior;
    }

    this.recent.push(chosen.id);
    while (this.recent.length > RECENCY_LENGTH) this.recent.shift();
    this.lastStartedAt.set(chosen.id, nowMono);
    if (chosen.cooldownMs > 0) this.cooldownUntil.set(chosen.id, nowMono + chosen.cooldownMs);

    const drawn = Math.round(chosen.minMs + this.rng() * (chosen.maxMs - chosen.minMs));
    const durationMs = Math.min(DURATION_MAX_MS, Math.max(DURATION_MIN_MS, drawn));
    const periodMs = this.map.idleGapMs * (1 - PERIOD_JITTER + this.rng() * 2 * PERIOD_JITTER);
    const rawNext = nowMono + Math.max(durationMs, periodMs);
    const nextDecisionAt = Math.round(facts.liveliness >= DENSITY_GUARD_MIN_LIVELINESS
      ? Math.min(rawNext, nowMono + DENSITY_MAX_PERIOD_MS)
      : rawNext);

    return {
      behavior: chosen,
      durationMs,
      nextDecisionAt,
      trace: { eligible: entries.map((e) => e.id), weights: entries.map((e) => e.weight), seed },
    };
  }

  /** The runner reports the outcome so cooldowns and recency stay accurate. Cooldowns are keyed
   *  to the START (§4.4), so a finish only records the result; recency is already stamped. */
  finish(id: string, _nowMono: number, result: LaneResult): void {
    this.lastResult.set(id, result);
  }
}
