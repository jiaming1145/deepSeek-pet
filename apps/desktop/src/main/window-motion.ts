/**
 * §7 — WindowMotionController (R3-5): main owns the whole locomotion lane.
 *
 * Semi-implicit Euler at a fixed substep with an accumulator (Fiedler), a spring/damper drag that
 * follows the GLOBAL cursor, a 4-sample EMA release velocity, gravity + air drag + edge bounce with
 * a swept collision (never post-hoc clamping), a one-shot landing, symbolic `walkTo`, and clamps
 * that keep Phase 1's 48-DIP grabbable rule. The renderer only interpolates the 30 Hz snapshots
 * (§5.5) and never calls setPosition.
 */
import type { BrowserWindow } from 'electron';
import { WALK_ANCHORS, type Landing, type WalkAnchor, type WindowMotion } from '@ds/protocol';
import { CHAT_GAP } from '../renderer/shared/chat-metrics';
import {
  AIR_DRAG_X, AIR_DRAG_Y, BOUNCE_DECAY, BOUNCE_RESTITUTION, DRAG_DAMPING, DRAG_MASS, DRAG_MAX_LAG_DIP,
  DRAG_STIFFNESS, FLING_EMA_ALPHA, FLING_SAMPLES, FLING_VELOCITY_CAP, GRAVITY_DIP_S2, LANDING_MIN_IMPULSE,
  REST_SPEED_DIP_S, WALK_COOLDOWN_MS, WALK_MAX_MS, WALK_MIN_DISTANCE_DIP, WALK_SPEED_DIP_S,
} from '../renderer/shared/lane-metrics';
import { PET_SIZE } from './pet-window';
import type { TracePayloads } from './trace';
import { clampDrag, MIN_GRABBABLE, type Rect } from './window-state';

// §5.13: one home, re-exported here; nothing below re-declares a number that lives there.
export {
  DRAG_STIFFNESS, DRAG_DAMPING_RATIO, DRAG_MASS, DRAG_DAMPING, DRAG_MAX_LAG_DIP,
  FLING_SAMPLES, FLING_EMA_ALPHA, FLING_VELOCITY_CAP, GRAVITY_DIP_S2, BOUNCE_RESTITUTION, BOUNCE_DECAY,
  REST_SPEED_DIP_S, AIR_DRAG_X, AIR_DRAG_Y, LANDING_MIN_IMPULSE,
  WALK_SPEED_DIP_S, WALK_MIN_DISTANCE_DIP, WALK_MAX_MS, WALK_COOLDOWN_MS, TAP_SLOP_DIP,
} from '../renderer/shared/lane-metrics';
export { MIN_GRABBABLE };

export const MOTOR_HZ = 60;                 // R3-5: "at 60 Hz on the GLOBAL cursor"
export const MOTOR_SUBSTEP_S = 1 / 120;     // two substeps per motor frame
export const MOTOR_FRAME_CLAMP_S = 0.25;    // Fiedler's frameTime clamp
export const SNAPSHOT_HZ = 30;              // R3-5: sim:windowMotion at 30 Hz

export interface WindowMotionDeps {
  pet: BrowserWindow;
  /** screen.getCursorScreenPoint(), injected so the motor is testable without Electron. */
  cursor(): { x: number; y: number };
  /** Work areas of every current display, DIP. */
  workAreas(): Rect[];
  /** The work area of the display the pet is on, DIP. */
  workArea(): Rect;
  setPosition(x: number, y: number): void;
  setClickThrough(ignore: boolean): void;
  /** Suspends/resumes the `avatar:hover` -> click-through switching (R3-5). */
  suspendHoverSwitching(suspend: boolean): void;
  send(channel: 'sim:windowMotion' | 'sim:landing', payload: WindowMotion | Landing): void;
  persist(x: number, y: number): void;              // -> savePetPosition (window.json)
  /**
   * §12.2's `motion` and `landing` trace records, whose Source column names this class
   * ("`motion` | phase, generation, vx, vy, lagX, lagY, clamped (bool) | WindowMotionController").
   * Optional so the unit lane and the §12.7 fixtures construct the controller without a writer;
   * Task 15 passes `(t, p) => trace.write(t, p)` — the signature is `TraceWriter.write` narrowed to
   * the two kinds this class owns. Without it `clamped` is unobservable and B-07's "emitted" column
   * (motion records continue with the same generation and `clamped: true`) cannot be asserted
   * anywhere: `WindowMotionSchema` has no `clamped` field and never will (it is a diagnostic, not a
   * renderer input).
   */
  trace?<K extends 'motion' | 'landing'>(t: K, payload: TracePayloads[K]): void;
  now?: () => number;                                // monotonic ms; default hrtime
}

