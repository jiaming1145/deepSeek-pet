import type { LaneResult, LaneSource, LookAnchor, LookTarget, PresentationMode } from '@ds/protocol';
import { LaneHolder, type LaneLease, type LanePolicy } from './lanes';

export type GazeState = 'follow' | 'saccadeBreak' | 'restDrift' | 'sleep';

export const CURSOR_REST_MS = 5_000;        // D3: "stops following after 5 s of cursor rest"
export const CURSOR_REST_EPS_DIP = 2;       // movement below this does not reset the rest timer
export const SACCADE_MIN_MS = 8_000;        // D3: "every 8-20 s"
export const SACCADE_MAX_MS = 20_000;
export const SACCADE_SIGMA_MS = 4_000;      // research §5: gamma/lognormal, mean 13 s, SD 4 s
export const SACCADE_SUPPRESS_MS = 4_000;   // no second break within 4 s of one
/** Break-type weights (research §5). Randomising the TYPE is what kills the metronome feel. */
export const SACCADE_TYPES = [
  { type: 'lookAwayBack', weight: 0.60, offsetDeg: [15, 35], holdMs: [500, 1_600], returnMs: 150 },
  { type: 'microFidget',  weight: 0.25, offsetDeg: [3, 5],   holdMs: [500, 700],   returnMs: 300 },
  { type: 'doubleGlance', weight: 0.15, offsetDeg: [10, 20], holdMs: [180, 220],   returnMs: 150 },
] as const;
/** Research §5: below this the shift is EYES ONLY; above it the head leads by GAZE_HEAD_DELAY_MS. */
export const EYES_ONLY_THRESHOLD_DEG = 12;
export const GAZE_HEAD_DELAY_MS = 100;      // eyes lead, head follows (58-200 ms measured)
export const GAZE_HEAD_FRACTION = 0.65;     // the head reaches ~65 % of the residual
export const GAZE_BODY_DELAY_MS = 480;      // torso lags the head
export const GAZE_BODY_FRACTION = 0.20;

export type SaccadeType = (typeof SACCADE_TYPES)[number]['type'];
/** §5.6: an LLM `look` lease pre-empts the idle saccade with source 'llm', ttlMs = 6_000. */
export const LOOK_LEASE_TTL_MS = 6_000;
/** Phase 1 CubismLook maps a normalised 1.0 to ParamAngleX/Y 30°; degrees ↔ normalised go through this. */
export const GAZE_DEG_FULL_SCALE = 30;
/** §5.6 `away` → a seeded ±(20–30°) offset. */
export const AWAY_OFFSET_DEG: readonly [number, number] = [20, 30];
/** CONTRACT GAP: §5.6 names the `sleep` and `restDrift` states but not their targets. Defaults here. */
export const SLEEP_GAZE = { x: 0, y: -0.5 } as const;
export const REST_DRIFT_GAZE = { x: 0, y: 0 } as const;

// `LookTarget` is NOT redeclared here: Task 1 exports it from `@ds/protocol` and Task 5's `act.ts`
// re-exports the same type. Imported at the top of this file (self-review fix; Task 1 Concern 2).
export interface Point { x: number; y: number }
export interface GazePayload extends Point { followCursor: boolean }
export interface GazeTargets { eyes: Point; head: Point; body: Point }

export interface GazeLaneDeps {
  /** Uniform [0,1). Seeded in ?test=1 (the arbiter passes the stage rng). */
  rng(): number;
  /** Phase 1 `GazeDriver.setTarget` — receives the EYES target every tick. */
  setTarget(x: number, y: number): void;
  /** Task 13 wraps this into `arb:trace {kind:'gazeBreak', label, value}` (degrees). */
  trace(rec: { kind: 'gazeBreak'; label: SaccadeType; value: number }): void;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Lognormal sample with arithmetic mean `meanMs` and SD `sigmaMs`, from two uniforms (Box–Muller). */
export function lognormalDraw(meanMs: number, sigmaMs: number, u1: number, u2: number): number {
  const m = Math.max(1, meanMs);
  const s2 = Math.log(1 + (sigmaMs * sigmaMs) / (m * m));
  const mu = Math.log(m) - s2 / 2;
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-12))) * Math.cos(2 * Math.PI * u2);
  return Math.exp(mu + Math.sqrt(s2) * z);
}

