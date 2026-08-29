import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clampToDisplays, loadWindowState, saveWindowState } from './window-state';

// Work areas, not bounds: 1080 tall displays with a 40 px taskbar on the primary.
const areas = [
  { x: 0, y: 0, width: 1920, height: 1040 },
  { x: 1920, y: 0, width: 1920, height: 1040 },
];
const PET = { w: 420, h: 720 };

describe('clampToDisplays', () => {
  it('keeps a position that is fully on a display', () => {
    expect(clampToDisplays({ x: 2000, y: 100, ...PET }, areas, PET)).toEqual({ x: 2000, y: 100 });
  });

  it('pulls a fully off-screen window back onto the nearest work area', () => {
    const p = clampToDisplays({ x: 5000, y: 100, ...PET }, areas, PET);
    expect(p.x + PET.w).toBeLessThanOrEqual(3840);
    expect(p.x).toBeGreaterThanOrEqual(1920);
  });

  it('moves a window whose centre is on screen but whose edges hang off', () => {
    // Centre (10 + 210, -300 + 360) = (220, 60) is on display 1, but the top 300 px and 200 px of
    // the left edge are off screen — the old centre-only test returned this unchanged.
    const p = clampToDisplays({ x: -200, y: -300, ...PET }, areas, PET);
    expect(p).toEqual({ x: 0, y: 0 });
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
  });

  it('clamps the bottom-right edges back on screen', () => {
    const single = [areas[0]];
    expect(clampToDisplays({ x: 1800, y: 900, ...PET }, single, PET)).toEqual({ x: 1920 - 420, y: 1040 - 720 });
  });

  it('anchors at the work-area origin when the pet is larger than the area', () => {
    const tiny = [{ x: 100, y: 50, width: 300, height: 400 }];
    expect(clampToDisplays({ x: 200, y: 200, ...PET }, tiny, PET)).toEqual({ x: 100, y: 50 });
  });

  it('picks the work area it overlaps most when it straddles two', () => {
    // 1800..2220: 120 px on the left area, 300 px on the right → snapped right.
    expect(clampToDisplays({ x: 1800, y: 100, ...PET }, areas, PET)).toEqual({ x: 1920, y: 100 });
    // 1600..2020: 320 px on the left area, 100 px on the right → snapped left.
    expect(clampToDisplays({ x: 1600, y: 100, ...PET }, areas, PET)).toEqual({ x: 1920 - 420, y: 100 });
  });

  it('places a fresh window bottom-right with a 24 px inset when it fits', () => {
    expect(clampToDisplays(null, areas, PET)).toEqual({ x: 1920 - 420 - 24, y: 1040 - 720 - 24 });
  });

  it('anchors a fresh window at the origin when the inset placement does not fit', () => {
    const tiny = [{ x: 0, y: 0, width: 300, height: 400 }];
    expect(clampToDisplays(null, tiny, PET)).toEqual({ x: 0, y: 0 });
  });

  it('survives an empty display list instead of throwing', () => {
    expect(clampToDisplays({ x: 7, y: 9, ...PET }, [], PET)).toEqual({ x: 7, y: 9 });
    expect(clampToDisplays(null, [], PET)).toEqual({ x: 0, y: 0 });
  });
});

describe('loadWindowState / saveWindowState', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ds-window-state-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the file does not exist', () => {
    expect(loadWindowState(join(dir, 'nope', 'window.json'))).toBeNull();
  });

  it('round-trips a saved position, creating the directory', () => {
    const file = join(dir, 'nested', 'window.json');
    saveWindowState(file, { x: 12, y: 34 });
    expect(loadWindowState(file)).toEqual({ x: 12, y: 34 });
  });

  it('returns null for corrupt or incomplete state instead of throwing', () => {
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{not json');
    expect(loadWindowState(bad)).toBeNull();
    const partial = join(dir, 'partial.json');
    writeFileSync(partial, '{"x":10}');
    expect(loadWindowState(partial)).toBeNull();
  });

  it('rejects a non-finite remembered position (JSON 1e400 parses to Infinity)', () => {
    const overflow = join(dir, 'overflow.json');
    writeFileSync(overflow, '{"x":1e400,"y":0}');
    expect(JSON.parse('{"x":1e400}').x).toBe(Number.POSITIVE_INFINITY); // the shape of the hazard
    expect(loadWindowState(overflow)).toBeNull();

    const nan = join(dir, 'nan.json');
    writeFileSync(nan, '{"x":0,"y":-1e400}');
    expect(loadWindowState(nan)).toBeNull();
  });
});