export type MotionPhase = 'rest' | 'drag' | 'fling' | 'walk' | 'settling';

/** Convai's typed outcome taxonomy (research §8), so a failed walk is never a silent stall. */
export type WalkOutcome =
  | 'started' | 'alreadyAtDestination' | 'unreachable' | 'busy' | 'unknownDestination';

type Vec = { x: number; y: number };
type Sample = { x: number; y: number; t: number };
type Edge = Landing['edge'];

const defaultNow = (): number => Number(process.hrtime.bigint()) / 1e6;
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
const SNAPSHOT_EVERY = MOTOR_HZ / SNAPSHOT_HZ; // 2: every second motor frame

/** §7.6's anchor table. `W` is the current display's work area, `S` the pet size. */
export function walkTarget(anchor: WalkAnchor, W: Rect, current: Vec, home: Vec): Vec {
  const S = PET_SIZE;
  switch (anchor) {
    case 'left': return { x: W.x + CHAT_GAP, y: current.y };
    case 'right': return { x: W.x + W.width - S.w - CHAT_GAP, y: current.y };
    case 'center': return { x: W.x + (W.width - S.w) / 2, y: current.y };
    case 'corner-bl': return { x: W.x + CHAT_GAP, y: W.y + W.height - S.h };
    case 'corner-br': return { x: W.x + W.width - S.w - CHAT_GAP, y: W.y + W.height - S.h };
    case 'home': return { x: home.x, y: home.y };
  }
}

export class WindowMotionController {
  private readonly deps: WindowMotionDeps;
  private readonly now: () => number;
  private _phase: MotionPhase = 'rest';
  private _generation = 0;
  private pos: Vec;
  private vel: Vec = { x: 0, y: 0 };
  private offset: Vec = { x: 0, y: 0 };
  private lag: Vec = { x: 0, y: 0 };
  private contact: { x: number; y: number } | null = null;
  private pressId = -1;
  private samples: Sample[] = [];
  private bounces = 0;
  private landed = false;
  private walk: { targetX: number; startedAt: number } | null = null;
  private lastWalkAt = Number.NEGATIVE_INFINITY;
  /** §7.6 `home`: the launch position (createPetWindow placed the window at window.json's clamp). */
  private readonly home: Vec;
  private timer: ReturnType<typeof setInterval> | null = null;
  private acc = 0;
  private lastFrameAt = 0;
  private frameIndex = 0;
  private clamped = false;
  private disposed = false;

  constructor(deps: WindowMotionDeps) {
    this.deps = deps;
    this.now = deps.now ?? defaultNow;
    const [x, y] = deps.pet.getPosition();
    this.home = { x, y };
    this.pos = { x, y };
  }

  get phase(): MotionPhase { return this._phase; }
  get generation(): number { return this._generation; }

  /** From `arb:grab`. Starts a new generation and the drag. */
  grab(p: { pressId: number; modelX: number; modelY: number; screenX: number; screenY: number }): void {
    if (this.disposed || this.deps.pet.isDestroyed()) return;
    // §7.6: an active drag outranks a walk (or a fling); the old episode ends `cancelled` without a
    // rest frame — the new generation's first drag frame supersedes it in the renderer.
    if (this._phase !== 'rest') this.endEpisode('cancelled', { persist: false, restFrame: false, resumeHover: false });
    this._generation += 1;
    const [wx, wy] = this.deps.pet.getPosition();
    this.pos = { x: wx, y: wy };
    this.vel = { x: 0, y: 0 };
    this.lag = { x: 0, y: 0 };
    this.offset = { x: wx - p.screenX, y: wy - p.screenY };
    this.contact = { x: p.modelX, y: p.modelY };
    this.pressId = p.pressId;
    this.samples = [{ x: p.screenX, y: p.screenY, t: this.now() }];
    this.bounces = 0;
    this.landed = false;
    this.walk = null;
    this._phase = 'drag';
    this.deps.suspendHoverSwitching(true);
    this.deps.setClickThrough(false); // R3-5: the window stays interactive during a user drag
    this.startMotor();
  }

