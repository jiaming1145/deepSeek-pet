import { describe, expect, it, vi } from 'vitest';
import type { HitPart } from '@ds/protocol';
import { PressTracker, tapCandidates, type PressEvent } from './press';

// The real @ds/stage BARREL pulls in the vendored Cubism Framework (`@framework/*`), which only
// electron.vite.config.ts aliases — the same reason debug-panel.test.ts mocks it. press.ts needs a
// single constant from that package, so the mock hands back the REAL picker module (its one
// @framework import is type-only, so it transforms cleanly) rather than a re-declared 10.
vi.mock('@ds/stage', async () => await vi.importActual('../../../../../packages/stage/src/picker'));

/** Records everything the tracker emits, so each test asserts on the whole emission log. */
function harness(opts: { rejected?: (t: EventTarget | null) => boolean; part?: HitPart | null } = {}) {
  const log: string[] = [];
  const tracker = new PressTracker({
    slopPx: 4,
    toDevice: (x, y) => ({ x: x * 1.5, y: y * 1.5 }),
    queuePress: (p) => log.push(`queue#${p.pressId}:${p.deviceX},${p.deviceY}`),
    pick: (x, y) => ({ alpha: opts.part === null ? 0 : 200, part: opts.part === undefined ? 'head' : opts.part, modelX: x / 400, modelY: y / 400 }),
    hitPartDefault: 'body',
    onGrab: (g) => log.push(`grab#${g.pressId}:${g.part}@${g.screenX},${g.screenY}`),
    onRelease: (r) => log.push(`release#${r.pressId}:${r.wasTap ? 'tap' : 'fling'}`),
    onTap: (t) => log.push(`tap#${t.pressId}:${t.part}:${t.alpha}`),
    onDisagreement: (d) => log.push(`disagree:${d}`),
    isRejected: opts.rejected ?? (() => false),
  });
  return { tracker, log };
}

function ev(p: Partial<PressEvent> & { clientX: number; clientY: number }): PressEvent {
  return { button: 0, buttons: 1, screenX: p.screenX ?? p.clientX, screenY: p.screenY ?? p.clientY, target: null, ...p };
}

