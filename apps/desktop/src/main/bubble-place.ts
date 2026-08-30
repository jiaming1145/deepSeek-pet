// D3 discipline: ONE definition of `Side`. `SideSchema`/`Side` live in @ds/protocol (§2.2); this is
// a re-export, never a second `type Side = 'top' | 'right' | 'bottom' | 'left'`.
import type { Side } from '@ds/protocol';

export type { Side };

export interface Rect { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }
export interface Placement { x: number; y: number; side: Side; arrowOffset: number }

/**
 * addendum C6 offset(12). The band geometry does not use it as a gap to HER — the band overlaps her
 * body, she stands in its right third — but it is the gap the band leaves when it steps clear of the
 * composer (`avoid`, below). The composer's own `CHAT_GAP` in `renderer/shared/chat-metrics.ts` is a
 * separate constant.
 */
export const BUBBLE_GAP = 12;
export const BUBBLE_PADDING = 16; // addendum C6 shift({ padding: 16 })
export const BUBBLE_MAX: Size = { width: 460, height: 320 }; // R3 — sized by content up to 460x320 DIP
export const BUBBLE_MIN: Size = { width: 120, height: 44 };
export const ARROW_MARGIN = 18;

/**
 * The band's vertical CENTRE, as a fraction of the pet window's height.
 *
 * Task 0's direction contract (`task-0-direction.md`, FIRST VIEWPORT; `DESIGN.md`): "the band sits
 * over her LOWER THIRD, extending LEFT from her body so she stands in its right third". 0.72 is
 * inside that lower third (0.667–1.0). The retired `HEAD_ANCHOR = {x: 0.5, y: 0.18}` centred the
 * band on her FACE, which is the defect `desktop-chat-over-pet.png` and `task6-fake-brain-run.png`
 * recorded and which this constant replaces.
 */
export const BAND_ANCHOR_Y = 0.72;

/**
 * Hard floor for the band's TOP edge, as a fraction of the pet window's height: the window never
 * starts above 55 % of the pet. This is what keeps her face clear for a tall band — a 6-line band
 * centred on 0.72 would otherwise reach up past her collar.
 *
 * It yields to the work area: C14 ("never crosses the pet's display work area") is a contract, this
 * is a composition rule, and a window too tall to fit between this floor and the work-area bottom
 * is placed against the work area instead. `bubble-place.test.ts` pins both halves.
 */
export const BAND_TOP_MAX_FRACTION = 0.55;

/**
 * Where the pet's horizontal centre sits inside the band, as a fraction of the band's width, when
 * the band extends LEFT: 0.80 puts her in the band's right third (0.667–1.0) at every band width.
 * Mirrored to `1 - BAND_PET_FRACTION` when the band flips right.
 */
export const BAND_PET_FRACTION = 0.8;

const OPPOSITE_BAND: Record<'left' | 'right', 'left' | 'right'> = { left: 'right', right: 'left' };

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * The direction contract's preferred side is LEFT — always, at every pet position — and right is
 * the fallback taken only when the work area has no room. This deliberately does NOT pick "the
 * roomier half of the screen" the way the retired implementation did: a pet dragged to the left
 * half must still speak leftwards while a minimum band fits there, otherwise the band flips sides
 * halfway across the desktop for no reason the user can see.
 *
 * `placeBubble` re-tests the fit against the ACTUAL band size, so this is a hint, not the decision.
 */
export function preferredSideFor(pet: Rect, workArea: Rect): Side {
  const roomLeft = pet.x + pet.width * BAND_PET_FRACTION - (workArea.x + BUBBLE_PADDING);
  return roomLeft >= BUBBLE_MIN.width ? 'left' : 'right';
}

/** True when the two rects share any pixel. */
const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Pure band placement in DIP screen coordinates — the same space `BrowserWindow.getBounds()` and
 * `Display.workArea` use. Both the bubble window and the chat window go through it, so the composer
 * opens on the band's rect rather than somewhere of its own (controller ruling, 2026-08-29).
 *
 * `workArea` MUST come from `screen.getDisplayMatching(petBounds).workArea`, never from the primary
 * display: on a mixed-DPI desktop the primary's work area would clamp the band onto the wrong
 * monitor. That single argument is what makes C14 true (test E).
 *
 * `avoid` is a rect this window must not share pixels with — in practice the VISIBLE composer, and
 * only ever passed for the band. "The composer and the band are one object in two states" is the
 * ruling, but §6.2 rule 4 keeps the composer open through her whole reply and rule 6 needs it open
 * to restore the text on an error, so both windows really are on screen at once; without this the
 * two always-on-top surfaces render two different texts into the same rectangle
 * (`docs/evidence/phase2/app-placement.png` is that defect). The COMPOSER keeps the band's rect —
 * it is the anchor the ruling names — and the band steps below it, or above it when the work area
 * has no room below. Passing `null` reproduces the pre-fix geometry exactly.
 */
