/**
 * §5.5 drag visuals + §7.5 tumble / stand-up — pure presentation of main's 30 Hz snapshots.
 *
 * The renderer never runs the physics and never calls setPosition (R3-5). It stores the latest
 * `sim:windowMotion`, drops anything with a lower generation, interpolates the lean at RAF, runs
 * the landing squash only when `sim:landing` carries the live generation, and derives the tumble
 * from the fling's own `vx`. `tsMain` is never compared to `performance.now()` (R3-3): staleness is
 * generation alone.
 */
import type { Landing, WindowMotion } from '@ds/protocol';
import { FLING_VELOCITY_CAP } from '../../shared/lane-metrics';

export const LEAN_LAG_REF_DIP = 120;      // lag magnitude that maps to full lean
export const LEAN_ANGLE_Z_DEG = 22;       // research §4: ParamAngleZ = clamp(lag/120,-1,1)*22
export const LEAN_BODY_Z_DEG = 8;
export const LEAN_ANGLE_X_DEG = 30;
export const SWAY_FOLLOW_RATE = 3.5;      // sway += (target-sway)*(1-exp(-3.5*dt))
export const SWAY_DECAY_RATE = 1.7;       // sway *= exp(-1.7*dt)
export const SQUASH_IMPULSE_REF = 1_200;  // DIP/s that maps to the full squash
export const SQUASH_MAX = 0.18;           // s = clamp(impulse/1200,0,1)*0.18
export const SQUASH_COMPRESS_MS = 90;     // ease-out
export const SQUASH_RECOVER_MS = 160;     // with ~4 % overshoot
/** Recovery curve (1-p)(1-K·p): K = 1.5 dips to -4.2 % of the peak at p = 5/6 and returns to 0 at p = 1. */
export const SQUASH_OVERSHOOT_K = 1.5;
export const TUMBLE_MAX_DEG = 18;         // §7.5: tumbleDeg = clamp(vx / FLING_VELOCITY_CAP, -1, 1) * 18
export const TUMBLE_RATE = 4.0;           // s⁻¹ easing toward the tumble target
export const STAND_UP_MS = 320;           // easeOutCubic return of tumbleDeg to 0 after a landing

/**
 * §7.5's tumble reference IS the fling velocity cap (§2.4 gives LandingSchema.impulse the same max).
 * Imported, not re-declared: §5.13's one home. A retune of the cap must move the tumble with it,
 * and a local `2400` would silently keep the old ratio (fix round 1, finding 7).
 */
const VELOCITY_REF = FLING_VELOCITY_CAP;
/** `moving` stays true this long after the final `rest` snapshot (§5.8's 500 ms hysteresis). */
const MOVING_HOLD_MS = 500;

export interface DragPose {
  /** ParamAngleX, degrees. */
  angleX: number;
  /** ParamAngleZ, degrees (lean + tumble). */
  angleZ: number;
  /** ParamBodyAngleZ, degrees. */
  bodyAngleZ: number;
  /** The fling tumble component alone, degrees; 0 when standing. */
  tumbleDeg: number;
  /** Vertical squash 0..SQUASH_MAX (negative during the overshoot = slight stretch). */
  squash: number;
  /** True from the first snapshot of an episode until 500 ms after its `rest` frame (§5.8). */
  moving: boolean;
}

/** The slice of CubismMatrix44 the squash needs. */
export interface SquashMatrix {
  getArray(): Float32Array;
  setMatrix(a: Float32Array): void;
  scaleRelative(x: number, y: number): void;
  translateRelative(x: number, y: number): void;
}

/**
 * §5.5: `scaleRelative(1 + s/2, 1 − s)` plus a compensating translate so the feet stay planted.
 * `base` is the model matrix as fitted by the stage (captured once, before any squash);
 * `feetY` is the feet's y in MODEL space — the coordinate you would pass to `base.transformY`,
 * not a screen value — so the bottom edge lands back exactly where `base` put it.
 * `translateRelative`, not `translateY`: CubismMatrix44's translate* ASSIGN _tr[12]/_tr[13]
 * (packages/stage/src/stage.ts:182), which would discard the fit's own translation.
 *
 * The compensation is `feetY * s / (1 - s)`, NOT `feetY * s`. Both `scaleRelative` and
 * `translateRelative` PREPEND (`multiply(tr1, this._tr, this._tr)` with the row-vector convention
 * `transformY(y) = _tr[5]*y + _tr[13]`), so the composite maps `y -> ((y + t)(1 - s))*b + c` for a
 * base scale `b` and translate `c`. Planting the feet means `(feetY + t)(1 - s) = feetY`, i.e.
 * `t = feetY * s / (1 - s)`. `t = feetY * s` leaves a residual `-b * feetY * s^2` — 3.2 % of the
 * feet offset at SQUASH_MAX = 0.18, a visible slide on the frame with the deepest compression
 * (fix round 1, finding 3).
 */
