import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Rect = { x: number; y: number; width: number; height: number };
export type Pos = { x: number; y: number };

/**
 * Picks a safe on-screen position for the pet window.
 * `pos === null` (nothing remembered) → bottom-right of the first display, 24px inset.
 */
export function clampToDisplays(
  pos: { x: number; y: number; w: number; h: number } | null,
  displays: Rect[],
  size?: { w: number; h: number },
): Pos {
  const d0 = displays[0];
  if (!pos) {
    const w = size?.w ?? 400;
    const h = size?.h ?? 700;
    return { x: d0.x + d0.width - w - 24, y: d0.y + d0.height - h - 24 };
  }
  const cx = pos.x + pos.w / 2;
  const cy = pos.y + pos.h / 2;
  const on = displays.find((d) => cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height);
  if (on) return { x: pos.x, y: pos.y };
  // nearest display by centre distance
  const nearest = displays.reduce(
    (best, d) => {
      const dx = d.x + d.width / 2 - cx;
      const dy = d.y + d.height / 2 - cy;
      const dist = dx * dx + dy * dy;
      return dist < best.dist ? { d, dist } : best;
    },
    { d: d0, dist: Number.POSITIVE_INFINITY },
  ).d;
  return {
    x: Math.min(Math.max(pos.x, nearest.x), nearest.x + nearest.width - pos.w),
    y: Math.min(Math.max(pos.y, nearest.y), nearest.y + nearest.height - pos.h),
  };
}

export function loadWindowState(file: string): Pos | null {
  try {
    if (!existsSync(file)) return null;
    const j = JSON.parse(readFileSync(file, 'utf8')) as Partial<Pos>;
    return typeof j.x === 'number' && typeof j.y === 'number' ? { x: j.x, y: j.y } : null;
  } catch {
    return null;
  }
}

export function saveWindowState(file: string, pos: Pos): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(pos));
}
