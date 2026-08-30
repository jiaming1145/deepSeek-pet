import { describe, expect, it } from 'vitest';
import {
  BAND_ANCHOR_Y, BAND_PET_FRACTION, BAND_TOP_MAX_FRACTION, BUBBLE_MAX, BUBBLE_MIN, BUBBLE_PADDING,
  placeBubble, preferredSideFor, type Rect, type Size,
} from './bubble-place';

const WA = { x: 0, y: 0, width: 1920, height: 1040 };
/** The shipped pet window: 420x720 DIP, parked bottom-right of a 1920x1040 work area. */
const PET = { x: 1476, y: 296, width: 420, height: 720 };

// The composer's own geometry (renderer/shared/chat-metrics.ts): 360 wide, 48 tall at one row,
// 158 at six, +420 while the history pane is open.
const CHAT_BASE: Size = { width: 360, height: 48 };
const CHAT_SIX_ROWS: Size = { width: 360, height: 158 };
const CHAT_HISTORY_OPEN: Size = { width: 360, height: 468 };

const topFloor = (pet: Rect): number => pet.y + pet.height * BAND_TOP_MAX_FRACTION;
const insideWorkArea = (p: { x: number; y: number }, s: Size, wa: Rect): boolean =>
  p.x >= wa.x && p.y >= wa.y && p.x + s.width <= wa.x + wa.width && p.y + s.height <= wa.y + wa.height;

/** Every band size the window can actually take, plus the composer's three heights. */
function everyBandSize(): Size[] {
  const sizes: Size[] = [];
  for (let w = BUBBLE_MIN.width; w <= BUBBLE_MAX.width; w += 20) {
    for (let h = BUBBLE_MIN.height; h <= BUBBLE_MAX.height; h += 23) sizes.push({ width: w, height: h });
  }
  sizes.push(BUBBLE_MIN, BUBBLE_MAX, CHAT_BASE, CHAT_SIX_ROWS);
  return sizes;
}