export function applySquash(matrix: SquashMatrix, base: Float32Array, s: number, feetY: number): void {
  matrix.setMatrix(base);
  if (s === 0) return;
  matrix.scaleRelative(1 + s / 2, 1 - s);
  matrix.translateRelative(0, (feetY * s) / (1 - s));
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
const easeOutCubic = (p: number): number => 1 - (1 - p) ** 3;

export class DragVisual {
  private latest: WindowMotion | null = null;
  private lastGeneration = -1;
  private sway = { x: 0, y: 0 };
  private tumble = 0;
  private standUp: { from: number; elapsedMs: number } | null = null;
  private squash: { peak: number; elapsedMs: number } | null = null;
  private squashValue = 0;
  private restForMs = Number.POSITIVE_INFINITY;

  get generation(): number { return this.lastGeneration; }

  /** Stores the snapshot; returns false (and ignores it) when its generation is older than the last seen. */
  onSnapshot(m: WindowMotion): boolean {
    if (m.generation < this.lastGeneration) return false;
    this.lastGeneration = m.generation;
    this.latest = m;
    if (m.phase === 'rest') { if (!Number.isFinite(this.restForMs)) this.restForMs = 0; }
    else this.restForMs = Number.POSITIVE_INFINITY;
    return true;
  }

  /** Starts the squash (and the stand-up) only for the live generation (R3-5). */
  onLanding(l: Landing): boolean {
    if (l.generation !== this.lastGeneration) return false;
    this.squash = { peak: clamp(l.impulse / SQUASH_IMPULSE_REF, 0, 1) * SQUASH_MAX, elapsedMs: 0 };
    this.squashValue = 0;
    if (this.tumble !== 0) this.standUp = { from: this.tumble, elapsedMs: 0 };
    return true;
  }

  /** One RAF step. `dtMs` is the renderer's own frame delta. */
  step(dtMs: number): DragPose {
    const dt = dtMs / 1000;
    const m = this.latest;
    const phase = m?.phase ?? 'rest';

    // Lean: follow the normalised lag while dragging, decay otherwise.
    if (phase === 'drag' && m) {
      const k = 1 - Math.exp(-SWAY_FOLLOW_RATE * dt);
      this.sway.x += (clamp(m.lagX / LEAN_LAG_REF_DIP, -1, 1) - this.sway.x) * k;
      this.sway.y += (clamp(m.lagY / LEAN_LAG_REF_DIP, -1, 1) - this.sway.y) * k;
    } else {
      const d = Math.exp(-SWAY_DECAY_RATE * dt);
      this.sway.x *= d;
      this.sway.y *= d;
    }

    // Tumble while flinging; stand up (easeOutCubic over STAND_UP_MS) once the fling is over.
    if (phase === 'fling' && m) {
      const target = clamp(m.vx / VELOCITY_REF, -1, 1) * TUMBLE_MAX_DEG;
      this.tumble += (target - this.tumble) * (1 - Math.exp(-TUMBLE_RATE * dt));
      this.standUp = null;
    } else if (this.standUp) {
      this.standUp.elapsedMs += dtMs;
      const p = Math.min(1, this.standUp.elapsedMs / STAND_UP_MS);
      this.tumble = this.standUp.from * (1 - easeOutCubic(p));
      if (p >= 1) { this.tumble = 0; this.standUp = null; }
    } else if (this.tumble !== 0) {
      this.standUp = { from: this.tumble, elapsedMs: 0 };
    }

    // Squash envelope: ease-out compression, then the overshooting recovery.
    if (this.squash) {
      this.squash.elapsedMs += dtMs;
      const e = this.squash.elapsedMs;
      if (e < SQUASH_COMPRESS_MS) {
        this.squashValue = this.squash.peak * easeOutCubic(e / SQUASH_COMPRESS_MS);
      } else if (e < SQUASH_COMPRESS_MS + SQUASH_RECOVER_MS) {
        const p = (e - SQUASH_COMPRESS_MS) / SQUASH_RECOVER_MS;
        this.squashValue = this.squash.peak * (1 - p) * (1 - SQUASH_OVERSHOOT_K * p);
      } else {
        this.squashValue = 0;
        this.squash = null;
      }
    }

    if (Number.isFinite(this.restForMs)) this.restForMs += dtMs;
    // `restForMs` is +Infinity for the whole of a live episode and starts counting at the `rest`
    // frame, so the live case is the NON-finite one. Testing `restForMs < MOVING_HOLD_MS` alone
    // would report `moving: false` for every drag, fling and walk and `true` only for the 500 ms
    // after they end — the exact inverse of this field's contract two lines up.
    const moving = m !== null && (!Number.isFinite(this.restForMs) || this.restForMs < MOVING_HOLD_MS);

    return {
      angleX: this.sway.x * LEAN_ANGLE_X_DEG,
      angleZ: this.sway.x * LEAN_ANGLE_Z_DEG + this.tumble,
      bodyAngleZ: this.sway.x * LEAN_BODY_Z_DEG,
      tumbleDeg: this.tumble,
      squash: this.squashValue,
      moving,
    };
  }
}
