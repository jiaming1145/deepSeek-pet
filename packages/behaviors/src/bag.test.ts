import { describe, expect, it } from 'vitest';
import { WeightedShuffleBag } from './bag.ts';
import { mulberry32 } from './test-util.ts';

describe('WeightedShuffleBag', () => {
  it('holds max(1, round(weight*4)) copies per entry', () => {
    const bag = new WeightedShuffleBag(mulberry32(1));
    bag.refill([{ id: 'a', weight: 1.4 }, { id: 'b', weight: 0.1 }, { id: 'c', weight: 2.0 }]);
    expect(bag.size).toBe(6 + 1 + 8);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 15; i++) { const id = bag.draw(); if (id) counts[id] = (counts[id] ?? 0) + 1; }
    expect(counts).toEqual({ a: 6, b: 1, c: 8 });
    expect(bag.size).toBe(0);
  });
  it('draws without replacement and refills from the last entries when empty', () => {
    const bag = new WeightedShuffleBag(mulberry32(2));
    bag.refill([{ id: 'x', weight: 0.25 }, { id: 'y', weight: 0.25 }]);
    const first = [bag.draw(), bag.draw()].sort();
    expect(first).toEqual(['x', 'y']);
    expect(bag.size).toBe(0);
    expect(['x', 'y']).toContain(bag.draw());
    expect(bag.size).toBe(1);
  });
  it('returns null on empty entries and never spins', () => {
    const bag = new WeightedShuffleBag(mulberry32(3));
    expect(bag.draw()).toBeNull();
    bag.refill([]);
    expect(bag.draw()).toBeNull();
    expect(bag.size).toBe(0);
    expect(bag.lastDealt).toBeNull();
  });
  it('never deals the same id twice in a row across 10 000 draws, refills included', () => {
    const entries = [
      { id: 'idle_breathe', weight: 1.4 }, { id: 'idle_settle', weight: 1.2 }, { id: 'look_around', weight: 1.0 },
      { id: 'head_tilt', weight: 0.9 }, { id: 'fidget_hands', weight: 0.7 }, { id: 'doze', weight: 2.0 },
    ];
    for (const seed of [11, 22, 33]) {
      const bag = new WeightedShuffleBag(mulberry32(seed));
      bag.refill(entries);
      let prev: string | null = null;
      let refills = 0;
      for (let i = 0; i < 10_000; i++) {
        if (bag.size === 0) refills++;
        const id = bag.draw();
        expect(id).not.toBeNull();
        expect(id, `seed ${seed} draw ${i}`).not.toBe(prev);
        expect(bag.lastDealt).toBe(id);
        prev = id;
      }
      expect(refills).toBeGreaterThan(300);
    }
  });
  it('the refill swap also protects a manual refill after a deal', () => {
    for (let seed = 0; seed < 200; seed++) {
      const bag = new WeightedShuffleBag(mulberry32(seed));
      bag.refill([{ id: 'p', weight: 0.25 }, { id: 'q', weight: 0.25 }]);
      const dealt = bag.draw();
      bag.refill([{ id: 'p', weight: 0.25 }, { id: 'q', weight: 0.25 }, { id: 'r', weight: 0.25 }]);
      expect(bag.draw(), `seed ${seed}`).not.toBe(dealt);
    }
  });
});
