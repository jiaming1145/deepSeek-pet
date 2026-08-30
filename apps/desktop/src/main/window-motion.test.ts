import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Landing, WindowMotion } from '@ds/protocol';
import { createMotionHarness, runStaleGeneration } from '../../tests/fixtures/motion/stale-generation.fixture';
import { runDisplayUnplug } from '../../tests/fixtures/motion/display-unplug.fixture';
import { runRendererReload } from '../../tests/fixtures/arbiter/renderer-reload.fixture';

// pet-window.ts (PET_SIZE) imports electron at module load; the motor never touches these objects.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ds-test-userdata', isPackaged: false },
  screen: { getAllDisplays: () => [] },
  BrowserWindow: class {},
}));

const {
  MOTOR_HZ, MOTOR_SUBSTEP_S, MOTOR_FRAME_CLAMP_S, SNAPSHOT_HZ, DRAG_MAX_LAG_DIP, FLING_VELOCITY_CAP,
  REST_SPEED_DIP_S, WALK_SPEED_DIP_S, WALK_COOLDOWN_MS, LANDING_MIN_IMPULSE, walkTarget,
} = await import('./window-motion');

const FRAME_MS = 17; // integer so the fake setInterval(1000/60) fires once per advance
const AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const FLOOR_Y = AREA.height - 720; // 320
const RIGHT_X = AREA.width - 420; // 1500

function make(opts: { pos?: [number, number]; areas?: typeof AREA[] } = {}) {
  return createMotionHarness({
    pos: opts.pos ?? [600, 100],
    areas: opts.areas ?? [AREA],
    frameMs: FRAME_MS,
    advance: (ms) => vi.advanceTimersByTime(ms),
  });
}