/** The D3 draw: lognormal around livelinessMap(L).saccadeIntervalMs, clamped to [8 000, 20 000]. */
export function drawSaccadeInterval(meanMs: number, rng: () => number): number {
  return clamp(lognormalDraw(meanMs, SACCADE_SIGMA_MS, rng(), rng()), SACCADE_MIN_MS, SACCADE_MAX_MS);
}

export function pickSaccadeType(u: number): SaccadeType {
  let acc = 0;
  for (const t of SACCADE_TYPES) {
    acc += t.weight;
    if (u < acc) return t.type;
  }
  return SACCADE_TYPES[SACCADE_TYPES.length - 1].type;
}

/** §5.6 anchor → normalised target map. */
export function anchorTarget(anchor: LookAnchor, cursor: Point, rng: () => number): Point {
  switch (anchor) {
    case 'cursor': return { x: cursor.x, y: cursor.y };
    case 'user': return { x: 0, y: 0.15 };
    case 'screen': return { x: 0, y: 0.35 };
    case 'up': return { x: 0, y: 0.7 };
    case 'down': return { x: 0, y: -0.7 };
    case 'left': return { x: -0.7, y: 0 };
    case 'right': return { x: 0.7, y: 0 };
    case 'away': {
      const deg = lerp(AWAY_OFFSET_DEG[0], AWAY_OFFSET_DEG[1], rng());
      const sign = rng() < 0.5 ? -1 : 1;
      return { x: (sign * deg) / GAZE_DEG_FULL_SCALE, y: 0 };
    }
  }
}

const RANK: Record<LaneSource, number> = { touch: 3, llm: 2, behaviour: 1, sim: 1, idle: 0, drag: 0 };
/** §5.1 gaze row: touch (target) > llm (look lease) > behaviour/sim > idle. Equal rank ⇒ newer wins. */
export const gazePolicy: LanePolicy<GazePayload> = (incoming, current) => RANK[incoming.source] >= RANK[current.source];

interface Break { type: SaccadeType; offset: Point; phase: 'hold' | 'return' | 'hold2' | 'return2'; phaseEndsAt: number; holdMs: number; returnMs: number }

export class GazeLane {
  readonly holder = new LaneHolder<GazePayload>('gaze', gazePolicy);
  private st: GazeState = 'follow';
  private cursor: Point = { x: 0, y: 0 };
  private cursorDip: Point = { x: Number.NaN, y: Number.NaN };
  private cursorMovedAt: number;
  private presentation: PresentationMode = 'awake';
  private meanMs = 16_400;     // livelinessMap(0.30).saccadeIntervalMs until setLiveliness runs
  private amplitude = 0.65;    // livelinessMap(0.30).saccadeAmplitude
  private nextBreakAt: number;
  private suppressUntil = 0;
  private brk: Break | null = null;
  private eyes: Point = { x: 0, y: 0 };
  private head: Point = { x: 0, y: 0 };
  private body: Point = { x: 0, y: 0 };
  private jump: { at: number; deg: number; from: Point; headDone: boolean; bodyDone: boolean } | null = null;

  constructor(private readonly deps: GazeLaneDeps, nowMs: number) {
    this.cursorMovedAt = nowMs;
    this.nextBreakAt = nowMs + drawSaccadeInterval(this.meanMs, deps.rng);
  }

  get state(): GazeState { return this.st; }

  /** Task 3's LivelinessMap fields, passed as numbers by the arbiter. */
  setLiveliness(map: { saccadeIntervalMs: number; saccadeAmplitude: number }): void {
    this.meanMs = map.saccadeIntervalMs;
    this.amplitude = map.saccadeAmplitude;
  }

  setPresentation(mode: PresentationMode): void { this.presentation = mode; }

