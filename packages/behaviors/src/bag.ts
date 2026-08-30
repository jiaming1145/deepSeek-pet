export interface BagEntry { id: string; weight: number }

/** Copies per entry (R3-2): round(weight * 4), never fewer than one. */
export function bagCopies(weight: number): number {
  return Math.max(1, Math.round(weight * 4));
}

/**
 * A draw-without-replacement bag: each entry contributes `bagCopies(weight)` cards, the deck is
 * laid out so that no two adjacent cards share an id, and `draw()` walks it, refilling when empty.
 *
 * PRECONDITION for the no-adjacent-repeat guarantee: `max(bagCopies(weight)) <= ceil(n/2)` over
 * the deck of `n` cards. A multiset admits a repeat-free arrangement only under that inequality,
 * so outside it — reachable with schema-legal weights, e.g. `[{a, 5}, {b, 0.1}]` = 20 vs 1 cards —
 * `refill()` deals the unavoidable repeats instead of throwing, and the SELECTOR's recency-3
 * exclusion (§4.4) is the line of defence. Every shipped pack is inside the precondition: the §4.9
 * Haru pack's largest entry is `doze` at 8 of 30 eligible cards.
 */
export class WeightedShuffleBag {
  private readonly rng: () => number;
  private entries: readonly BagEntry[] = [];
  private cards: string[] = [];
  private pos = 0;
  private last: string | null = null;

  /** `rng` is the injected seeded source; the bag never calls Math.random. */
  constructor(rng: () => number) {
    this.rng = rng;
  }

  /**
   * Rebuilds the bag from the eligible set. Called whenever the eligible set CHANGES.
   *
   * No two adjacent cards share an id — across the refill seam too — WHILE the class
   * precondition holds (`max(copies) <= ceil(n/2)`); see the class doc for what happens outside it.
   *
   * The deck is laid out by a constrained shuffle rather than a plain Fisher-Yates: a plain
   * shuffle of a multiset (`doze` alone contributes 8 of 30 cards) puts two copies of the same id
   * side by side inside ONE deck, which breaks D1 ("no behaviour twice in a row") long before the
   * refill seam is ever reached. Cards are therefore dealt out one position at a time, choosing
   * uniformly at random WEIGHTED BY THE REMAINING COPIES among the ids that (a) differ from the
   * previous card - `lastDealt` for position 0, so the refill seam is covered by the same rule -
   * and (b) leave the rest of the deck arrangeable. A multiset of m cards is arrangeable without
   * an adjacent repeat iff max(count) <= ceil(m/2), and additionally count(prev) <= floor(m/2)
   * when the first card may not be `prev`; that invariant is checked before every placement, so
   * a feasible deck can never strand a run of identical cards at the tail. The marginal count of
   * each id over a full deck is exactly its copy count, so weights are untouched.
   */
  refill(entries: readonly BagEntry[]): void {
    this.entries = entries.map((e) => ({ id: e.id, weight: e.weight }));
    const counts = new Map<string, number>();
    const order: string[] = [];
    for (const e of this.entries) {
      if (!counts.has(e.id)) order.push(e.id);
      counts.set(e.id, (counts.get(e.id) ?? 0) + bagCopies(e.weight));
    }
    let remaining = 0;
    for (const c of counts.values()) remaining += c;

    const cards: string[] = [];
    let prev = this.last;
    while (remaining > 0) {
      const id = this.pickNext(counts, order, remaining, prev);
      cards.push(id);
      counts.set(id, (counts.get(id) as number) - 1);
      remaining -= 1;
      prev = id;
    }
    this.cards = cards;
    this.pos = 0;
  }

  /** The next card: never `prev` while any other card remains, never one that strands the tail. */
  private pickNext(counts: Map<string, number>, order: readonly string[], remaining: number, prev: string | null): string {
    const feasible: string[] = [];
    const others: string[] = [];
    for (const id of order) {
      if ((counts.get(id) ?? 0) === 0 || id === prev) continue;
      others.push(id);
      if (this.keepsArrangeable(counts, id, remaining)) feasible.push(id);
    }
    const pool = feasible.length > 0 ? feasible : others;
    if (pool.length === 0) return prev as string;   // only `prev`'s own copies are left
    let total = 0;
    for (const id of pool) total += counts.get(id) as number;
    let r = this.rng() * total;
    for (const id of pool) {
      r -= counts.get(id) as number;
      if (r < 0) return id;
    }
    return pool[pool.length - 1] as string;
  }

  /** Would placing `chosen` now leave the remaining multiset arrangeable with no adjacent repeat? */
  private keepsArrangeable(counts: Map<string, number>, chosen: string, remaining: number): boolean {
    const m = remaining - 1;
    if (m === 0) return true;
    const ceilHalf = Math.ceil(m / 2);
    const floorHalf = Math.floor(m / 2);
    for (const [id, c0] of counts) {
      const c = id === chosen ? c0 - 1 : c0;
      if (c > ceilHalf) return false;
      if (id === chosen && c > floorHalf) return false;   // `chosen` becomes the next `prev`
    }
    return true;
  }

  /**
   * Deals one id without replacement; refills from the last `entries` when the bag empties.
   * Returns null when `entries` is empty — it does NOT refill-and-retry, so a caller that
   * refilled with an empty eligible set cannot spin.
   */
  draw(): string | null {
    if (this.entries.length === 0) return null;
    if (this.pos >= this.cards.length) this.refill(this.entries);
    const id = this.cards[this.pos] as string;
    this.pos += 1;
    this.last = id;
    return id;
  }

  get size(): number { return this.cards.length - this.pos; }
  get lastDealt(): string | null { return this.last; }
}
