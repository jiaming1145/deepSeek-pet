import type { LaneResult } from '@ds/protocol';
import { WeightedShuffleBag, bagCopies, type BagEntry } from './bag.ts';
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
  /** Cards in one full deck of the current bag — the bound on the skip loop in `select()`. */
  private deckCards = 0;
  private readonly recent: string[] = [];
  private readonly cooldownUntil = new Map<string, number>();
  private readonly lastStartedAt = new Map<string, number>();

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

  /**
   * The DECK set: conditions ∧ minLiveliness. This is what the bag is built from, and the only
   * thing that keys it — see `rebag()`. It changes only when the world does.
   */
  private deckEligible(facts: ConditionFacts): BoundBehavior[] {
    return this.pack.behaviors.filter((b) =>
      facts.liveliness >= b.minLiveliness && evaluate(b.when, facts));
  }

  /** The SELECTION set: the deck set ∧ cooldown. Recency and the locomotion roll are applied by the caller. */
  private baseEligible(deck: readonly BoundBehavior[], nowMono: number): BoundBehavior[] {
    return deck.filter((b) => (this.cooldownUntil.get(b.id) ?? -Infinity) <= nowMono);
  }

  private effectiveWeight(b: BoundBehavior): number {
    return b.weight * (b.tags.includes('big') ? this.map.highEnergyWeight : 1);
  }

  private entriesOf(list: readonly BoundBehavior[]): BagEntry[] {
    return list.map((b) => ({ id: b.id, weight: this.effectiveWeight(b) }));
  }

  /**
   * Refills the bag only when the (id, weight) set differs from the bag's current one.
   *
   * The key is ALWAYS the DECK set (conditions ∧ minLiveliness) — never the recency-filtered list,
   * never the cooldown-filtered one, and never the locomotion roll. Those three rotate on almost
   * every decision, so keying on any of them refills before every draw and the deck is never dealt
   * past position 0: §4.3's "the bag holds 60–80 cards, so the whole pool is covered before
   * anything recurs" would degenerate into a weighted single pick. Measured on the §4.9 Haru pack
   * over the 10-minute L = 0.30 simulation (seed 1): keyed on the recency-filtered list 44 refills
   * in 44 decisions, keyed on conditions ∧ minLiveliness ∧ cooldown 41 in 44, keyed on the deck set
   * 3 in 45 (a 28-card deck). Cooldown, recency and the locomotion roll stay fully
   * enforced — they are layered on top of the bag (§4.4) by skipping the drawn CARD.
   */
  private rebag(list: readonly BoundBehavior[]): void {
    const entries = this.entriesOf(list);
    const key = entries.map((e) => `${e.id}:${e.weight}`).join('|');
    if (key !== this.bagKey) {
      this.bag.refill(entries);
      this.bagKey = key;
      this.deckCards = entries.reduce((n, e) => n + bagCopies(e.weight), 0);
    }
  }

  /** The least-recently-started member of `list` (never started sorts first); pack order breaks ties. */
  private leastRecentlyStarted(list: readonly BoundBehavior[]): BoundBehavior {
    return [...list].sort((a, b) =>
      (this.lastStartedAt.get(a.id) ?? -Infinity) - (this.lastStartedAt.get(b.id) ?? -Infinity))[0] as BoundBehavior;
  }

  /** Re-evaluates conditions and refills the bag only when the eligible SET changed.
   *  `nowMono` is accepted for the contract-fixed signature; the deck set is time-independent by
   *  construction (cooldown is applied per decision in `select()`, not to the deck). */
  update(facts: ConditionFacts, _nowMono: number): void {
    this.rebag(this.deckEligible(facts));
  }

  /** Draws the next behaviour. Returns null when nothing is eligible (the runner then holds). */
  select(facts: ConditionFacts, nowMono: number): Selection | null {
    const seed = Math.floor(this.rng() * 0x7fffffff);
    const locomotionOk = this.rng() < this.map.locomotionProbability;
    const deck = this.deckEligible(facts);
    const base = this.baseEligible(deck, nowMono).filter((b) => b.locomotion === null || locomotionOk);
    if (base.length === 0) return null;
    this.rebag(deck);
    const afterRecency = base.filter((b) => !this.recent.includes(b.id));
    const justStarted = this.recent[this.recent.length - 1] ?? null;

    let chosen: BoundBehavior | null = null;
    let candidates: readonly BoundBehavior[];
    if (afterRecency.length > 0) {
      candidates = afterRecency;
      // Recency-3, the cooldowns and the locomotion roll are applied to the DRAWN CARD: a card for
      // an excluded id is consumed and the next one is dealt, so the deck keeps its memory across
      // decisions. `allowed` is a non-empty subset of the deck's ids and a full deck holds every
      // one of them at least once, so `limit` draws always reach an allowed card — the loop is
      // bounded and cannot spin.
      const allowed = new Map(afterRecency.map((b) => [b.id, b] as const));
      const limit = this.bag.size + this.deckCards;
      for (let i = 0; i < limit && chosen === null; i++) {
        const id = this.bag.draw();
        if (id === null) break;
        chosen = allowed.get(id) ?? null;
      }
      if (chosen === null) chosen = this.leastRecentlyStarted(afterRecency);
    } else {
      // §4.4 LRU fallback: relax ONLY the recency exclusion; pick the least-recently-started.
      // DECISION (fix round 1): the id started LAST is still excluded here. When it is the only
      // base-eligible behaviour the fallback set is empty and the selector returns null so the
      // runner holds (§4.4's last rule) — D1's "no behaviour twice in a row" outranks filling the
      // gap, and it is the only rule the fallback may not relax. With two or more base-eligible
      // behaviours the fallback always yields one, so this costs nothing outside a pack that has
      // gated all but one of its >= 12 behaviours out at the same instant.
      candidates = base.filter((b) => b.id !== justStarted);
      if (candidates.length === 0) return null;
      chosen = this.leastRecentlyStarted(candidates);
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

    // trace.eligible/weights are the candidates THIS decision could have produced (recency
    // already applied), not the deck the bag is keyed on.
    const traceEntries = this.entriesOf(candidates);
    return {
      behavior: chosen,
      durationMs,
      nextDecisionAt,
      trace: { eligible: traceEntries.map((e) => e.id), weights: traceEntries.map((e) => e.weight), seed },
    };
  }

  /**
   * The runner reports the outcome so cooldowns and recency stay accurate.
   *
   * Cooldowns are keyed to the START (§4.4) and recency is stamped in `select()`, so with the
   * rules that exist today there is nothing left for a finish to do — it is a documented no-op.
   * DECISION (fix round 1): the previous `lastResult` map was dead state (written, never read) and
   * is removed rather than left as a hook. No contract rule says what a `'cancelled'` or
   * `'renderer_lost'` finish should change (clearing the cooldown stamped at start is the obvious
   * candidate), so this waits for that ruling instead of inventing a policy. The signature is
   * contract-fixed (§4.5) and unchanged, so the rule can be implemented here without touching any
   * caller. Reported to the controller as fix-round-1 finding 4.
   */
  finish(_id: string, _nowMono: number, _result: LaneResult): void {
    /* no-op — see the doc comment. */
  }
}