  /** `x,y` normalised [-1,1] (ViewTransform.toGaze); `dipX,dipY` for the CURSOR_REST_EPS_DIP test. */
  setCursor(c: { x: number; y: number; dipX: number; dipY: number }, nowMs: number): void {
    const moved = !Number.isFinite(this.cursorDip.x)
      || Math.hypot(c.dipX - this.cursorDip.x, c.dipY - this.cursorDip.y) >= CURSOR_REST_EPS_DIP;
    if (moved) {
      this.cursorDip = { x: c.dipX, y: c.dipY };
      this.cursorMovedAt = nowMs;
      if (this.st === 'restDrift') this.st = 'follow';
    }
    this.cursor = { x: c.x, y: c.y };
  }

  /** §2.6 `look` consumer: source 'llm', ttl LOOK_LEASE_TTL_MS. */
  look(target: LookTarget, nowMs: number, onResult?: (r: LaneResult) => void): LaneLease<GazePayload> | null {
    const payload: GazePayload = target.kind === 'anchor'
      ? { ...anchorTarget(target.anchor, this.cursor, this.deps.rng), followCursor: target.anchor === 'cursor' }
      : { x: clamp(target.x, -1, 1), y: clamp(target.y, -1, 1), followCursor: false };
    return this.grant({ lane: 'gaze', source: 'llm', generation: 0, ttlMs: LOOK_LEASE_TTL_MS, payload, onResult }, nowMs);
  }

  /** Touch / hover-ack / D6 gaze targets (`cursorLock` = followCursor:true). */
  touchTarget(payload: GazePayload, ttlMs: number, nowMs: number, onResult?: (r: LaneResult) => void): LaneLease<GazePayload> | null {
    return this.grant({ lane: 'gaze', source: 'touch', generation: 0, ttlMs, payload, onResult }, nowMs);
  }

  /** Behaviour / sim gaze leases (Task 13 maps GAZE_PATTERNS onto payloads). */
  request(source: 'behaviour' | 'sim', payload: GazePayload, ttlMs: number, nowMs: number, onResult?: (r: LaneResult) => void): LaneLease<GazePayload> | null {
    return this.grant({ lane: 'gaze', source, generation: 0, ttlMs, payload, onResult }, nowMs);
  }

  end(result: LaneResult, nowMs: number): void {
    if (this.holder.current) { this.holder.end(result, nowMs); this.afterLease(nowMs); }
  }

  endIf(generation: number, result: LaneResult, nowMs: number): boolean {
    const ok = this.holder.endIf(generation, result, nowMs);
    if (ok) this.afterLease(nowMs);
    return ok;
  }

  /** Per frame: advances the state machine and pushes the eyes target into the GazeDriver. */
  tick(nowMs: number): GazeTargets {
    if (this.holder.tick(nowMs)) this.afterLease(nowMs);
    const lease = this.holder.current;
    let target: Point;
    if (this.presentation === 'sleep') {
      this.st = 'sleep'; this.brk = null; target = SLEEP_GAZE;
    } else if (lease) {
      if (this.st !== 'follow') this.st = 'follow';
      this.brk = null;
      target = lease.payload.followCursor ? this.cursor : lease.payload;
    } else {
      if (this.st === 'sleep') this.st = 'follow';
      if (this.st !== 'saccadeBreak' && nowMs - this.cursorMovedAt >= CURSOR_REST_MS) this.st = 'restDrift';
      const base = this.st === 'restDrift' ? REST_DRIFT_GAZE : this.cursor;
      if (this.st !== 'saccadeBreak' && nowMs >= this.nextBreakAt && nowMs >= this.suppressUntil) this.startBreak(nowMs);
      target = this.brk ? this.breakTarget(base, nowMs) : base;
    }
    this.setEyes(target, nowMs);
    this.lag(nowMs);
    this.deps.setTarget(this.eyes.x, this.eyes.y);
    return { eyes: { ...this.eyes }, head: { ...this.head }, body: { ...this.body } };
  }

  private grant(cmd: Parameters<LaneHolder<GazePayload>['request']>[0], nowMs: number): LaneLease<GazePayload> | null {
    const lease = this.holder.request(cmd, nowMs);
    if (lease) { this.brk = null; if (this.st === 'saccadeBreak') this.st = 'follow'; }
    return lease;
  }

