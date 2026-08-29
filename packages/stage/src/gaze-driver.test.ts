import { describe, expect, it } from 'vitest';
import { CubismLook, LookParameterData } from '@framework/effect/cubismlook';
import { CubismUpdateOrder } from '@framework/motion/icubismupdater';
import { GAZE_SETTLE_SECONDS, GAZE_TAU_SECONDS, GazeDriver, GazeLookUpdater } from './gaze-driver';

/** Runs `steps` updates of `dt` and returns the final x. */
function run(d: GazeDriver, steps: number, dt: number): number {
  for (let i = 0; i < steps; i++) d.update(dt);
  return d.getX();
}

describe('GazeDriver', () => {
  it('reaches the same position after 1 s whether stepped at 30 or 60 fps', () => {
    // The -1 -> +1 sweep the review used to measure CubismTargetPoint (0.633 s @30 vs 0.383 s @60).
    const a = new GazeDriver();
    const b = new GazeDriver();
    a.reset(-1, -1);
    b.reset(-1, -1);
    a.setTarget(1, 1);
    b.setTarget(1, 1);

    const at60 = run(a, 60, 1 / 60);
    const at30 = run(b, 30, 1 / 30);

    expect(Math.abs(at60 - at30)).toBeLessThan(1e-3);
  });

  it('is fps independent part-way through the sweep too, not just at rest', () => {
    const a = new GazeDriver();
    const b = new GazeDriver();
    a.setTarget(1, 1);
    b.setTarget(1, 1);
    // 0.1 s of wall clock - still climbing (~84% of the way) at this tau.
    const at60 = run(a, 6, 1 / 60);
    const at30 = run(b, 3, 1 / 30);
    expect(at60).toBeGreaterThan(0.5);
    expect(at60).toBeLessThan(0.99);
    expect(Math.abs(at60 - at30)).toBeLessThan(1e-3);
  });

  it('settles a 0 -> 1 step to within 0.01 at 0.25 s +/- 0.05 s', () => {
    const d = new GazeDriver();
    d.setTarget(1, 1);
    const dt = 1 / 240;
    let t = 0;
    while (Math.abs(1 - d.getX()) > 0.01) {
      d.update(dt);
      t += dt;
      if (t > 2) break; // guard: never loop forever if the filter is broken
    }
    expect(t).toBeGreaterThanOrEqual(GAZE_SETTLE_SECONDS - 0.05);
    expect(t).toBeLessThanOrEqual(GAZE_SETTLE_SECONDS + 0.05);
  });

  it('derives tau from the 250 ms settle figure rather than hard-coding it', () => {
    // Guards the deviation documented in gaze-driver.ts: 0.08 would settle at 368 ms.
    expect(GAZE_TAU_SECONDS).toBeCloseTo(0.0543, 4);
  });

  it('approaches the target monotonically and never overshoots', () => {
    const d = new GazeDriver();
    d.setTarget(1, -1);
    let prevX = d.getX();
    let prevY = d.getY();
    for (let i = 0; i < 240; i++) {
      d.update(1 / 60);
      expect(d.getX()).toBeGreaterThanOrEqual(prevX);
      expect(d.getY()).toBeLessThanOrEqual(prevY);
      expect(d.getX()).toBeLessThanOrEqual(1);
      expect(d.getY()).toBeGreaterThanOrEqual(-1);
      prevX = d.getX();
      prevY = d.getY();
    }
    expect(d.getX()).toBeCloseTo(1, 6);
    expect(d.getY()).toBeCloseTo(-1, 6);
  });

  it('clamps the target to [-1, 1] and ignores a non-positive or non-finite dt', () => {
    const d = new GazeDriver();
    d.setTarget(5, -5);
    expect(d.getTargetX()).toBe(1);
    expect(d.getTargetY()).toBe(-1);
    d.setTarget(Number.NaN, 0);
    expect(d.getTargetX()).toBe(0);

    d.setTarget(1, 1);
    d.update(0);
    d.update(-1);
    d.update(Number.NaN);
    expect(d.getX()).toBe(0);
    expect(Number.isFinite(d.getY())).toBe(true);
  });
});

describe('GazeLookUpdater', () => {
  it('writes the eased gaze into CubismLook in the slot CubismLookUpdater used', () => {
    const look = CubismLook.create();
    const angleX = { id: 'ParamAngleX' } as never;
    const eyeBallY = { id: 'ParamEyeBallY' } as never;
    look.setParameters([
      new LookParameterData(angleX, 30, 0, 0),
      new LookParameterData(eyeBallY, 0, 1, 0),
    ]);

    const written = new Map<unknown, number>();
    const model = {
      addParameterValueById(id: unknown, value: number) {
        written.set(id, (written.get(id) ?? 0) + value);
      },
    };

    const gaze = new GazeDriver();
    const updater = new GazeLookUpdater(look, gaze);
    expect(updater.getExecutionOrder()).toBe(CubismUpdateOrder.CubismUpdateOrder_Drag);

    gaze.setTarget(1, 1);
    // 0.25 s in one step: settled, so the look factors are applied at (near) full strength.
    updater.onLateUpdate(model as never, GAZE_SETTLE_SECONDS);

    expect(written.get(angleX)).toBeGreaterThan(30 * 0.98);
    expect(written.get(angleX)).toBeLessThanOrEqual(30);
    expect(written.get(eyeBallY)).toBeGreaterThan(0.98);
  });

  it('is a no-op without a model, exactly like CubismLookUpdater', () => {
    const gaze = new GazeDriver();
    gaze.setTarget(1, 1);
    const updater = new GazeLookUpdater(CubismLook.create(), gaze);
    updater.onLateUpdate(null as never, 0.1);
    expect(gaze.getX()).toBe(0);
  });
});
