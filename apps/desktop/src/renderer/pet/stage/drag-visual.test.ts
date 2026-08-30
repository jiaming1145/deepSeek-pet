import { describe, expect, it } from 'vitest';
import type { Landing, WindowMotion } from '@ds/protocol';
import {
  DragVisual, applySquash, LEAN_ANGLE_X_DEG, LEAN_ANGLE_Z_DEG, LEAN_BODY_Z_DEG, LEAN_LAG_REF_DIP,
  SQUASH_COMPRESS_MS, SQUASH_IMPULSE_REF, SQUASH_MAX, SQUASH_OVERSHOOT_K, SQUASH_RECOVER_MS, STAND_UP_MS,
  SWAY_DECAY_RATE, SWAY_FOLLOW_RATE, TUMBLE_MAX_DEG, TUMBLE_RATE,
} from './drag-visual';

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
    v.onSnapshot(snap({ phase: 'fling', vx: 2400 }));
    const oneStep = v.step(250).tumbleDeg; // 1 - e^(-4*0.25) = 0.632
    expect(oneStep).toBeCloseTo(TUMBLE_MAX_DEG * (1 - Math.exp(-TUMBLE_RATE * 0.25)), 3);
    expect(run(v, 2_000).tumbleDeg).toBeCloseTo(TUMBLE_MAX_DEG, 1);
    v.onSnapshot(snap({ phase: 'fling', vx: -600 }));
    expect(run(v, 2_000).tumbleDeg).toBeCloseTo(-4.5, 1);
  });

  it('returns tumbleDeg to 0 within SQUASH_RECOVER_MS + STAND_UP_MS of a landing', () => {
    const v = new DragVisual();
    v.onSnapshot(snap({ phase: 'fling', vx: 2400 }));
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
    v.onSnapshot(snap({ phase: 'fling', vx: 2400 }));
    run(v, 2_000);
    v.onSnapshot(snap({ phase: 'rest' }));
    expect(run(v, STAND_UP_MS + 16).tumbleDeg).toBe(0);
  });
});

describe('applySquash (§5.5)', () => {
  it('resets to the base matrix, then scaleRelative(1+s/2, 1-s) and a feet-planting translate', () => {
    const calls: string[] = [];
    const base = new Float32Array(16);
    const matrix = {
      getArray: () => base,
      setMatrix: (a: Float32Array) => { calls.push(`set:${a === base}`); },
      scaleRelative: (x: number, y: number) => { calls.push(`scale:${x.toFixed(3)},${y.toFixed(3)}`); },
      translateRelative: (x: number, y: number) => { calls.push(`translate:${x},${y.toFixed(4)}`); },
    };
    applySquash(matrix, base, 0.18, -1);
    expect(calls).toEqual(['set:true', 'scale:1.090,0.820', 'translate:0,-0.1800']);
    calls.length = 0;
    applySquash(matrix, base, 0, -1);
    expect(calls).toEqual(['set:true']);
  });
});
