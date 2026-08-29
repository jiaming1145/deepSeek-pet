import { describe, expect, it } from 'vitest';
import { ViewTransform } from './view';

describe('ViewTransform', () => {
  it('maps canvas centre to view origin', () => {
    const v = new ViewTransform(400, 800);
    expect(v.toView(200, 400)).toEqual({ x: 0, y: 0 });
  });
  it('maps top-left to (-ratio, +1) for a portrait canvas', () => {
    const v = new ViewTransform(400, 800);
    const p = v.toView(0, 0);
    expect(p.x).toBeCloseTo(-0.5);
    expect(p.y).toBeCloseTo(1);
  });
  it('maps left edge to x=-1 for a landscape canvas', () => {
    const v = new ViewTransform(800, 400);
    expect(v.toView(0, 200).x).toBeCloseTo(-1);
  });
  it('clamps gaze to [-1,1] for points outside the canvas', () => {
    const v = new ViewTransform(400, 800);
    expect(v.toGaze(-5000, 9000)).toEqual({ x: -1, y: -1 });
  });
});
