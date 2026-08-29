import { describe, expect, it } from 'vitest';
import { HoverTracker } from './hover';

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
});
