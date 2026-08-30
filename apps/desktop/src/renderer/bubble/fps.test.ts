import { describe, expect, it } from 'vitest';
import { fpsFor } from './fps';

describe('fpsFor (§5.8)', () => {
  it('runs at 60 while hovering, speaking or moving', () => {
    expect(fpsFor({ hovering: true, speaking: false, moving: false })).toBe(60);
    expect(fpsFor({ hovering: false, speaking: true, moving: false })).toBe(60);
    expect(fpsFor({ hovering: false, speaking: false, moving: true })).toBe(60);
    expect(fpsFor({ hovering: true, speaking: true, moving: true })).toBe(60);
  });

  it('idles at 30', () => {
    expect(fpsFor({ hovering: false, speaking: false, moving: false })).toBe(30);
  });
});