export function placeBubble(
  pet: Rect,
  size: Size,
  workArea: Rect,
  preferredSide: Side,
  avoid: Rect | null = null,
): Placement {
  const petCx = pet.x + pet.width / 2;
  const bandCy = pet.y + pet.height * BAND_ANCHOR_Y;
  const topFloor = pet.y + pet.height * BAND_TOP_MAX_FRACTION;

  const waL = workArea.x + BUBBLE_PADDING;
  const waR = workArea.x + workArea.width - BUBBLE_PADDING;
  const waT = workArea.y + BUBBLE_PADDING;
  const waB = workArea.y + workArea.height - BUBBLE_PADDING;

  // The lowest top edge the work area allows. `max(waT, …)` keeps the range non-negative when the
  // window is taller than the work area, which top-aligns it instead of producing a reversed clamp.
  const yMax = Math.max(waT, waB - size.height);
  let y = clamp(Math.max(bandCy - size.height / 2, topFloor), waT, yMax);

  const xFor = (side: Side): number =>
    side === 'right'
      ? petCx - size.width * (1 - BAND_PET_FRACTION)
      : petCx - size.width * BAND_PET_FRACTION;

  // `preferredSide` may arrive as 'top'/'bottom' from a caller that predates the band geometry;
  // anything that is not 'right' means the direction contract's default, left.
  const first: 'left' | 'right' = preferredSide === 'right' ? 'right' : 'left';
  const order: ('left' | 'right')[] = [first, OPPOSITE_BAND[first]];
  const fitsX = (x: number): boolean => x >= waL && x + size.width <= waR;

  let side: Side = order[0];
  let x = xFor(side);
  for (const candidate of order) {
    const cx = xFor(candidate);
    if (fitsX(cx)) {
      side = candidate;
      x = cx;
      break;
    }
  }
  // Neither side fits (a band wider than the room either way): keep the preferred side and shift in.
  if (!fitsX(x)) x = clamp(x, waL, Math.max(waL, waR - size.width));

  // Step clear of the composer, vertically — the same flip-then-shift discipline the horizontal
  // axis uses. Below first: her line reads under your line, and it keeps the band lower on her body
  // rather than pushing it back up towards her face.
  if (avoid !== null && intersects({ x, y, ...size }, avoid)) {
    const below = avoid.y + avoid.height + BUBBLE_GAP;
    const above = avoid.y - BUBBLE_GAP - size.height;
    // The above branch is gated on the 55 % floor as well as the work area. Without that guard the
    // dodge undoes the placement ruling this file exists to satisfy: the composer with its history
    // pane open (468 DIP) is always clamped against the work-area bottom, so there is NEVER room
    // below it, and every band would flip up onto her face — a 460x320 band landed at y = 224,
    // entirely above the pet window. The floor is the composition rule the controller ruled on; the
    // dodge is a courtesy. The floor wins.
    if (below + size.height <= waB) y = below;
    else if (above >= Math.max(waT, topFloor)) y = above;
    // Neither: this column cannot hold both windows below the floor and inside the work area. C14
    // and the 55 % floor both outrank the dodge, so the band keeps step 2's row and the two overlap
    // — the pre-fix behaviour, in the one case where there is nowhere else to put it.
    // `bubble-place.test.ts` pins that this is the ONLY such case.
  }

  // The notch sits on the pet-facing vertical edge, at the band's anchor row.
  const arrowOffset = clamp(bandCy - y, ARROW_MARGIN, Math.max(ARROW_MARGIN, size.height - ARROW_MARGIN));

  // Rounded last: the fit tests run on exact values, Electron's setBounds takes integers.
  return { x: Math.round(x), y: Math.round(y), side, arrowOffset: Math.round(arrowOffset) };
}