  /** From `arb:release`. `wasTap` true -> settle in place, no fling. */
  release(p: { pressId: number; wasTap: boolean }): void {
    if (this._phase !== 'drag' || p.pressId !== this.pressId) return; // stale release (§7.2 step 5)
    this.lag = { x: 0, y: 0 };
    if (p.wasTap) {
      this.vel = { x: 0, y: 0 };
      this._phase = 'settling';
    } else {
      this.vel = this.releaseVelocity();
      this._phase = 'fling';
    }
    this.deps.setClickThrough(true); // §7.6: forced click-through for every autonomous phase
  }

  /** From an LLM `walkTo` (§2.6) or an idle `wander` behaviour. Returns the typed outcome. */
  walkTo(anchor: WalkAnchor, source: 'llm' | 'behaviour'): WalkOutcome {
    if (!(WALK_ANCHORS as readonly string[]).includes(anchor)) {
      console.warn('[motion] walkTo unknown destination', String(anchor));
      return 'unknownDestination';
    }
    if (this.disposed || this.deps.pet.isDestroyed()) return 'unreachable';
    const t = this.now();
    if (this._phase !== 'rest' || t - this.lastWalkAt < WALK_COOLDOWN_MS) return 'busy';
    const [wx, wy] = this.deps.pet.getPosition();
    this.pos = { x: wx, y: wy };
    const target = walkTarget(anchor, this.deps.workArea(), this.pos, this.home);
    const safe = clampDrag({ ...target, w: PET_SIZE.w, h: PET_SIZE.h }, this.deps.workAreas(), MIN_GRABBABLE);
    if (Math.abs(safe.x - target.x) > WALK_MIN_DISTANCE_DIP || Math.abs(safe.y - target.y) > WALK_MIN_DISTANCE_DIP) {
      console.log('[motion] walkTo', anchor, source, 'unreachable');
      return 'unreachable';
    }
    if (Math.hypot(target.x - this.pos.x, target.y - this.pos.y) < WALK_MIN_DISTANCE_DIP) return 'alreadyAtDestination';
    this._generation += 1;
    this.vel = { x: 0, y: 0 };
    this.lag = { x: 0, y: 0 };
    this.contact = null;
    this.bounces = 0;
    this.landed = false;
    this.walk = { targetX: target.x, startedAt: t };
    this.lastWalkAt = t;
    this._phase = 'walk';
    this.deps.setClickThrough(true);
    this.startMotor();
    console.log('[motion] walkTo', anchor, source, 'started', this._generation);
    return 'started';
  }

  /** display-removed / display-metrics-changed. Rebases the active episode (R3-5). */
  rebase(): void {
    if (this.disposed || this.deps.pet.isDestroyed()) return;
    const areas = this.deps.workAreas();
    if (this._phase === 'rest') {
      const [wx, wy] = this.deps.pet.getPosition();
      const safe = clampDrag({ x: wx, y: wy, w: PET_SIZE.w, h: PET_SIZE.h }, areas, MIN_GRABBABLE);
      this.pos = { x: safe.x, y: safe.y };
      if (safe.x !== wx || safe.y !== wy) {
        this.deps.setPosition(Math.round(safe.x), Math.round(safe.y));
        this.deps.persist(Math.round(safe.x), Math.round(safe.y));
      }
      return;
    }
    // A live episode: re-clamp, keep the velocity, keep the generation (§7.7).
    const safe = clampDrag({ ...this.pos, w: PET_SIZE.w, h: PET_SIZE.h }, areas, MIN_GRABBABLE);
    if (safe.x !== this.pos.x || safe.y !== this.pos.y) {
      this.pos = { x: safe.x, y: safe.y };
      this.clamped = true;
    }
    if (this.walk) {
      const t = clampDrag({ x: this.walk.targetX, y: this.pos.y, w: PET_SIZE.w, h: PET_SIZE.h }, areas, MIN_GRABBABLE);
      this.walk.targetX = t.x;
    }
  }

  /** Cancels any live episode with `cancelled`; used by dispose and by VisibilityState hide. */
  cancel(): void {
    if (this._phase === 'rest') return;
    this.endEpisode('cancelled', { persist: true, restFrame: true, resumeHover: true });
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
  }