/** Presses at `cursor`, drags with `dx`/`dy` per frame for `frames` frames, then releases. */
function throwHer(h: ReturnType<typeof make>, dx: number, dy: number, frames: number, wasTap = false) {
  h.setCursor(700, 200);
  h.ctl.grab({ pressId: 1, modelX: 0, modelY: 0, screenX: 700, screenY: 200 });
  for (let i = 0; i < frames; i++) {
    h.setCursor(h.cursor().x + dx, h.cursor().y + dy);
    h.frame();
  }
  h.ctl.release({ pressId: 1, wasTap });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('constants (§7.3)', () => {
  it('pins the motor rates', () => {
    expect(MOTOR_HZ).toBe(60);
    expect(MOTOR_SUBSTEP_S).toBe(1 / 120);
    expect(MOTOR_FRAME_CLAMP_S).toBe(0.25);
    expect(SNAPSHOT_HZ).toBe(30);
  });
});

describe('grab / drag (§7.2, §7.4)', () => {
  it('starts a generation, suspends hover switching, keeps the window interactive, starts the motor', () => {
    const h = make();
    expect(vi.getTimerCount()).toBe(0);
    h.ctl.grab({ pressId: 1, modelX: 0.2, modelY: -0.4, screenX: 700, screenY: 200 });
    expect(h.ctl.generation).toBe(1);
    expect(h.ctl.phase).toBe('drag');
    expect(h.suspend).toEqual([true]);
    expect(h.clickThrough).toEqual([false]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('follows the GLOBAL cursor with the spring and never lags more than DRAG_MAX_LAG_DIP', () => {
    const h = make({ pos: [600, 100] });
    h.setCursor(700, 200);
    h.ctl.grab({ pressId: 1, modelX: 0, modelY: 0, screenX: 700, screenY: 200 });
    h.setCursor(900, 200); // target = cursor + offset = (800, 100)
    // R3-51 derivation. §7.4 clamps the spring's ERROR at ±24 DIP, so far from the pointer the
    // motor runs at a terminal speed of k·L/c = 180·24/22.8035 = 189.4 DIP/s, not at the
    // second-order rate. A 200 DIP jump therefore needs 200/189.4 = 1.06 s of travel plus the
    // ζ = 0.85 settle inside the clamp: she reaches 800 at t = 1.36 s. The plan's `h.frame(60)`
    // (1.02 s) leaves her 15 DIP short — 100 frames (1.7 s) is the same assertion, honestly timed.
    h.frame(100);
    expect(Math.abs(h.position()[0] - 800)).toBeLessThan(2);
    expect(h.position()[1]).toBe(100);
    for (const m of h.motions()) {
      expect(Math.abs(m.lagX)).toBeLessThanOrEqual(DRAG_MAX_LAG_DIP);
      expect(m.phase).toBe('drag');
      expect(m.contact).toEqual({ x: 0, y: 0 });
    }
  });

  it('settles a pointer step within ~0.5 s (zeta 0.85, wn 13.42 rad/s)', () => {
    const h = make({ pos: [600, 100] });
    h.setCursor(700, 200);
    h.ctl.grab({ pressId: 1, modelX: 0, modelY: 0, screenX: 700, screenY: 200 });
    h.setCursor(720, 200); // 20 DIP step, inside the lag clamp: pure second-order response
    h.frame(30); // 510 ms
    expect(Math.abs(h.position()[0] - 620)).toBeLessThan(1);
  });

  it('sends sim:windowMotion at 30 Hz while dragging and nothing at rest', () => {
    const h = make();
    h.frame(60);
    expect(h.sends.length).toBe(0);
    h.ctl.grab({ pressId: 1, modelX: 0, modelY: 0, screenX: 700, screenY: 200 });
    h.frame(60); // 1020 ms of motor time
    const n = h.motions().length;
    expect(n).toBeGreaterThanOrEqual(28);
    expect(n).toBeLessThanOrEqual(32);
  });

  it('clamps a frame delta at MOTOR_FRAME_CLAMP_S instead of exploding the spring', () => {
    const h = make({ pos: [600, 100] });
    h.setCursor(700, 200);
    h.ctl.grab({ pressId: 1, modelX: 0, modelY: 0, screenX: 700, screenY: 200 });
    h.setCursor(900, 200);
    h.clock.t += 5_000; // a 5 s stall; the next frame must integrate at most 0.25 s
    h.frame();
    expect(Number.isFinite(h.position()[0])).toBe(true);
    expect(h.position()[0]).toBeLessThanOrEqual(800 + 1);
  });

  it('keeps 48 DIP grabbable on every write (clampDrag)', () => {
    const h = make({ pos: [1400, 100] });
    h.setCursor(1500, 200);
    h.ctl.grab({ pressId: 1, modelX: 0, modelY: 0, screenX: 1500, screenY: 200 });
    h.setCursor(4000, 200);
    h.frame(240);
    expect(h.position()[0]).toBe(AREA.width - 48);
  });
});

describe('release (§7.2, §7.5)', () => {
  it('ignores a release whose pressId does not match the live grab', () => {
    const h = make();
    h.ctl.grab({ pressId: 3, modelX: 0, modelY: 0, screenX: 700, screenY: 200 });
    h.ctl.release({ pressId: 2, wasTap: false });
    expect(h.ctl.phase).toBe('drag');
  });

  it('a tap settles in place: no fling, one settling frame, then rest + persist', () => {
    const h = make({ pos: [600, 100] });
    throwHer(h, 0, 0, 3, true);
    expect(h.ctl.phase).toBe('settling');
    h.frame(3);
    expect(h.ctl.phase).toBe('rest');
    expect(h.landings()).toEqual([]);
    expect(h.persisted).toEqual([[600, 100]]);
    expect(h.motions().at(-1)?.phase).toBe('rest');
    expect(h.suspend.at(-1)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('release velocity is the 4-sample EMA of the global cursor, capped at FLING_VELOCITY_CAP', () => {
    const h = make({ pos: [600, 100] });
    throwHer(h, 40, 0, 8); // 40 DIP / 17 ms = 2352.94 DIP/s
    // §7.8 publishes on every SECOND motor frame and nothing at the phase change itself, so the
    // first `fling` snapshot is two frames (34 ms) after the release; air drag has taken it to
    // 2352.94 · exp(-AIR_DRAG_X · 0.034) = 2254.7 DIP/s. Without these two frames `motions()` holds
    // drag snapshots only and `first` is undefined.
    h.frame(2);
    const first = h.motions().find((m) => m.phase === 'fling');
    expect(first).toBeDefined();
    expect(first!.vx).toBeGreaterThan(2200);
    expect(first!.vx).toBeLessThanOrEqual(FLING_VELOCITY_CAP);

    const h2 = make({ pos: [600, 100] });
    throwHer(h2, 80, 0, 8); // 4705.88 DIP/s -> capped to FLING_VELOCITY_CAP at release
    h2.frame(2);
    const cap = h2.motions().find((m) => m.phase === 'fling');
    expect(cap!.vx).toBeLessThanOrEqual(FLING_VELOCITY_CAP);
    // Both snapshots decayed over the same two frames, so their ratio is the ratio of the RELEASE
    // velocities. 2400/2352.94 = 1.02 is the cap; uncapped it would be 4705.88/2352.94 = 2.
    expect(cap!.vx / first!.vx).toBeCloseTo(FLING_VELOCITY_CAP / (40 / 0.017), 6);
  });

  it('forces click-through for the autonomous phases', () => {
    const h = make();
    throwHer(h, 10, 0, 4);
    expect(h.clickThrough.at(-1)).toBe(true);
  });
});

describe('fling, gravity, bounce, landing (§7.5)', () => {
  it('falls under gravity, lands once with edge floor, decays to rest, persists on the floor', () => {
    const h = make({ pos: [600, 100] });
    throwHer(h, 10, 0, 4); // ~590 DIP/s sideways, from 220 DIP above the floor
    h.frame(400); // 6.8 s
    expect(h.ctl.phase).toBe('rest');
    const landings = h.landings();
    expect(landings.length).toBe(1);
    expect(landings[0].edge).toBe('floor');
    expect(landings[0].generation).toBe(1);
    expect(landings[0].impulse).toBeGreaterThanOrEqual(LANDING_MIN_IMPULSE);
    expect(landings[0].impulse).toBeLessThanOrEqual(FLING_VELOCITY_CAP);
    expect(h.persisted.at(-1)?.[1]).toBe(FLOOR_Y);
    expect(h.motions().at(-1)).toMatchObject({ phase: 'rest', vx: 0, vy: 0, generation: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never tunnels through the right edge and reflects vx with the decaying restitution', () => {
    const h = make({ pos: [1000, FLOOR_Y] });
    throwHer(h, 40, 0, 8);
    h.frame(400);
    for (const [x] of h.positions) expect(x).toBeLessThanOrEqual(RIGHT_X);
    const vxs = h.motions().filter((m) => m.phase === 'fling').map((m) => m.vx);
    expect(vxs.some((v) => v > 0)).toBe(true);
    expect(vxs.some((v) => v < 0)).toBe(true);
    const peakBack = Math.min(...vxs);
    // Restitution 0.35 on the first bounce: the return speed is well under the arrival speed.
    expect(Math.abs(peakBack)).toBeLessThan(0.5 * Math.max(...vxs));
  });

  it('a slow drop below LANDING_MIN_IMPULSE lands without a sim:landing', () => {
    const h = make({ pos: [600, FLOOR_Y - 2] });
    throwHer(h, 0, 0, 2); // moved 0 -> wasTap false is still honoured as a fling of ~0 velocity
    h.frame(60);
    expect(h.ctl.phase).toBe('rest');
    expect(h.landings()).toEqual([]);
  });

  it('enters settling when speed after a floor contact is below REST_SPEED_DIP_S', () => {
    const h = make({ pos: [600, FLOOR_Y] });
    throwHer(h, 0, 0, 2);
    h.frame(2);
    const phases = h.motions().map((m) => m.phase);
    expect(phases).toContain('settling');
    expect(REST_SPEED_DIP_S).toBe(40);
  });
});

describe('walkTo (§7.6)', () => {
  const W = AREA;
  it('resolves the anchor table over the current work area and pet size', () => {
    const cur = { x: 1000, y: 100 };
    const home = { x: 1476, y: 296 };
    expect(walkTarget('left', W, cur, home)).toEqual({ x: 12, y: 100 });
    expect(walkTarget('right', W, cur, home)).toEqual({ x: 1920 - 420 - 12, y: 100 });
    expect(walkTarget('center', W, cur, home)).toEqual({ x: (1920 - 420) / 2, y: 100 });
    expect(walkTarget('corner-bl', W, cur, home)).toEqual({ x: 12, y: FLOOR_Y });
    expect(walkTarget('corner-br', W, cur, home)).toEqual({ x: 1920 - 420 - 12, y: FLOOR_Y });
    expect(walkTarget('home', W, cur, home)).toEqual(home);
  });

  it('walks left at WALK_SPEED_DIP_S, forced click-through, and rests at the anchor', () => {
    const h = make({ pos: [1000, FLOOR_Y] });
    expect(h.ctl.walkTo('left', 'llm')).toBe('started');
    expect(h.ctl.phase).toBe('walk');
    expect(h.ctl.generation).toBe(1);
    expect(h.clickThrough.at(-1)).toBe(true);
    h.frame(60); // ~1 s -> ~120 DIP travelled
    expect(Math.abs(1000 - h.position()[0] - WALK_SPEED_DIP_S * 1.02)).toBeLessThan(6);
    h.frame(600);
    expect(h.ctl.phase).toBe('rest');
    expect(h.position()).toEqual([12, FLOOR_Y]);
    expect(h.persisted.at(-1)).toEqual([12, FLOOR_Y]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a walk off a ledge falls: gravity stays on the vertical axis', () => {
    const h = make({ pos: [1000, 100] });
    h.ctl.walkTo('center', 'behaviour');
    h.frame(300);
    expect(h.position()[1]).toBe(FLOOR_Y);
  });

  it('returns busy while one is in flight and inside WALK_COOLDOWN_MS after it', () => {
    const h = make({ pos: [1000, FLOOR_Y] });
    expect(h.ctl.walkTo('left', 'llm')).toBe('started');
    expect(h.ctl.walkTo('right', 'llm')).toBe('busy');
    h.frame(700);
    expect(h.ctl.phase).toBe('rest');
    expect(h.ctl.walkTo('right', 'llm')).toBe('busy');
    h.clock.t += WALK_COOLDOWN_MS;
    expect(h.ctl.walkTo('right', 'llm')).toBe('started');
  });

  it('returns alreadyAtDestination inside WALK_MIN_DISTANCE_DIP and unknownDestination for a bad token', () => {
    const h = make({ pos: [20, FLOOR_Y] });
    expect(h.ctl.walkTo('left', 'llm')).toBe('alreadyAtDestination');
    expect(h.ctl.walkTo('upstairs' as never, 'llm')).toBe('unknownDestination');
    expect(console.warn).toHaveBeenCalledWith('[motion] walkTo unknown destination', 'upstairs');
  });

  it('returns unreachable when the anchor lands on no live work area', () => {
    const h = make({ pos: [600, FLOOR_Y], areas: [{ x: 0, y: 0, width: 300, height: 1040 }] });
    // R3-51 derivation, and the plan's own comment is the arithmetic: W is 300 wide, so clampDrag's
    // grabbable band for a 420-wide window is x ∈ [0-420+48, 0+300-48] = [-372, 252]. `home` is the
    // launch position x = 600, which is OUTSIDE that band and is pulled to 252 — a 348 DIP pull,
    // far past WALK_MIN_DISTANCE_DIP, so the anchor is unreachable rather than approximated.
    // (`right` resolves to 300-420-12 = -132, which is INSIDE [-372, 252]: no pull, and the plan's
    // own numbers say so. That anchor is reachable on a narrow display and returns 'started'.)
    expect(h.ctl.walkTo('home', 'llm')).toBe('unreachable');
  });

  it('a grab during a walk cancels it and starts a new generation', () => {
    const h = make({ pos: [1000, FLOOR_Y] });
    h.ctl.walkTo('left', 'llm');
    h.frame(10);
    h.ctl.grab({ pressId: 9, modelX: 0, modelY: 0, screenX: 900, screenY: 400 });
    expect(h.ctl.phase).toBe('drag');
    expect(h.ctl.generation).toBe(2);
    expect(console.log).toHaveBeenCalledWith('[motion] episode', 1, 'walk', 'cancelled');
  });
});

describe('rebase / cancel / dispose (§7.7)', () => {
  it('B-07 (pure): unplug during drag and during fling re-clamps, keeps velocity and generation', () => {
    const h = make({ pos: [1000, 100], areas: [AREA, { x: 1920, y: 0, width: 1920, height: 1040 }] });
    const r = runDisplayUnplug(h);
    expect(r.dragGenerationKept).toBe(true);
    expect(r.dragClamped).toBe(true);
    // B-07's "emitted" column, observable through WindowMotionDeps.trace: the `motion` records that
    // follow the unplug keep the generation and carry `clamped: true` (fix round 1, finding 4).
    expect(r.dragClampedTraced).toBe(true);
    expect(r.flingGenerationKept).toBe(true);
    expect(r.flingVelocityKept).toBe(true);
    // The fixture throws if no snapshot was published after the fling rebase, so the two booleans
    // above compare two genuinely different records (fix round 1, finding 1).
    expect(r.flingGenerationTraced).toBe(true);
    expect(r.finalGrabbable).toBe(true);
  });

  it('cancel() ends a live episode: rest frame, hover switching resumed, position persisted, no timer', () => {
    const h = make({ pos: [600, 100] });
    h.ctl.grab({ pressId: 1, modelX: 0, modelY: 0, screenX: 700, screenY: 200 });
    h.frame(5);
    h.ctl.cancel();
    expect(h.ctl.phase).toBe('rest');
    expect(h.motions().at(-1)?.phase).toBe('rest');
    expect(h.suspend.at(-1)).toBe(false);
    expect(h.persisted.length).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(console.log).toHaveBeenCalledWith('[motion] episode', 1, 'drag', 'cancelled');
  });

  it('cancel() at rest is a no-op', () => {
    const h = make();
    h.ctl.cancel();
    expect(h.sends).toEqual([]);
    expect(h.persisted).toEqual([]);
  });

  it('B-09 (pure): a lost renderer mid-drag cancels and the next grab starts a fresh generation', () => {
    const h = make({ pos: [600, 100] });
    const r = runRendererReload(h);
    expect(r.restFrameSent).toBe(true);
    expect(r.suspensionCleared).toBe(true);
    expect(r.nextGeneration).toBe(2);
  });

  it('dispose() persists and refuses further grabs', () => {
    const h = make({ pos: [600, 100] });
    h.ctl.grab({ pressId: 1, modelX: 0, modelY: 0, screenX: 700, screenY: 200 });
    h.ctl.dispose();
    expect(h.ctl.phase).toBe('rest');
    expect(h.persisted.length).toBe(1);
    h.ctl.grab({ pressId: 2, modelX: 0, modelY: 0, screenX: 700, screenY: 200 });
    expect(h.ctl.phase).toBe('rest');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('B-06 stale generation (§12.7)', () => {
  it('a landing from generation 7 is never emitted once generation 8 exists', () => {
    const h = make({ pos: [600, 100] });
    const r = runStaleGeneration(h);
    expect(r.generationAfterGrab).toBe(8);
    expect(r.landingsForGen7AfterGrab).toBe(0);
    expect(r.positionsFromGen8Only).toBe(true);
  });
});

// Type-level guard: Task 15 wires `WindowMotionDeps.trace` straight to the TraceWriter, so the dep's
// signature must accept `TraceWriter.write` narrowed to the two kinds §12.2 gives this class.
declare const _writer: import('./trace').TraceWriter;
declare const _deps: import('./window-motion').WindowMotionDeps;
const _traceDep: NonNullable<typeof _deps.trace> = (t, p) => { _writer.write(t, p); };
void _traceDep;

// Type-level guard: the payloads the motor sends are exactly the protocol types.
const _wm: WindowMotion = { generation: 0, tsMain: 0, phase: 'rest', vx: 0, vy: 0, lagX: 0, lagY: 0, contact: null };
const _ld: Landing = { generation: 0, tsMain: 0, impulse: 0, edge: 'floor' };
void _wm; void _ld;
