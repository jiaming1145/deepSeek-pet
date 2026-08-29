import { describe, expect, it } from 'vitest';
import { Channels, MAIN_TO_RENDERER, parseEvent } from './index';

describe('protocol', () => {
  it('accepts a valid gaze:cursor event', () => {
    const r = parseEvent(Channels.gazeCursor, { x: 10, y: -3.5 });
    expect(r).toEqual({ ok: true, data: { x: 10, y: -3.5 } });
  });

  it('rejects an unknown channel', () => {
    const r = parseEvent('nope' as never, {});
    expect(r.ok).toBe(false);
  });

  it('rejects a malformed payload', () => {
    const r = parseEvent(Channels.avatarHover, { inside: 'yes' });
    expect(r.ok).toBe(false);
  });

  it('carries debug:toggle main→renderer with an empty payload', () => {
    expect(MAIN_TO_RENDERER).toContain(Channels.debugToggle);
    expect(parseEvent(Channels.debugToggle, {})).toEqual({ ok: true, data: {} });
  });
});

describe('numeric bounds', () => {
  it('accepts an ordinary avatar:drag delta', () => {
    expect(parseEvent(Channels.avatarDrag, { dx: -12, dy: 7.5 })).toEqual({ ok: true, data: { dx: -12, dy: 7.5 } });
  });

  it.each([
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['NaN', Number.NaN],
    ['MAX_VALUE', Number.MAX_VALUE],
    ['over-bound', 4097],
    ['under-bound', -4097],
  ])('rejects avatar:drag dx = %s', (_label, value) => {
    expect(parseEvent(Channels.avatarDrag, { dx: value, dy: 0 }).ok).toBe(false);
    expect(parseEvent(Channels.avatarDrag, { dx: 0, dy: value }).ok).toBe(false);
  });

  it('accepts avatar:drag exactly at the bound', () => {
    expect(parseEvent(Channels.avatarDrag, { dx: 4096, dy: -4096 }).ok).toBe(true);
  });

  it.each([
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('rejects non-finite gaze:cursor coordinates (%s)', (_label, value) => {
    expect(parseEvent(Channels.gazeCursor, { x: value, y: 0 }).ok).toBe(false);
    expect(parseEvent(Channels.gazeCursor, { x: 0, y: value }).ok).toBe(false);
  });

  it('keeps gaze:cursor unbounded in range — window-local coords go far outside the window', () => {
    expect(parseEvent(Channels.gazeCursor, { x: -8000, y: 12000 }).ok).toBe(true);
  });
});
