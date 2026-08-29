import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clampToDisplays, loadWindowState, saveWindowState } from './window-state';

const displays = [
  { x: 0, y: 0, width: 1920, height: 1080 },
  { x: 1920, y: 0, width: 1920, height: 1080 },
];

describe('clampToDisplays', () => {
  it('keeps a position that is on a display', () => {
    expect(clampToDisplays({ x: 2000, y: 100, w: 400, h: 700 }, displays)).toEqual({ x: 2000, y: 100 });
  });

  it('pulls a fully off-screen window back onto the nearest display', () => {
    const p = clampToDisplays({ x: 5000, y: 100, w: 400, h: 700 }, displays);
    expect(p.x + 400).toBeLessThanOrEqual(3840);
    expect(p.x).toBeGreaterThanOrEqual(1920);
  });

  it('falls back to bottom-right of the first display when nothing is known', () => {
    expect(clampToDisplays(null, displays, { w: 400, h: 700 })).toEqual({ x: 1920 - 400 - 24, y: 1080 - 700 - 24 });
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
});
