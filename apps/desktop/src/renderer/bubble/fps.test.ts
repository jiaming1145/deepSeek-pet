import { describe, expect, it } from 'vitest';
import { fpsFor } from './fps';

describe('fpsFor', () => {
  it('runs at 60 while hovering or speaking', () => {
    expect(fpsFor({ hovering: true, speaking: false })).toBe(60);
    expect(fpsFor({ hovering: false, speaking: true })).toBe(60);
    expect(fpsFor({ hovering: true, speaking: true })).toBe(60);
  });

  it('idles at 30', () => {
    expect(fpsFor({ hovering: false, speaking: false })).toBe(30);
  });
});
