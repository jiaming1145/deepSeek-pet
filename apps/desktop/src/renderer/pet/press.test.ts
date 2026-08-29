import { describe, expect, it } from 'vitest';
import { PressTracker, tapCandidates, type PressEvent } from './press';

/** Records everything the tracker emits, so each test asserts on the whole emission log. */
function harness(opts: { hit?: (x: number, y: number) => string | null; rejected?: (t: EventTarget | null) => boolean } = {}) {
  const log: string[] = [];
  const tracker = new PressTracker({
    hitTest: opts.hit ?? ((x, y) => (x >= 100 && x < 300 && y >= 100 && y < 300 ? 'Head' : null)),
    slopPx: 4,
    onTap: (hit) => log.push(`tap:${hit}`),
    onDragStart: () => log.push('dragStart'),
    onDragMove: (dx, dy) => log.push(`dragMove:${dx},${dy}`),
    onDragEnd: () => log.push('dragEnd'),
    isRejected: opts.rejected ?? (() => false),
  });
  return { tracker, log };
}

/** A left-button event at one point; screen coordinates default to the client ones. */
function ev(p: Partial<PressEvent> & { clientX: number; clientY: number }): PressEvent {
  return {
    button: 0,
    buttons: 1,
    screenX: p.screenX ?? p.clientX,
    screenY: p.screenY ?? p.clientY,
    target: null,
    ...p,
  };
}

describe('PressTracker', () => {
  it('taps when a press on the model is released without moving', () => {
    const { tracker, log } = harness();
    tracker.mousedown(ev({ clientX: 200, clientY: 200 }));
    tracker.mouseup(ev({ clientX: 200, clientY: 200 }));
    expect(log).toEqual(['dragStart', 'tap:Head']);
  });

  it('still taps for jitter below the slop', () => {
    const { tracker, log } = harness();
    tracker.mousedown(ev({ clientX: 200, clientY: 200 }));
    tracker.mousemove(ev({ clientX: 201, clientY: 200 }));
    tracker.mouseup(ev({ clientX: 201, clientY: 200 }));
    expect(log).toEqual(['dragStart', 'dragMove:1,0', 'dragEnd', 'tap:Head']);
  });

  it('does not tap when a drag past the slop is released (the drag-release defect)', () => {
    const { tracker, log } = harness();
    tracker.mousedown(ev({ clientX: 200, clientY: 200 }));
    tracker.mousemove(ev({ clientX: 210, clientY: 200 }));
    tracker.mousemove(ev({ clientX: 220, clientY: 205 }));
    tracker.mouseup(ev({ clientX: 220, clientY: 205 }));
    expect(log).toEqual(['dragStart', 'dragMove:10,0', 'dragMove:10,5', 'dragEnd']);
    expect(log).not.toContain('tap:Head');
  });

  it('clears the drag on a mousemove with buttons === 0 (mouseup off-window)', () => {
    const { tracker, log } = harness();
    tracker.mousedown(ev({ clientX: 200, clientY: 200 }));
    tracker.mousemove(ev({ clientX: 260, clientY: 200 }));
    // Button released where we never saw the mouseup: the next move reports buttons === 0.
    tracker.mousemove(ev({ clientX: 400, clientY: 400, buttons: 0 }));
    expect(log).toEqual(['dragStart', 'dragMove:60,0', 'dragEnd']);
    // The drag really is gone: further motion must not move the window again.
    tracker.mousemove(ev({ clientX: 500, clientY: 500 }));
    expect(log).toEqual(['dragStart', 'dragMove:60,0', 'dragEnd']);
    // ...and the late mouseup must not fire a second terminator or a tap.
    tracker.mouseup(ev({ clientX: 200, clientY: 200 }));
    expect(log).toEqual(['dragStart', 'dragMove:60,0', 'dragEnd']);
  });

  it('does not tap for a press that started on a rejected target, wherever it is released', () => {
    const panel = { panel: true } as unknown as EventTarget;
    const { tracker, log } = harness({ rejected: (t) => t === panel });
    // Press the debug panel, release over the model (the panel can overlap her silhouette).
    tracker.mousedown(ev({ clientX: 200, clientY: 200, target: panel }));
    tracker.mouseup(ev({ clientX: 200, clientY: 200, target: null }));
    expect(log).toEqual([]);
    // Releasing over the panel after pressing the model must not tap either.
    tracker.mousedown(ev({ clientX: 200, clientY: 200, target: null }));
    tracker.mouseup(ev({ clientX: 200, clientY: 200, target: panel }));
    expect(log).toEqual(['dragStart']);
  });

  it('ignores non-left buttons and presses that miss the model', () => {
    const { tracker, log } = harness();
    tracker.mousedown(ev({ clientX: 200, clientY: 200, button: 2 }));
    tracker.mouseup(ev({ clientX: 200, clientY: 200, button: 2 }));
    tracker.mousedown(ev({ clientX: 10, clientY: 10 }));
    tracker.mousemove(ev({ clientX: 90, clientY: 10 }));
    expect(log).toEqual([]);
  });
});

describe('tapCandidates', () => {
  it('flattens every group rather than only the first', () => {
    expect(tapCandidates({ TapBody: [0, 1], TapHead: [2] })).toEqual([
      ['TapBody', 0],
      ['TapBody', 1],
      ['TapHead', 2],
    ]);
  });

  it('returns nothing for {} and for a hit area with no mapping', () => {
    expect(tapCandidates({})).toEqual([]);
    expect(tapCandidates(undefined)).toEqual([]);
    expect(() => tapCandidates({})).not.toThrow();
  });

  it('drops groups with an empty index list', () => {
    expect(tapCandidates({ TapBody: [], TapHead: [3] })).toEqual([['TapHead', 3]]);
  });
});

describe('PressTracker — press that starts off the model', () => {
  it('does not tap when the button is released over her', () => {
    const { tracker, log } = harness();
    tracker.mousedown(ev({ clientX: 10, clientY: 10 })); // transparent corner
    tracker.mousemove(ev({ clientX: 150, clientY: 150 }));
    tracker.mouseup(ev({ clientX: 150, clientY: 150 })); // over Head
    expect(log).toEqual([]);
  });

  it('still taps on the next clean press on her', () => {
    const { tracker, log } = harness();
    tracker.mousedown(ev({ clientX: 10, clientY: 10 }));
    tracker.mouseup(ev({ clientX: 150, clientY: 150 }));
    tracker.mousedown(ev({ clientX: 150, clientY: 150 }));
    tracker.mouseup(ev({ clientX: 150, clientY: 150 }));
    expect(log).toEqual(['dragStart', 'tap:Head']);
  });
});
