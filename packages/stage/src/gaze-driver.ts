import { CubismUpdateOrder, ICubismUpdater } from '@framework/motion/icubismupdater';
import type { CubismLook } from '@framework/effect/cubismlook';
import type { CubismModel } from '@framework/model/cubismmodel';

/**
 * Spec §4.3: the gaze "eases toward the target (critically damped, ~250 ms)".
 *
 * "Settled" is measured the way the Phase 1 review measured the Framework's CubismTargetPoint it
 * replaces: the first time |target - position| falls to 1% of the step. For the exponential filter
 * below the closed form is `error(t) = exp(-t / tau)`, so 1% is reached at `t = tau * ln(100)` and
 * the time constant that puts that at 250 ms is ~54.3 ms.
 *
 * NOTE (deviation, recorded in the fix-wave report): the review text suggested `tau ~= 0.08`, which
 * is inconsistent with its own acceptance test - 80 ms settles to 1% only at 368 ms. The 250 ms
 * figure is the one spec §4.3 states, so tau is derived from it rather than hard-coded.
 */
export const GAZE_SETTLE_SECONDS = 0.25;

/** Time constant of the gaze filter, in seconds. See GAZE_SETTLE_SECONDS. */
export const GAZE_TAU_SECONDS = GAZE_SETTLE_SECONDS / Math.log(100);

function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/**
 * The `GazeDriver` spec §4.3 and §2.1 name: a delta-time-driven first-order filter that eases the
 * rendered gaze toward the cursor target with no overshoot.
 *
 * It replaces CubismTargetPoint, whose position step is a per-*call* constant
 * (`vendor/CubismWebFramework/src/math/cubismtargetpoint.ts:44` and `:119-120`), so its easing speed
 * changed with the 30/60 fps hover switch. Here the step is `1 - exp(-dt / tau)`, whose composition
 * over any partition of an interval is exactly `1 - exp(-elapsed / tau)`: the trajectory depends on
 * elapsed time only, never on how many frames it was sampled in.
 */
export class GazeDriver {
  private x = 0;
  private y = 0;
  private targetX = 0;
  private targetY = 0;

  constructor(private readonly tau: number = GAZE_TAU_SECONDS) {}

  /** Sets the gaze target; both axes are clamped to [-1, 1] (ViewTransform.toGaze already is). */
  setTarget(x: number, y: number): void {
    this.targetX = clampUnit(x);
    this.targetY = clampUnit(y);
  }

  getTargetX(): number {
    return this.targetX;
  }

  getTargetY(): number {
    return this.targetY;
  }

  getX(): number {
    return this.x;
  }

  getY(): number {
    return this.y;
  }

  /** Jumps to a position (and target) without easing - used when the gaze has no history to keep. */
  reset(x = 0, y = 0): void {
    this.setTarget(x, y);
    this.x = this.targetX;
    this.y = this.targetY;
  }

  /** Advances the filter by `dt` seconds. A non-positive or non-finite dt is a no-op. */
  update(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const k = 1 - Math.exp(-dt / this.tau);
    this.x += (this.targetX - this.x) * k;
    this.y += (this.targetY - this.y) * k;
  }
}

/**
 * Writes the GazeDriver's output into a CubismLook, in the slot CubismLookUpdater occupied.
 *
 * Same contract as `vendor/CubismWebFramework/src/motion/cubismlookupdater.ts:58-68`, minus the
 * CubismTargetPoint: the scheduler calls onLateUpdate once per rendered frame with the frame's dt.
 */
export class GazeLookUpdater extends ICubismUpdater {
  constructor(
    private readonly look: CubismLook,
    private readonly gaze: GazeDriver,
    executionOrder: number = CubismUpdateOrder.CubismUpdateOrder_Drag,
  ) {
    super(executionOrder);
  }

  onLateUpdate(model: CubismModel, deltaTimeSeconds: number): void {
    if (!model) return;
    this.gaze.update(deltaTimeSeconds);
    this.look.updateParameters(model, this.gaze.getX(), this.gaze.getY());
  }
}