describe('placeBubble — the band sits over her lower third (task-0 direction, FIRST VIEWPORT)', () => {
  it('A — never puts the window over her face: the top edge stays at or below 55 % of the pet', () => {
    // This is the regression the controller's ruling names. `desktop-chat-over-pet.png` and
    // `task6-fake-brain-run.png` were produced by the retired HEAD_ANCHOR y = 0.18, which put the
    // top edge at roughly 5 % of the pet's height — straight over her face.
    const offenders = everyBandSize()
      .map((size) => ({ size, p: placeBubble(PET, size, WA, 'left') }))
      .filter(({ p }) => p.y < Math.floor(topFloor(PET)));
    expect(offenders).toEqual([]);
  });

  it('A2 — the shipped two-line band lands in her lower third, not on her head', () => {
    const p = placeBubble(PET, { width: 400, height: 96 }, WA, 'left');
    // centre on BAND_ANCHOR_Y, so the top edge is 0.72 * 720 - 48 = 470 px below the pet's top.
    expect(p.y).toBe(Math.round(PET.y + PET.height * BAND_ANCHOR_Y - 48));
    expect((p.y - PET.y) / PET.height).toBeGreaterThan(BAND_TOP_MAX_FRACTION);
  });

  it('B — she stands in the band\'s right third when it extends left', () => {
    for (const size of [BUBBLE_MIN, { width: 320, height: 120 }, BUBBLE_MAX]) {
      const p = placeBubble(PET, size, WA, 'left');
      const petCx = PET.x + PET.width / 2;
      const fraction = (petCx - p.x) / size.width;
      expect(p.side).toBe('left');
      expect(fraction).toBeGreaterThanOrEqual(2 / 3);
      expect(fraction).toBeLessThanOrEqual(1);
      expect(fraction).toBeCloseTo(BAND_PET_FRACTION, 1);
    }
  });

  it('C — preferred side is left, at both halves of the desktop', () => {
    expect(preferredSideFor(PET, WA)).toBe('left');
    expect(preferredSideFor({ x: 400, y: 296, width: 420, height: 720 }, WA)).toBe('left');
    expect(placeBubble({ x: 400, y: 296, width: 420, height: 720 }, { width: 320, height: 120 }, WA, 'left').side)
      .toBe('left');
  });

  it('D — flips right only when the work area has no room on the left', () => {
    const hugLeft = { x: 24, y: 296, width: 420, height: 720 };
    const p = placeBubble(hugLeft, { width: 460, height: 120 }, WA, preferredSideFor(hugLeft, WA));
    expect(p.side).toBe('right');
    // Mirrored: she now stands in the band's LEFT third.
    const fraction = (hugLeft.x + hugLeft.width / 2 - p.x) / 460;
    expect(fraction).toBeLessThanOrEqual(1 / 3);
    expect(insideWorkArea(p, { width: 460, height: 120 }, WA)).toBe(true);
  });

  it('D2 — a pet flush against the left edge reports right as the preferred side', () => {
    expect(preferredSideFor({ x: 0, y: 296, width: 120, height: 720 }, WA)).toBe('right');
  });

  it('E — never crosses the pet display\'s work area, at any band size or pet position (C14)', () => {
    const displays: Rect[] = [
      WA,
      { x: 1280, y: 0, width: 1920, height: 1040 }, // the second monitor on a mixed-DPI desktop
      { x: 0, y: 0, width: 1000, height: 600 }, // a small display where the band barely fits
    ];
    const bad: string[] = [];
    for (const wa of displays) {
      for (const px of [wa.x, wa.x + 40, wa.x + wa.width / 2 - 210, wa.x + wa.width - 420]) {
        const pet = { x: px, y: wa.y + Math.max(0, wa.height - 720), width: 420, height: 720 };
        for (const size of everyBandSize()) {
          const p = placeBubble(pet, size, wa, preferredSideFor(pet, wa));
          if (!insideWorkArea(p, size, wa)) bad.push(`${JSON.stringify({ wa, pet, size, p })}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('F — the notch stays on a vertical edge, so the side is only ever left or right', () => {
    for (const pref of ['left', 'right', 'top', 'bottom'] as const) {
      expect(['left', 'right']).toContain(placeBubble(PET, { width: 320, height: 120 }, WA, pref).side);
    }
  });

  it('G — exact rect for the shipped 320x120 band (regression anchor)', () => {
    expect(placeBubble(PET, { width: 320, height: 120 }, WA, 'left'))
      .toEqual({ x: 1430, y: 754, side: 'left', arrowOffset: 60 });
  });

  it('H — the mixed-DPI second monitor keeps its own work area (C14 test E)', () => {
    const pet = { x: 2900, y: 296, width: 420, height: 720 };
    const wa = { x: 1280, y: 0, width: 1920, height: 1040 };
    const p = placeBubble(pet, { width: 380, height: 160 }, wa, preferredSideFor(pet, wa));
    expect(p.x).toBeGreaterThanOrEqual(wa.x + BUBBLE_PADDING);
    expect(p.x + 380).toBeLessThanOrEqual(wa.x + wa.width - BUBBLE_PADDING);
    expect(p.y).toBeGreaterThanOrEqual(Math.floor(topFloor(pet)));
  });
});

describe('placeBubble — the chat window takes the band\'s rect (controller ruling 2026-08-29)', () => {
  it('opens the composer on the band anchor, not over her face', () => {
    const band = placeBubble(PET, { width: 360, height: 48 }, WA, 'left');
    const chat = placeBubble(PET, CHAT_BASE, WA, preferredSideFor(PET, WA));
    expect(chat).toEqual(band);
    expect(chat.y).toBeGreaterThanOrEqual(Math.floor(topFloor(PET)));
  });

  it('a six-row composer still clears her face', () => {
    const p = placeBubble(PET, CHAT_SIX_ROWS, WA, preferredSideFor(PET, WA));
    expect(p.y).toBeGreaterThanOrEqual(Math.floor(topFloor(PET)));
    expect(insideWorkArea(p, CHAT_SIX_ROWS, WA)).toBe(true);
  });

  it('the work area wins over the 55 % floor when the window is too tall to fit below it', () => {
    // 468 DIP (composer + open history pane) does not fit between 55 % of the pet and the work-area
    // bottom, so C14 takes precedence and the window is placed against the work area. It still sits
    // far below her face: the top edge lands at 36 % of the pet rather than 5 %.
    const p = placeBubble(PET, CHAT_HISTORY_OPEN, WA, preferredSideFor(PET, WA));
    expect(insideWorkArea(p, CHAT_HISTORY_OPEN, WA)).toBe(true);
    expect(p.y).toBe(WA.y + WA.height - BUBBLE_PADDING - CHAT_HISTORY_OPEN.height);
    expect(p.y).toBeLessThan(Math.floor(topFloor(PET)));
    expect((p.y - PET.y) / PET.height).toBeGreaterThan(0.3);
  });
});

describe('preferredSideFor', () => {
  it('prefers the left side when the pet sits right of centre', () => {
    expect(preferredSideFor(PET, WA)).toBe('left');
  });

  it('still prefers the left side when the pet sits left of centre but has room', () => {
    expect(preferredSideFor({ x: 24, y: 296, width: 420, height: 720 }, WA)).toBe('left');
  });

  it('falls back to the right when a minimum band cannot fit on the left', () => {
    expect(preferredSideFor({ x: 0, y: 296, width: 100, height: 720 }, WA)).toBe('right');
  });
});
