import { describe, expect, it } from 'vitest';
import { HoverTracker, type HoverClock } from './hover';

/** Manual clock: `advance` runs every timer whose deadline falls inside the window, in order. */
class FakeClock implements HoverClock {
  private t = 0;
  private nextId = 1;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  now(): number { return this.t; }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ id, at: this.t + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }
  advance(ms: number): void {
    const until = this.t + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.t = due.at;
      due.fn();
    }
    this.t = until;
  }
}

describe('HoverTracker', () => {
  it('emits enter once after the debounce window', () => {
    const events: boolean[] = [];
    const h = new HoverTracker((v) => events.push(v), 50);
    h.sample(true, 0); h.sample(true, 20); h.sample(true, 60);
    expect(events).toEqual([true]);
  });
  it('does not emit for a blip shorter than the debounce', () => {
    const events: boolean[] = [];
    const h = new HoverTracker((v) => events.push(v), 50);
    h.sample(true, 0); h.sample(false, 10); h.sample(false, 70);
    expect(events).toEqual([]);
  });
  it('emits leave after a stable outside period', () => {
    const events: boolean[] = [];
    const h = new HoverTracker((v) => events.push(v), 50);
    h.sample(true, 0); h.sample(true, 60); h.sample(false, 100); h.sample(false, 160);
    expect(events).toEqual([true, false]);
  });
  it('emits from its own timer when the cursor stops moving and no more samples arrive', () => {
    const events: boolean[] = [];
    const clock = new FakeClock();
    const h = new HoverTracker((v) => events.push(v), 50, clock);
    h.sample(true, 0);
    expect(events).toEqual([]);
    clock.advance(50);
    expect(events).toEqual([true]);
  });
});

describe('HoverTracker.reset', () => {
  it('re-emits enter from the next stable sample after a hide/show cycle', () => {
    const events: boolean[] = [];
    const h = new HoverTracker((v) => events.push(v), 50);
    h.sample(true, 0); h.sample(true, 60);
    expect(events).toEqual([true]);
    h.reset(); // window hidden then shown; main forced click-through meanwhile
    h.sample(true, 100); h.sample(true, 160);
    expect(events).toEqual([true, true]);
  });
});
