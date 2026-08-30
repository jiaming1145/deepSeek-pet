import { describe, expect, it } from 'vitest';
import type { Side } from '@ds/protocol';
import {
  BAND_ANCHOR_Y, BAND_PET_FRACTION, BAND_TOP_MAX_FRACTION, BUBBLE_GAP, BUBBLE_MAX, BUBBLE_MIN,
  BUBBLE_PADDING, placeBubble, preferredSideFor, type Rect, type Size,
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

  it('G2 — contracts.md §5.3.1 A-E, the five pinned rects (C14)', () => {
    // The same five rows as the contract table, which §8.7 pins as "verified this session". They
    // moved with the band geometry in fix round 1 and the contract was amended in the same
    // change-set; this test is what makes the amended numbers true rather than asserted.
    const rows: [string, Rect, Size, Rect, Side, { x: number; y: number; side: Side; arrowOffset: number }][] = [
      ['A', { x: 1476, y: 296, width: 420, height: 720 }, { width: 320, height: 120 }, WA, 'left',
        { x: 1430, y: 754, side: 'left', arrowOffset: 60 }],
      ['B', { x: 24, y: 296, width: 420, height: 720 }, { width: 320, height: 120 }, WA, 'left',
        { x: 170, y: 754, side: 'right', arrowOffset: 60 }],
      ['C', { x: 1476, y: 0, width: 420, height: 720 }, { width: 320, height: 120 }, WA, 'left',
        { x: 1430, y: 458, side: 'left', arrowOffset: 60 }],
      ['D', { x: 290, y: 0, width: 420, height: 600 }, { width: 460, height: 520 }, { x: 0, y: 0, width: 1000, height: 600 }, 'left',
        { x: 132, y: 64, side: 'left', arrowOffset: 368 }],
      ['E', { x: 2900, y: 296, width: 420, height: 720 }, { width: 380, height: 160 }, { x: 1280, y: 0, width: 1920, height: 1040 }, 'left',
        { x: 2804, y: 734, side: 'left', arrowOffset: 80 }],
    ];
    for (const [name, pet, size, wa, pref, expected] of rows) {
      expect([name, placeBubble(pet, size, wa, pref)]).toEqual([name, expected]);
      expect([name, insideWorkArea(expected, size, wa)]).toEqual([name, true]);
    }
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

describe('placeBubble — the band steps clear of the visible composer (fix round 1, finding 2)', () => {
  const rectOf = (p: { x: number; y: number }, s: Size): Rect => ({ x: p.x, y: p.y, ...s });
  const overlap = (a: Rect, b: Rect): boolean =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  /** The composer, placed exactly as `chat-window.ts` places it: the band's own rect, no `avoid`. */
  const composer = (size: Size, pet: Rect = PET, wa: Rect = WA): Rect =>
    rectOf(placeBubble(pet, size, wa, preferredSideFor(pet, wa)), size);

  it('without a composer the placement is byte-identical to the pre-fix geometry', () => {
    for (const size of everyBandSize()) {
      expect(placeBubble(PET, size, WA, 'left', null)).toEqual(placeBubble(PET, size, WA, 'left'));
    }
  });

  it('the band and the one-row composer no longer share a single pixel', () => {
    const chat = composer(CHAT_BASE);
    const band = { width: 400, height: 96 };
    const withChat = placeBubble(PET, band, WA, 'left', chat);
    // Without the dodge these two rects overlap — that is the defect app-placement.png recorded.
    expect(overlap(rectOf(placeBubble(PET, band, WA, 'left'), band), chat)).toBe(true);
    expect(overlap(rectOf(withChat, band), chat)).toBe(false);
    // Below, not above: her line reads under your line and stays off her face.
    expect(withChat.y).toBe(chat.y + chat.height + BUBBLE_GAP);
    expect(insideWorkArea(withChat, band, WA)).toBe(true);
  });

  it('goes above the composer when there is no room below AND the 55 % floor allows it', () => {
    // A shorter work area (a tall taskbar) leaves no room under a one-row composer for an 80 DIP
    // band, and 790 - 12 - 80 = 698 is still below the floor at 692 — so the band takes the other
    // side of the same flip. This is the ONLY shape the above branch has after fix round 2.
    const shortWa = { x: 0, y: 0, width: 1920, height: 920 };
    const chat = composer(CHAT_BASE, PET, shortWa);
    const band: Size = { width: 320, height: 80 };
    const p = placeBubble(PET, band, shortWa, 'left', chat);
    expect(chat.y + chat.height + BUBBLE_GAP + band.height)
      .toBeGreaterThan(shortWa.y + shortWa.height - BUBBLE_PADDING); // no room below
    expect(p.y).toBe(chat.y - BUBBLE_GAP - band.height);
    expect(p.y).toBeGreaterThanOrEqual(Math.floor(topFloor(PET))); // and still off her face
    expect(overlap(rectOf(p, band), chat)).toBe(false);
    expect(insideWorkArea(p, band, shortWa)).toBe(true);
  });

  it('fix round 2 — the 55 % floor outranks the dodge: it overlaps rather than flip onto her face', () => {
    // REGRESSION GUARD. Fix round 1 gated the above branch on `waT` alone, so a six-row composer
    // plus a full-height band flipped the band to y = 403 — 14.9 % of the pet window, i.e. her
    // face, the exact defect commit 02ad454 exists to prevent. The floor is a placement ruling; the
    // dodge is a courtesy. With no room below the floor, the band keeps step 2's row and overlaps.
    const chat = composer(CHAT_SIX_ROWS);
    const p = placeBubble(PET, BUBBLE_MAX, WA, 'left', chat);
    expect(chat.y - BUBBLE_GAP - BUBBLE_MAX.height).toBeLessThan(Math.floor(topFloor(PET)));
    expect(p.y).toBe(Math.round(topFloor(PET)));
    expect(p.y).toBe(placeBubble(PET, BUBBLE_MAX, WA, 'left').y); // step 2's row, unchanged
    expect(overlap(rectOf(p, BUBBLE_MAX), chat)).toBe(true);
    expect(insideWorkArea(p, BUBBLE_MAX, WA)).toBe(true);
  });

  it('fix round 2 — the dodge never lifts the band above the 55 % floor, at any size or display', () => {
    // The sweep the round-1 tests did not have: floor test A runs without `avoid`, and the C14
    // sweep below checks only the work area, so nothing caught the history-open composer pushing
    // every band up onto her face. Note the one legitimate exception, already pinned by "the work
    // area wins over the 55 % floor": when the band is too tall to fit between the floor and the
    // work-area bottom, step 2 itself starts above the floor. The dodge must never make that worse.
    const displays: Rect[] = [WA, { x: 1280, y: 0, width: 1920, height: 1040 }, { x: 0, y: 0, width: 1000, height: 600 }];
    const aboveFloor: string[] = [];
    const raisedByDodge: string[] = [];
    for (const wa of displays) {
      for (const px of [wa.x, wa.x + 40, wa.x + wa.width / 2 - 210, wa.x + wa.width - 420]) {
        const pet = { x: px, y: wa.y + Math.max(0, wa.height - 720), width: 420, height: 720 };
        const floor = Math.floor(topFloor(pet));
        for (const chatSize of [CHAT_BASE, CHAT_SIX_ROWS, CHAT_HISTORY_OPEN]) {
          const chat = composer(chatSize, pet, wa);
          for (const size of everyBandSize()) {
            const withChat = placeBubble(pet, size, wa, preferredSideFor(pet, wa), chat);
            const alone = placeBubble(pet, size, wa, preferredSideFor(pet, wa));
            const row = JSON.stringify({ wa, pet, chatSize, size, withChat, alone, floor });
            if (alone.y >= floor && withChat.y < floor) aboveFloor.push(row);
            if (withChat.y < Math.min(floor, alone.y)) raisedByDodge.push(row);
          }
        }
      }
    }
    expect(aboveFloor).toEqual([]);
    expect(raisedByDodge).toEqual([]);
  });

  it('never leaves the work area while dodging, at any band size or pet position (C14 still wins)', () => {
    const displays: Rect[] = [WA, { x: 1280, y: 0, width: 1920, height: 1040 }, { x: 0, y: 0, width: 1000, height: 600 }];
    const bad: string[] = [];
    for (const wa of displays) {
      for (const px of [wa.x, wa.x + 40, wa.x + wa.width / 2 - 210, wa.x + wa.width - 420]) {
        const pet = { x: px, y: wa.y + Math.max(0, wa.height - 720), width: 420, height: 720 };
        for (const chatSize of [CHAT_BASE, CHAT_SIX_ROWS, CHAT_HISTORY_OPEN]) {
          const chat = composer(chatSize, pet, wa);
          for (const size of everyBandSize()) {
            const p = placeBubble(pet, size, wa, preferredSideFor(pet, wa), chat);
            if (!insideWorkArea(p, size, wa)) bad.push(JSON.stringify({ wa, pet, chatSize, size, p }));
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('overlaps only when neither side of the composer has room — and then it is the work area\'s doing', () => {
    const displays: Rect[] = [WA, { x: 1280, y: 0, width: 1920, height: 1040 }, { x: 0, y: 0, width: 1000, height: 600 }];
    const unexplained: string[] = [];
    for (const wa of displays) {
      const waT = wa.y + BUBBLE_PADDING;
      const waB = wa.y + wa.height - BUBBLE_PADDING;
      for (const px of [wa.x, wa.x + 40, wa.x + wa.width / 2 - 210, wa.x + wa.width - 420]) {
        const pet = { x: px, y: wa.y + Math.max(0, wa.height - 720), width: 420, height: 720 };
        for (const chatSize of [CHAT_BASE, CHAT_SIX_ROWS, CHAT_HISTORY_OPEN]) {
          const chat = composer(chatSize, pet, wa);
          for (const size of everyBandSize()) {
            const p = placeBubble(pet, size, wa, preferredSideFor(pet, wa), chat);
            if (!overlap(rectOf(p, size), chat)) continue;
            const roomBelow = chat.y + chat.height + BUBBLE_GAP + size.height <= waB;
            // `waT` is not the only constraint above: fix round 2 made the 55 % floor outrank the
            // dodge, so "room above" means room above the FLOOR, not merely inside the work area.
            const roomAbove = chat.y - BUBBLE_GAP - size.height >= Math.max(waT, topFloor(pet));
            if (roomBelow || roomAbove) unexplained.push(JSON.stringify({ wa, pet, chatSize, size, p }));
          }
        }
      }
    }
    expect(unexplained).toEqual([]);
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
