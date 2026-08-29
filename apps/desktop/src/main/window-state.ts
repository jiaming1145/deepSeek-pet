import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Rect = { x: number; y: number; width: number; height: number };
export type Pos = { x: number; y: number };
export type Size = { w: number; h: number };
export type Placement = Pos & Size;

/** Gap between the pet and the work-area edge when nothing is remembered yet. */
const INSET = 24;

/** Area of the overlap between a work area and a candidate window placement; 0 when disjoint. */
function overlapArea(area: Rect, pos: Placement): number {
  const w = Math.min(area.x + area.width, pos.x + pos.w) - Math.max(area.x, pos.x);
  const h = Math.min(area.y + area.height, pos.y + pos.h) - Math.max(area.y, pos.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Squared distance between the centres of a work area and a candidate placement. */
function centreDistance(area: Rect, pos: Placement): number {
  const dx = area.x + area.width / 2 - (pos.x + pos.w / 2);
  const dy = area.y + area.height / 2 - (pos.y + pos.h / 2);
  return dx * dx + dy * dy;
}

/**
 * Moves `pos` so the *whole* window is inside `area`.
 *
 * When the window is larger than the area on an axis there is no position that satisfies both
 * edges (`max < min`), so that axis is anchored at the area's origin: the top-left corner — which
 * carries the head and the tray-reachable part of the window — stays on screen.
 */
function clampInto(area: Rect, pos: Placement): Pos {
  const maxX = area.x + area.width - pos.w;
  const maxY = area.y + area.height - pos.h;
  return {
    x: maxX < area.x ? area.x : Math.min(Math.max(pos.x, area.x), maxX),
    y: maxY < area.y ? area.y : Math.min(Math.max(pos.y, area.y), maxY),
  };
}

/**
 * Picks a safe on-screen position for the pet window.
 *
 * `pos === null` (nothing remembered) → bottom-right of the first work area, {@link INSET} px in.
 * Otherwise the remembered position is clamped — *always*, not only when it is fully off screen:
 * a window whose centre is on a display can still have most of its body, and every draggable pixel,
 * hanging past the edge after a monitor is unplugged or the topology changes.
 *
 * `areas` are work areas (taskbar excluded), and `size` is the real window size — there are no
 * defaults, because a wrong assumed size is exactly what produces an off-screen "clamped" result.
 */
export function clampToDisplays(pos: Placement | null, areas: Rect[], size: Size): Pos {
  // No displays at all (a headless/racing enumeration): nothing sensible to clamp against.
  if (areas.length === 0) return pos ? { x: pos.x, y: pos.y } : { x: 0, y: 0 };

  if (!pos) {
    const first = areas[0];
    const initial = {
      x: first.x + first.width - size.w - INSET,
      y: first.y + first.height - size.h - INSET,
      ...size,
    };
    return clampInto(first, initial);
  }

  const wanted: Placement = { x: pos.x, y: pos.y, ...size };
  // Greatest overlap first: on a multi-monitor desktop that is the display the user last had her
  // on. Only when she overlaps nothing does distance decide, so a remembered position never jumps
  // to another monitor just because that monitor's centre happens to be closer.
  let best = areas[0];
  let bestOverlap = overlapArea(areas[0], wanted);
  let bestDistance = centreDistance(areas[0], wanted);
  for (const area of areas.slice(1)) {
    const overlap = overlapArea(area, wanted);
    const distance = centreDistance(area, wanted);
    if (overlap > bestOverlap || (overlap === 0 && bestOverlap === 0 && distance < bestDistance)) {
      best = area;
      bestOverlap = overlap;
      bestDistance = distance;
    }
  }
  return clampInto(best, wanted);
}

export function loadWindowState(file: string): Pos | null {
  try {
    if (!existsSync(file)) return null;
    const j = JSON.parse(readFileSync(file, 'utf8')) as Partial<Pos>;
    // `Number.isFinite`, not `typeof === 'number'`: JSON.parse turns `1e400` into Infinity and
    // `setPosition(Infinity, …)` throws, taking startup down.
    return Number.isFinite(j.x) && Number.isFinite(j.y) ? { x: j.x as number, y: j.y as number } : null;
  } catch {
    return null;
  }
}

export function saveWindowState(file: string, pos: Pos): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(pos));
}
