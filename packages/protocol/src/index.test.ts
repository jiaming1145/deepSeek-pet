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