  private afterLease(nowMs: number): void {
    this.suppressUntil = nowMs + SACCADE_SUPPRESS_MS;
    this.nextBreakAt = Math.max(this.nextBreakAt, this.suppressUntil);
  }

  private startBreak(nowMs: number): void {
    const type = pickSaccadeType(this.deps.rng());
    const spec = SACCADE_TYPES.find((t) => t.type === type)!;
    const deg = lerp(spec.offsetDeg[0], spec.offsetDeg[1], this.deps.rng()) * this.amplitude;
    const sign = this.deps.rng() < 0.5 ? -1 : 1;
    const holdMs = lerp(spec.holdMs[0], spec.holdMs[1], this.deps.rng());
    this.brk = {
      type, offset: { x: (sign * deg) / GAZE_DEG_FULL_SCALE, y: 0 },
      phase: 'hold', phaseEndsAt: nowMs + holdMs, holdMs, returnMs: spec.returnMs,
    };
    this.st = 'saccadeBreak';
    this.deps.trace({ kind: 'gazeBreak', label: type, value: deg });
  }

  private breakTarget(base: Point, nowMs: number): Point {
    const b = this.brk!;
    while (nowMs >= b.phaseEndsAt) {
      if (b.phase === 'hold') { b.phase = 'return'; b.phaseEndsAt += b.returnMs; }
      else if (b.phase === 'return' && b.type === 'doubleGlance') { b.phase = 'hold2'; b.phaseEndsAt += b.holdMs; }
      else if (b.phase === 'hold2') { b.phase = 'return2'; b.phaseEndsAt += b.returnMs; }
      else { return this.endBreak(nowMs, base); }
    }
    const away = b.phase === 'hold' || b.phase === 'hold2';
    return away ? { x: clamp(base.x + b.offset.x, -1, 1), y: base.y } : base;
  }

  private endBreak(nowMs: number, base: Point): Point {
    this.brk = null;
    this.st = nowMs - this.cursorMovedAt >= CURSOR_REST_MS ? 'restDrift' : 'follow';
    this.suppressUntil = nowMs + SACCADE_SUPPRESS_MS;
    this.nextBreakAt = Math.max(nowMs + drawSaccadeInterval(this.meanMs, this.deps.rng), this.suppressUntil);
    return base;
  }

  private setEyes(t: Point, nowMs: number): void {
    const deg = Math.hypot(t.x - this.eyes.x, t.y - this.eyes.y) * GAZE_DEG_FULL_SCALE;
    if (deg > 0) this.jump = { at: nowMs, deg, from: { ...this.eyes }, headDone: false, bodyDone: false };
    this.eyes = { x: t.x, y: t.y };
  }

  /** Research §5 lag model: below EYES_ONLY_THRESHOLD_DEG only the eyes move; above it the head
   *  takes GAZE_HEAD_FRACTION of the residual after GAZE_HEAD_DELAY_MS and the body GAZE_BODY_FRACTION
   *  after GAZE_BODY_DELAY_MS. Advisory outputs for Task 13 (Phase 1's CubismLook drives head+eyes
   *  from the eyes target; see Concerns). */
  private lag(nowMs: number): void {
    const j = this.jump;
    if (!j || j.deg < EYES_ONLY_THRESHOLD_DEG) return;
    if (!j.headDone && nowMs - j.at >= GAZE_HEAD_DELAY_MS) {
      this.head = { x: lerp(this.head.x, this.eyes.x, GAZE_HEAD_FRACTION), y: lerp(this.head.y, this.eyes.y, GAZE_HEAD_FRACTION) };
      j.headDone = true;
    }
    if (!j.bodyDone && nowMs - j.at >= GAZE_BODY_DELAY_MS) {
      this.body = { x: lerp(this.body.x, this.eyes.x, GAZE_BODY_FRACTION), y: lerp(this.body.y, this.eyes.y, GAZE_BODY_FRACTION) };
      j.bodyDone = true;
    }
  }
}
