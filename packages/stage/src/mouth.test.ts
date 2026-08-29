import { describe, expect, it } from 'vitest';
import { TextMouthDriver } from './mouth';

describe('TextMouthDriver', () => {
  it('is closed when not speaking', () => {
    const m = new TextMouthDriver(() => 0.5);
    m.update(0.016);
    expect(m.getParameter()).toBe(0);
  });
  it('opens while speaking and stays within [0,1]', () => {
    const m = new TextMouthDriver(() => 0.5);
    m.start();
    let max = 0;
    for (let i = 0; i < 120; i++) { m.update(1 / 60); max = Math.max(max, m.getParameter()); expect(m.getParameter()).toBeGreaterThanOrEqual(0); expect(m.getParameter()).toBeLessThanOrEqual(1); }
    expect(max).toBeGreaterThan(0.4);
  });
  it('closes smoothly after stop (never jumps to 0 in one frame)', () => {
    const m = new TextMouthDriver(() => 0.5);
    m.start();
    for (let i = 0; i < 30; i++) m.update(1 / 60);
    const before = m.getParameter();
    m.stop();
    m.update(1 / 60);
    expect(m.getParameter()).toBeLessThan(before);
    expect(m.getParameter()).toBeGreaterThan(0);
  });
});