  // ---- motor ----------------------------------------------------------------------------------

  private startMotor(): void {
    if (this.timer) return;
    this.lastFrameAt = this.now();
    this.acc = 0;
    this.frameIndex = 0;
    this.timer = setInterval(() => this.frame(), 1000 / MOTOR_HZ);
  }

  private stopMotor(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private frame(): void {
    if (this.deps.pet.isDestroyed()) { this.endEpisode('cancelled', { persist: false, restFrame: false, resumeHover: true }); return; }
    if (this._phase === 'settling') {
      // One settling frame was already published; this frame lands her.
      this.endEpisode('completed', { persist: true, restFrame: true, resumeHover: true });
      return;
    }
    const t = this.now();
    const real = Math.min(Math.max(0, (t - this.lastFrameAt) / 1000), MOTOR_FRAME_CLAMP_S);
    this.lastFrameAt = t;
    this.acc += real;
    if (this._phase === 'drag') this.sample(t);
    // `this.phase`, not `this._phase`: the early return above narrowed `_phase` to exclude
    // 'settling' for the rest of this method, and TypeScript cannot see that `substep` (a floor
    // contact under REST_SPEED_DIP_S, or a walk arriving) puts it back. Reading through the public
    // getter is the same value with the narrowing dropped — TS2367 otherwise.
    while (this.acc >= MOTOR_SUBSTEP_S && this.phase !== 'settling') {
      this.substep(MOTOR_SUBSTEP_S, t);
      this.acc -= MOTOR_SUBSTEP_S;
    }
    this.writePosition();
    this.frameIndex += 1;
    if (this.frameIndex % SNAPSHOT_EVERY === 0 || this.phase === 'settling') this.snapshot();
  }

  private sample(t: number): void {
    const c = this.deps.cursor();
    this.samples.push({ x: c.x, y: c.y, t });
    if (this.samples.length > FLING_SAMPLES) this.samples.shift();
  }

  private substep(dt: number, t: number): void {
    switch (this._phase) {
      case 'drag': this.stepDrag(dt); break;
      case 'fling': this.stepFling(dt); break;
      case 'walk': this.stepWalk(dt, t); break;
      default: break;
    }
  }

  /** §7.4: per axis, `lag = clamp(target − pos, ±24)`, `a = (k·lag − c·v)/m`. */
  private stepDrag(dt: number): void {
    const c = this.deps.cursor();
    const target = { x: c.x + this.offset.x, y: c.y + this.offset.y };
    this.lag = {
      x: clamp(target.x - this.pos.x, -DRAG_MAX_LAG_DIP, DRAG_MAX_LAG_DIP),
      y: clamp(target.y - this.pos.y, -DRAG_MAX_LAG_DIP, DRAG_MAX_LAG_DIP),
    };
    const ax = (DRAG_STIFFNESS * this.lag.x - DRAG_DAMPING * this.vel.x) / DRAG_MASS;
    const ay = (DRAG_STIFFNESS * this.lag.y - DRAG_DAMPING * this.vel.y) / DRAG_MASS;
    this.vel.x += ax * dt;
    this.vel.y += ay * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
  }

  /** §7.5 fling substep: gravity, air drag, swept move with bounce. */
  private stepFling(dt: number): void {
    this.vel.y += GRAVITY_DIP_S2 * dt;
    this.vel.x *= Math.exp(-AIR_DRAG_X * dt);
    this.vel.y *= Math.exp(-AIR_DRAG_Y * dt);
    this.sweep(dt, true);
  }

  /** §7.6: horizontal at WALK_SPEED_DIP_S, gravity on the vertical axis, no bounce. */
  private stepWalk(dt: number, t: number): void {
    const w = this.walk!;
    if (t - w.startedAt > WALK_MAX_MS) {
      console.log('[motion] walkTo', 'unreachable', this._generation);
      this.vel = { x: 0, y: 0 };
      this._phase = 'settling';
      return;
    }
    const dx = w.targetX - this.pos.x;
    const step = WALK_SPEED_DIP_S * dt;
    let arrived = false;
    if (Math.abs(dx) <= step) { this.pos.x = w.targetX; this.vel.x = 0; arrived = true; }
    else this.vel.x = Math.sign(dx) * WALK_SPEED_DIP_S;
    this.vel.y += GRAVITY_DIP_S2 * dt;
    this.sweep(dt, false);
    const W = this.deps.workArea();
    const onFloor = this.pos.y >= W.y + W.height - PET_SIZE.h - 0.5;
    if (arrived && onFloor) { this.vel = { x: 0, y: 0 }; this._phase = 'settling'; }
  }

  /**
   * §7.5 tunnelling sweep: the segment pos → pos + v·dt is intersected with the four work-area
   * edges of the display she is on; the FIRST hit is resolved, then the remainder of the step runs.
   */
  private sweep(dt: number, bounce: boolean): void {
    const W = this.deps.workArea();
    const floorY = W.y + W.height - PET_SIZE.h;
    const rightX = W.x + W.width - PET_SIZE.w;
    let remaining = dt;
    for (let i = 0; i < 4 && remaining > 0; i++) {
      const dx = this.vel.x * remaining;
      const dy = this.vel.y * remaining;
      let tHit = 1;
      let edge: Edge | null = null;
      if (dy > 0 && this.pos.y + dy > floorY) { const tt = Math.max(0, (floorY - this.pos.y) / dy); if (tt < tHit) { tHit = tt; edge = 'floor'; } }
      if (dy < 0 && this.pos.y + dy < W.y) { const tt = Math.max(0, (W.y - this.pos.y) / dy); if (tt < tHit) { tHit = tt; edge = 'ceiling'; } }
      if (dx > 0 && this.pos.x + dx > rightX) { const tt = Math.max(0, (rightX - this.pos.x) / dx); if (tt < tHit) { tHit = tt; edge = 'right'; } }
      if (dx < 0 && this.pos.x + dx < W.x) { const tt = Math.max(0, (W.x - this.pos.x) / dx); if (tt < tHit) { tHit = tt; edge = 'left'; } }
      this.pos.x += dx * tHit;
      this.pos.y += dy * tHit;
      if (!edge) return;
      if (edge === 'floor') this.pos.y = floorY;
      else if (edge === 'ceiling') this.pos.y = W.y;
      else if (edge === 'right') this.pos.x = rightX;
      else this.pos.x = W.x;
      this.contactEdge(edge, bounce);
      if (this._phase === 'settling') return;
      remaining *= 1 - tHit;
    }
  }

  private contactEdge(edge: Edge, bounce: boolean): void {
    const axis: 'x' | 'y' = edge === 'floor' || edge === 'ceiling' ? 'y' : 'x';
    const speed = Math.abs(this.vel[axis]);
    // §7.5 landing: the FIRST floor contact of an episode, one shot, generation-stamped.
    if (edge === 'floor' && !this.landed) {
      this.landed = true;
      if (speed >= LANDING_MIN_IMPULSE) {
        const impulse = Math.min(speed, FLING_VELOCITY_CAP);
        this.deps.send('sim:landing', {
          generation: this._generation,
          tsMain: this.now(),
          impulse,
          edge,
        });
        // §12.2 `landing`, same Source column as `motion`. Mirrors the IPC exactly: a contact under
        // LANDING_MIN_IMPULSE is not a landing on either wire.
        this.deps.trace?.('landing', { generation: this._generation, impulse, edge });
      }
    }
    if (bounce && speed >= REST_SPEED_DIP_S) {
      const k = BOUNCE_RESTITUTION * BOUNCE_DECAY ** this.bounces;
      this.bounces += 1;
      this.vel[axis] = -this.vel[axis] * k; // normal reflected and scaled; tangential untouched
    } else {
      // A RESTING contact, not a bounce: below REST_SPEED_DIP_S the normal component is simply
      // killed and the episode's bounce count is left alone. Without this, a pet sliding along the
      // floor re-contacts it on EVERY substep (gravity re-adds ~15 DIP/s, the sweep resolves it at
      // t = 0) and each of those degenerate touches would consume one BOUNCE_DECAY — after ~30
      // substeps 0.8^n is 0.001 and the next real wall hit reflects nothing at all, which is
      // exactly what R3-5's "restitution 0.35" forbids.
      this.vel[axis] = 0;
    }
    if (edge === 'floor' && bounce && Math.hypot(this.vel.x, this.vel.y) < REST_SPEED_DIP_S) {
      this.vel = { x: 0, y: 0 };
      this._phase = 'settling';
    }
  }

  /** §7.5 release velocity: EMA(α = 0.5) over the deltas of the last 4 samples, capped per axis. */
  private releaseVelocity(): Vec {
    const s = this.samples;
    let v: Vec | null = null;
    for (let i = 1; i < s.length; i++) {
      const dtS = (s[i].t - s[i - 1].t) / 1000;
      if (dtS <= 0) continue;
      const d = { x: (s[i].x - s[i - 1].x) / dtS, y: (s[i].y - s[i - 1].y) / dtS };
      v = v
        ? { x: v.x + (d.x - v.x) * FLING_EMA_ALPHA, y: v.y + (d.y - v.y) * FLING_EMA_ALPHA }
        : d;
    }
    if (!v) return { x: 0, y: 0 };
    return {
      x: clamp(v.x, -FLING_VELOCITY_CAP, FLING_VELOCITY_CAP),
      y: clamp(v.y, -FLING_VELOCITY_CAP, FLING_VELOCITY_CAP),
    };
  }

  /** §7.7: every write goes through clampDrag(pos, workAreas(), MIN_GRABBABLE); once per frame. */
  private writePosition(): void {
    const safe = clampDrag({ ...this.pos, w: PET_SIZE.w, h: PET_SIZE.h }, this.deps.workAreas(), MIN_GRABBABLE);
    if (safe.x !== this.pos.x || safe.y !== this.pos.y) {
      this.pos = { x: safe.x, y: safe.y };
      this.clamped = true;
    }
    this.deps.setPosition(Math.round(this.pos.x), Math.round(this.pos.y));
  }

  /** §7.8: `WindowMotionSchema`, `tsMain` in main's monotonic domain. */
  private snapshot(): void {
    const dragging = this._phase === 'drag';
    const vx = clamp(this.vel.x, -FLING_VELOCITY_CAP, FLING_VELOCITY_CAP);
    const vy = clamp(this.vel.y, -FLING_VELOCITY_CAP, FLING_VELOCITY_CAP);
    const lagX = dragging ? this.lag.x : 0;
    const lagY = dragging ? this.lag.y : 0;
    this.deps.send('sim:windowMotion', {
      generation: this._generation,
      tsMain: this.now(),
      phase: this._phase,
      vx,
      vy,
      lagX,
      lagY,
      contact: this.contact,
    });
    // §12.2 `motion`. `clamped` means "a clampDrag pull happened since the last snapshot", so it is
    // cleared HERE and not at the top of frame(): a rebase() runs between frames (display-removed
    // arrives on the Electron event loop, never inside the motor tick) and its pull must survive
    // into the record that reports it — B-07's whole point.
    this.deps.trace?.('motion', { phase: this._phase, generation: this._generation, vx, vy, lagX, lagY, clamped: this.clamped });
    this.clamped = false;
  }

  /** §7.5 settling → rest, and the `cancelled` path shared by grab-supersede, cancel and dispose. */
  private endEpisode(
    result: 'completed' | 'cancelled',
    opts: { persist: boolean; restFrame: boolean; resumeHover: boolean },
  ): void {
    const ended = this._phase;
    this._phase = 'rest';
    this.vel = { x: 0, y: 0 };
    this.lag = { x: 0, y: 0 };
    // §7.6 "at most … one per WALK_COOLDOWN_MS" is measured from the END of the walk. Measured from
    // the start it would be no cooldown at all for any walk longer than 5 s (a 988-DIP crossing at
    // WALK_SPEED_DIP_S takes 8.2 s), so the next walkTo could fire on the frame she arrives.
    if (this.walk) this.lastWalkAt = this.now();
    this.walk = null;
    this.stopMotor();
    if (opts.persist && !this.deps.pet.isDestroyed()) this.deps.persist(Math.round(this.pos.x), Math.round(this.pos.y));
    if (opts.restFrame) this.snapshot();
    if (opts.resumeHover) {
      // Autonomous phases forced click-through on; a user drag left the window interactive. The
      // hover switch resumes from here and flips it on the next avatar:hover change.
      if (ended !== 'drag') this.deps.setClickThrough(true);
      this.deps.suspendHoverSwitching(false);
    }
    console.log('[motion] episode', this._generation, ended, result);
  }
}
