import { describe, expect, it } from 'vitest';
import type { Landing, WindowMotion } from '@ds/protocol';
import { FLING_VELOCITY_CAP } from '../../shared/lane-metrics';
import {
  DragVisual, applySquash, LEAN_ANGLE_X_DEG, LEAN_ANGLE_Z_DEG, LEAN_BODY_Z_DEG, LEAN_LAG_REF_DIP,
  SQUASH_COMPRESS_MS, SQUASH_IMPULSE_REF, SQUASH_MAX, SQUASH_OVERSHOOT_K, SQUASH_RECOVER_MS, STAND_UP_MS,
  SWAY_DECAY_RATE, SWAY_FOLLOW_RATE, TUMBLE_MAX_DEG, TUMBLE_RATE,
} from './drag-visual';

/**
 * The slice of CubismMatrix44 `applySquash` uses, reimplemented here with the vendored class's own
 * arithmetic (vendor/CubismWebFramework/src/math/cubismmatrix44.ts): row-major storage, row-vector
 * convention (`transformY(y) = _tr[5]*y + _tr[13]`), and `scaleRelative`/`translateRelative` both
 * PREPENDING via `multiply(tr1, this._tr, this._tr)`. The desktop vitest project has no
 * `@framework/*` alias, so the real class cannot be imported here; `mirrors CubismMatrix44` below
 * pins that this stand-in agrees with it on the identity and on a pure scale+translate base.
 */
class FakeMatrix44 {
  private readonly tr = new Float32Array(16);
  constructor() { this.loadIdentity(); }
  loadIdentity(): void { this.tr.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }
  /** By REFERENCE, like the vendored class (cubismmatrix44.ts:85-87) — not a copy. */
  getArray(): Float32Array { return this.tr; }
  /**
   * Copies INTO the live buffer (cubismmatrix44.ts:74-78). `this.tr = new Float32Array(a)` would
   * rebind instead, and a `base` that aliases `getArray()` could then never be observed being
   * destroyed — the hazard 'needs a PRIVATE base copy' below exists to pin (fix round 2, finding 4).
   */
  setMatrix(a: Float32Array): void { this.tr.set(a); }
  transformY(y: number): number { return this.tr[5] * y + this.tr[13]; }
  private static multiply(a: Float32Array, b: Float32Array, dst: Float32Array): void {
    const c = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) c[j + i * 4] += a[k + i * 4] * b[j + k * 4];
    dst.set(c);
  }
  scaleRelative(x: number, y: number): void {
    FakeMatrix44.multiply(new Float32Array([x,0,0,0, 0,y,0,0, 0,0,1,0, 0,0,0,1]), this.tr, this.tr);
  }
  translateRelative(x: number, y: number): void {
    FakeMatrix44.multiply(new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,0,1]), this.tr, this.tr);
  }
}

/** A stage-fit base: scale `b`, translate `c` — never the all-zero array the call log used to use. */
function fitted(b: number, c: number): Float32Array {
  const m = new FakeMatrix44();
  m.scaleRelative(b, b);
  m.translateRelative(0, c / b); // translateRelative prepends, so the resulting _tr[13] is c
  return new Float32Array(m.getArray());
}

const snap = (p: Partial<WindowMotion> = {}): WindowMotion => ({
  generation: 1, tsMain: 0, phase: 'drag', vx: 0, vy: 0, lagX: 0, lagY: 0, contact: null, ...p,
});
const land = (p: Partial<Landing> = {}): Landing => ({ generation: 1, tsMain: 0, impulse: 1200, edge: 'floor', ...p });

/** Steps `ms` in 16 ms RAF-sized slices, returning the last pose. */
function run(v: DragVisual, ms: number) {
  let pose = v.step(0);
  for (let t = 0; t < ms; t += 16) pose = v.step(16);
  return pose;
}

describe('constants (§5.5, §7.5)', () => {
  it('pins the presentation numbers', () => {
    expect([LEAN_LAG_REF_DIP, LEAN_ANGLE_Z_DEG, LEAN_BODY_Z_DEG, LEAN_ANGLE_X_DEG]).toEqual([120, 22, 8, 30]);
    expect([SWAY_FOLLOW_RATE, SWAY_DECAY_RATE]).toEqual([3.5, 1.7]);
    expect([SQUASH_IMPULSE_REF, SQUASH_MAX, SQUASH_COMPRESS_MS, SQUASH_RECOVER_MS]).toEqual([1_200, 0.18, 90, 160]);
    expect([TUMBLE_MAX_DEG, TUMBLE_RATE, STAND_UP_MS]).toEqual([18, 4.0, 320]);
    expect(SQUASH_OVERSHOOT_K).toBe(1.5);
  });
});

