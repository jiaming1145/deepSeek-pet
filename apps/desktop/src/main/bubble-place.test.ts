import { describe, expect, it } from 'vitest';
import { placeBubble, preferredSideFor } from './bubble-place';

const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const PET = { x: 1476, y: 296, width: 420, height: 720 };

describe('placeBubble', () => {
  it('A — keeps the preferred side when it fits', () => {
    expect(placeBubble(PET, { width: 320, height: 120 }, WA, 'left'))
      .toEqual({ x: 1144, y: 366, side: 'left', arrowOffset: 60 });
  });

  it('B — flips left to right at the screen edge', () => {
    expect(placeBubble({ x: 24, y: 296, width: 420, height: 720 }, { width: 320, height: 120 }, WA, 'left'))
      .toEqual({ x: 456, y: 366, side: 'right', arrowOffset: 60 });
  });

  it('C — flips top to bottom when the pet sits at the top edge', () => {
    expect(placeBubble({ x: 1476, y: 0, width: 420, height: 720 }, { width: 320, height: 120 }, WA, 'top'))
      .toEqual({ x: 1526, y: 142, side: 'bottom', arrowOffset: 160 });
  });

  it('D — shifts into the work area and keeps the preferred side when nothing fits', () => {
    expect(placeBubble(
      { x: 290, y: 0, width: 420, height: 600 },
      { width: 460, height: 520 },
      { x: 0, y: 0, width: 1000, height: 600 },
      'top',
    )).toEqual({ x: 270, y: 16, side: 'top', arrowOffset: 230 });
  });

  it('E — places against the pet display work area on a mixed-DPI desktop', () => {
    expect(placeBubble(
      { x: 2900, y: 296, width: 420, height: 720 },
      { width: 380, height: 160 },
      { x: 1280, y: 0, width: 1920, height: 1040 },
      'left',
    )).toEqual({ x: 2508, y: 346, side: 'left', arrowOffset: 80 });
  });

  it('never leaves the display the pet is on (mixed DPI)', () => {
    const p = placeBubble(
      { x: 2900, y: 296, width: 420, height: 720 },
      { width: 380, height: 160 },
      { x: 1280, y: 0, width: 1920, height: 1040 },
      'left',
    );
    expect(p.x).toBeGreaterThanOrEqual(1280 + 16);
    expect(p.x + 380).toBeLessThanOrEqual(1280 + 1920 - 16);
  });
});

describe('preferredSideFor', () => {
  it('prefers the left side when the pet sits right of centre', () => {
    expect(preferredSideFor(PET, WA)).toBe('left');
  });

  it('prefers the right side when the pet sits left of centre', () => {
    expect(preferredSideFor({ x: 24, y: 296, width: 420, height: 720 }, WA)).toBe('right');
  });
});