describe('PressTracker — §7.2 grab / release over the 1-px GPU read', () => {
  it('queues the press on pointer-down, grabs on alpha >= ENTER_ALPHA, taps on a still release', () => {
    const { tracker, log } = harness();
    tracker.mousedown(ev({ clientX: 200, clientY: 200 }));
    expect(log).toEqual(['queue#1:300,300']);
    tracker.resolvePress(1, 42);
    expect(log).toEqual(['queue#1:300,300', 'grab#1:head@200,200']);
    tracker.mouseup(ev({ clientX: 200, clientY: 200 }));
    expect(log.slice(2)).toEqual(['release#1:tap', 'tap#1:head:42']);
  });

  it('sends nothing for alpha below ENTER_ALPHA (off-model), and a release over her later is not a tap', () => {
    const { tracker, log } = harness();
    tracker.mousedown(ev({ clientX: 10, clientY: 10 }));
    tracker.resolvePress(1, 3);
    tracker.mousemove(ev({ clientX: 150, clientY: 150 }));
    tracker.mouseup(ev({ clientX: 150, clientY: 150 }));
    expect(log).toEqual(['queue#1:15,15']);
  });

  it('a tap that ends before the GPU read resolves still grabs, releases as a tap, and taps — in that order', () => {
    const { tracker, log } = harness();
    tracker.mousedown(ev({ clientX: 200, clientY: 200 }));
    tracker.mouseup(ev({ clientX: 201, clientY: 200 }));
    expect(log).toEqual(['queue#1:300,300']);
    tracker.resolvePress(1, 255);
    expect(log.slice(1)).toEqual(['grab#1:head@200,200', 'release#1:tap', 'tap#1:head:255']);
  });

  it('travel >= TAP_SLOP_DIP releases as a fling and never taps (the drag-release defect)', () => {
    const { tracker, log } = harness();
    tracker.mousedown(ev({ clientX: 200, clientY: 200 }));
    tracker.resolvePress(1, 200);
    tracker.mousemove(ev({ clientX: 210, clientY: 200 }));
    tracker.mouseup(ev({ clientX: 220, clientY: 205 }));
    expect(log.slice(2)).toEqual(['release#1:fling']);
  });

  it('a mousemove with buttons === 0 ends the press (mouseup off-window); the late mouseup is consumed', () => {
    const { tracker, log } = harness();
    tracker.mousedown(ev({ clientX: 200, clientY: 200 }));
    tracker.resolvePress(1, 200);
    tracker.mousemove(ev({ clientX: 260, clientY: 200 }));
    tracker.mousemove(ev({ clientX: 400, clientY: 400, buttons: 0 }));
    expect(log.slice(2)).toEqual(['release#1:fling']);
    tracker.mousemove(ev({ clientX: 500, clientY: 500 }));
    tracker.mouseup(ev({ clientX: 200, clientY: 200 }));
    expect(log.slice(2)).toEqual(['release#1:fling']);
  });

  it('a stale GPU result for a superseded press is ignored', () => {
    const { tracker, log } = harness();
    tracker.mousedown(ev({ clientX: 200, clientY: 200 }));
    tracker.mouseup(ev({ clientX: 200, clientY: 200 }));
    tracker.mousedown(ev({ clientX: 100, clientY: 100 }));
    tracker.resolvePress(1, 255);
    expect(log).toEqual(['queue#1:300,300', 'queue#2:150,150']);
    tracker.resolvePress(2, 255);
    expect(log.at(-1)).toBe('grab#2:head@100,100');
  });

  it('GPU on-model but CPU off-model: the GPU wins, the part falls back to hitPartDefault and the delta is reported', () => {
    const { tracker, log } = harness({ part: null });
    tracker.mousedown(ev({ clientX: 200, clientY: 200 }));
    tracker.resolvePress(1, 30);
    expect(log.slice(1)).toEqual(['disagree:30', 'grab#1:body@200,200']);
  });

  it('a press on a rejected target neither queues nor taps, wherever it is released', () => {
    const panel = { panel: true } as unknown as EventTarget;
    const { tracker, log } = harness({ rejected: (t) => t === panel });
    tracker.mousedown(ev({ clientX: 200, clientY: 200, target: panel }));
    tracker.mouseup(ev({ clientX: 200, clientY: 200 }));
    expect(log).toEqual([]);
    tracker.mousedown(ev({ clientX: 200, clientY: 200 }));
    tracker.resolvePress(2, 200);
    tracker.mouseup(ev({ clientX: 200, clientY: 200, target: panel }));
    expect(log).toEqual(['queue#2:300,300', 'grab#2:head@200,200', 'release#2:tap']);
  });

  it('a new press while one is still grabbed releases the old one first, as a fling (fix round 1)', () => {
    const { tracker, log } = harness();
    tracker.mousedown(ev({ clientX: 200, clientY: 200 }));
    tracker.resolvePress(1, 200);
    // The mouseup never arrives (lost outside the window) and no mousemove reports buttons === 0.
    tracker.mousedown(ev({ clientX: 100, clientY: 100 }));
    // Every grab is paired: without this, arb:grab#1 had no arb:release and main's motor kept the window.
    expect(log.slice(2)).toEqual(['release#1:fling', 'queue#2:150,150']);
    tracker.resolvePress(2, 200);
    tracker.mouseup(ev({ clientX: 100, clientY: 100 }));
    expect(log.slice(4)).toEqual(['grab#2:head@100,100', 'release#2:tap', 'tap#2:head:200']);
  });

  it('ignores non-left buttons', () => {
    const { tracker, log } = harness();
    tracker.mousedown(ev({ clientX: 200, clientY: 200, button: 2 }));
    tracker.mouseup(ev({ clientX: 200, clientY: 200, button: 2 }));
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