describe('lean (§5.5)', () => {
  it('follows the clamped lag toward ParamAngleZ = clamp(lag/120,-1,1)*22 and decays after rest', () => {
    const v = new DragVisual();
    expect(v.onSnapshot(snap({ lagX: 24 }))).toBe(true);
    const pose = run(v, 2_000);
    expect(pose.angleZ).toBeCloseTo((24 / LEAN_LAG_REF_DIP) * LEAN_ANGLE_Z_DEG, 1);
    expect(pose.angleX).toBeCloseTo((24 / LEAN_LAG_REF_DIP) * LEAN_ANGLE_X_DEG, 1);
    expect(pose.bodyAngleZ).toBeCloseTo((24 / LEAN_LAG_REF_DIP) * LEAN_BODY_Z_DEG, 1);
    // `moving` is true for the whole live episode (DragPose's own contract), not only afterwards.
    expect(pose.moving).toBe(true);
    v.onSnapshot(snap({ phase: 'rest' }));
    // …and it holds through §5.8's 500 ms hysteresis before going false.
    expect(run(v, 320).moving).toBe(true);
    const after = run(v, 3_000);
    expect(Math.abs(after.angleZ)).toBeLessThan(0.05);
    expect(after.moving).toBe(false);
  });

  it('saturates at full lean for lag beyond LEAN_LAG_REF_DIP', () => {
    const v = new DragVisual();
    v.onSnapshot(snap({ lagX: -500 }));
    expect(run(v, 3_000).angleZ).toBeCloseTo(-LEAN_ANGLE_Z_DEG, 1);
  });
});

describe('generation gating (§5.5, §7.8, B-06)', () => {
  it('drops a snapshot whose generation is lower than the last seen', () => {
    const v = new DragVisual();
    expect(v.onSnapshot(snap({ generation: 8 }))).toBe(true);
    expect(v.onSnapshot(snap({ generation: 7, lagX: 24 }))).toBe(false);
    expect(v.generation).toBe(8);
    expect(run(v, 1_000).angleZ).toBe(0);
  });

  it('runs the squash only when the landing generation matches', () => {
    const v = new DragVisual();
    v.onSnapshot(snap({ generation: 8, phase: 'fling' }));
    expect(v.onLanding(land({ generation: 7 }))).toBe(false);
    expect(run(v, SQUASH_COMPRESS_MS).squash).toBe(0);
    expect(v.onLanding(land({ generation: 8 }))).toBe(true);
    expect(run(v, SQUASH_COMPRESS_MS).squash).toBeGreaterThan(0);
  });
});

describe('squash envelope (§5.5)', () => {
  it('compresses to s = clamp(impulse/1200,0,1)*0.18 in 90 ms, overshoots ~4 %, recovers in 160 ms', () => {
    const v = new DragVisual();
    v.onSnapshot(snap({ phase: 'fling' }));
    v.onLanding(land({ impulse: 600 }));
    const peak = 0.5 * SQUASH_MAX;
    v.step(0);
    v.step(SQUASH_COMPRESS_MS);
    expect(v.step(0).squash).toBeCloseTo(peak, 6);
    let min = Infinity;
    for (let t = 0; t < SQUASH_RECOVER_MS; t += 8) min = Math.min(min, v.step(8).squash);
    expect(min).toBeLessThan(-0.03 * peak);
    expect(min).toBeGreaterThan(-0.05 * peak);
    expect(v.step(1).squash).toBe(0);
  });

  it('caps the squash at SQUASH_MAX for impulses above SQUASH_IMPULSE_REF', () => {
    const v = new DragVisual();
    v.onSnapshot(snap({ phase: 'fling' }));
    v.onLanding(land({ impulse: 2400 }));
    v.step(0);
    v.step(SQUASH_COMPRESS_MS);
    expect(v.step(0).squash).toBeCloseTo(SQUASH_MAX, 6);
  });
});

