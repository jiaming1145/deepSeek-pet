// D3 discipline: ONE definition of `Side`. `SideSchema`/`Side` live in @ds/protocol (§2.2); this is
// a re-export, never a second `type Side = 'top' | 'right' | 'bottom' | 'left'`.
import type { Side } from '@ds/protocol';

export type { Side };

export interface Rect { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }
export interface Placement { x: number; y: number; side: Side; arrowOffset: number }

export const BUBBLE_GAP = 12; // addendum C6 offset(12)
export const BUBBLE_PADDING = 16; // addendum C6 shift({ padding: 16 })
export const BUBBLE_MAX: Size = { width: 460, height: 320 }; // R3 — sized by content up to 460x320 DIP
export const BUBBLE_MIN: Size = { width: 120, height: 44 };
export const ARROW_MARGIN = 18;
export const HEAD_ANCHOR = { x: 0.5, y: 0.18 } as const; // fraction of petBounds

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const ALL_SIDES: readonly Side[] = ['left', 'right', 'top', 'bottom'];

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * Which side has more room. Main calls it on every placement, so a pet dragged across the screen
 * flips the bubble to the roomier side instead of honouring a stale preference.
 */
export function preferredSideFor(pet: Rect, workArea: Rect): Side {
  return pet.x + pet.width / 2 > workArea.x + workArea.width / 2 ? 'left' : 'right';
}

/**
 * Pure flip/shift placement in DIP screen coordinates — the same space `BrowserWindow.getBounds()`
 * and `Display.workArea` use.
 *
 * `workArea` MUST come from `screen.getDisplayMatching(petBounds).workArea`, never from the primary
 * display: on a mixed-DPI desktop the primary's work area would clamp the bubble onto the wrong
 * monitor. That single argument is what makes C14 true (test E).
 */
export function placeBubble(pet: Rect, size: Size, workArea: Rect, preferredSide: Side): Placement {
  const ax = pet.x + pet.width * HEAD_ANCHOR.x;
  const ay = pet.y + pet.height * HEAD_ANCHOR.y;

  const order: Side[] = [
    preferredSide,
    OPPOSITE[preferredSide],
    ...ALL_SIDES.filter((s) => s !== preferredSide && s !== OPPOSITE[preferredSide]),
  ];

  const originFor = (side: Side): { x: number; y: number } => {
    if (side === 'top') return { x: ax - size.width / 2, y: ay - BUBBLE_GAP - size.height };
    if (side === 'bottom') return { x: ax - size.width / 2, y: ay + BUBBLE_GAP };
    if (side === 'left') return { x: pet.x - BUBBLE_GAP - size.width, y: ay - size.height / 2 };
    return { x: pet.x + pet.width + BUBBLE_GAP, y: ay - size.height / 2 };
  };

  const waL = workArea.x + BUBBLE_PADDING;
  const waR = workArea.x + workArea.width - BUBBLE_PADDING;
  const waT = workArea.y + BUBBLE_PADDING;
  const waB = workArea.y + workArea.height - BUBBLE_PADDING;
  const fits = (o: { x: number; y: number }): boolean =>
    o.x >= waL && o.x + size.width <= waR && o.y >= waT && o.y + size.height <= waB;

  // flip(): the first candidate that fits wins. If none fit, keep candidate[0] and shift it in.
  let side: Side = order[0];
  let origin = originFor(side);
  for (const candidate of order) {
    const o = originFor(candidate);
    if (fits(o)) {
      side = candidate;
      origin = o;
      break;
    }
  }

  let { x, y } = origin;
  if (!fits(origin)) {
    // The max(...) keeps the range non-negative when the bubble is wider or taller than the work
    // area, which left/top-aligns it instead of producing a reversed clamp.
    x = clamp(origin.x, waL, Math.max(waL, waR - size.width));
    y = clamp(origin.y, waT, Math.max(waT, waB - size.height));
  }

  const arrowOffset =
    side === 'top' || side === 'bottom'
      ? clamp(ax - x, ARROW_MARGIN, size.width - ARROW_MARGIN)
      : clamp(ay - y, ARROW_MARGIN, size.height - ARROW_MARGIN);

  // Rounded last: the fit test runs on exact values, Electron's setBounds takes integers.
  return { x: Math.round(x), y: Math.round(y), side, arrowOffset: Math.round(arrowOffset) };
}