describe('tumble and stand-up (§7.5)', () => {
  it('tumbles toward clamp(vx/2400,-1,1)*18 while flinging, eased at TUMBLE_RATE', () => {
    const v = new DragVisual();
    v.onSnapshot(snap({ phase: 'fling', vx: FLING_VELOCITY_CAP }));
    const oneStep = v.step(250).tumbleDeg; // 1 - e^(-4*0.25) = 0.632
    expect(oneStep).toBeCloseTo(TUMBLE_MAX_DEG * (1 - Math.exp(-TUMBLE_RATE * 0.25)), 3);
    expect(run(v, 2_000).tumbleDeg).toBeCloseTo(TUMBLE_MAX_DEG, 1);
    v.onSnapshot(snap({ phase: 'fling', vx: -600 }));
    // Derived from the cap, not the 4.5 that 600/2400 happens to give: the tumble reference IS
    // FLING_VELOCITY_CAP, so a retune must move this number (fix round 1, finding 7).
    expect(run(v, 2_000).tumbleDeg).toBeCloseTo(-(600 / FLING_VELOCITY_CAP) * TUMBLE_MAX_DEG, 1);
  });

  it('returns tumbleDeg to 0 within SQUASH_RECOVER_MS + STAND_UP_MS of a landing', () => {
    const v = new DragVisual();
    v.onSnapshot(snap({ phase: 'fling', vx: FLING_VELOCITY_CAP }));
    run(v, 2_000);
    v.onLanding(land());
    v.onSnapshot(snap({ phase: 'settling' }));
    const mid = run(v, STAND_UP_MS / 2).tumbleDeg;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(TUMBLE_MAX_DEG);
    expect(run(v, SQUASH_RECOVER_MS + STAND_UP_MS / 2).tumbleDeg).toBe(0);
  });

  it('stands up after a fling that ended without a landing (cancelled)', () => {
    const v = new DragVisual();
    v.onSnapshot(snap({ phase: 'fling', vx: FLING_VELOCITY_CAP }));
    run(v, 2_000);
    v.onSnapshot(snap({ phase: 'rest' }));
    expect(run(v, STAND_UP_MS + 16).tumbleDeg).toBe(0);
  });
});

describe('applySquash (§5.5)', () => {
  it('mirrors CubismMatrix44: a fitted base transforms y as b*y + c', () => {
    const m = new FakeMatrix44();
    m.setMatrix(fitted(2.5, -0.4));
    expect(m.transformY(0)).toBeCloseTo(-0.4, 6);
    expect(m.transformY(1)).toBeCloseTo(2.1, 6);
    expect(m.transformY(-1)).toBeCloseTo(-2.9, 6);
  });

  // The property, not the call log: whatever formula applySquash uses, the feet must not move.
  // `t = feetY * s` (the pre-fix compensation) leaves a residual -b*feetY*s^2 and fails this at
  // every s > 0 (fix round 1, finding 3).
  it.each([
    [0.18, -1, 2.5, -0.4],
    [SQUASH_MAX, -1.2, 1.75, 0.3],
    [0.05, -0.8, 3, 0],
    [0.18, 0.5, 2, 1.1],
  ])('plants the feet for s=%s feetY=%s (base b=%s c=%s)', (s, feetY, b, c) => {
    const base = fitted(b, c);
    const m = new FakeMatrix44();
    m.setMatrix(base);
    const before = m.transformY(feetY);
    applySquash(m, base, s, feetY);
    expect(m.transformY(feetY)).toBeCloseTo(before, 6);
  });

  it('scales by (1+s/2, 1-s) about the feet and resets to the base for s = 0', () => {
    const base = fitted(2.5, -0.4);
    const m = new FakeMatrix44();
    // §5.5's vertical compression: a point one unit above the feet ends up (1-s) as far above them.
    applySquash(m, base, 0.18, -1);
    const feet = m.transformY(-1);
    expect(m.transformY(0) - feet).toBeCloseTo((1 - 0.18) * 2.5 * 1, 6);
    expect(m.getArray()[0]).toBeCloseTo((1 + 0.18 / 2) * 2.5, 6); // scaleRelative(1+s/2, ...) on x
    // s = 0 is the identity: the base matrix, untouched.
    applySquash(m, base, 0, -1);
    expect(Array.from(m.getArray())).toEqual(Array.from(base));
  });

  it('needs a PRIVATE base copy: every frame squashes the same fit, and an aliased base compounds', () => {
    // What the stage (Task 13) must do: capture `new Float32Array(matrix.getArray())` once.
    const m = new FakeMatrix44();
    m.setMatrix(fitted(2.5, -0.4));
    const base = new Float32Array(m.getArray());
    for (let i = 0; i < 3; i++) applySquash(m, base, 0.18, -1);
    const once = new FakeMatrix44();
    applySquash(once, fitted(2.5, -0.4), 0.18, -1);
    expect(Array.from(m.getArray())).toEqual(Array.from(once.getArray()));
    expect(m.getArray()[5]).toBeCloseTo((1 - 0.18) * 2.5, 6); // one squash, not three
    // The hazard that copy prevents: `base = matrix.getArray()` aliases the live `_tr`, so the
    // first frame destroys the base in place and the y scale compounds as (1-s)^n.
    const aliased = new FakeMatrix44();
    aliased.setMatrix(fitted(2.5, -0.4));
    for (let i = 0; i < 3; i++) applySquash(aliased, aliased.getArray(), 0.18, -1);
    expect(aliased.getArray()[5]).toBeCloseTo((1 - 0.18) ** 3 * 2.5, 6);
    expect(aliased.getArray()[5]).not.toBeCloseTo(m.getArray()[5], 4);
  });
});
