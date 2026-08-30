import type { Lane, LaneResult, LaneSource, LookAnchor, Payload, PersonaModeIpc, SimEventKind } from '@ds/protocol';
import { LANE_TTL_MAX_MS } from '@ds/protocol';
import { livelinessMap, type LivelinessMap } from '@ds/sim';
import type { GazePattern, MotionRef, OverlayPreset } from '@ds/behaviors';
import { LaneHolder, type LaneLease } from './lanes';
import {
  EXPR_DECAY_MS, EXPR_HOLD_AFTER_UTTERANCE_MS, EXPR_HOLD_CEILING_MS, EXPR_TOTAL_CEILING_MS,
  baselineExpression, clampExpressionWeight, expressionWeightAt,
} from './expression-lease';
import { LOOK_LEASE_TTL_MS } from './gaze-lane';
import {
  MOTION_FADE_IDLE_S, MOTION_FADE_LLM_S, MOTION_FADE_TOUCH_S, MOTION_GROUP_COOLDOWN_MS,
  MOTION_MIN_PLAY_MS, TOUCH_EXPR_MS, TOUCH_PREEMPT_MAX_MS,
} from '../../shared/lane-metrics';

// ---- D2 blink draw (§5.7) -------------------------------------------------------------------
export const BLINK_MEAN_FOLLOW_MS = 4_000;   // D2's "mean 4 s"
export const BLINK_SIGMA_FOLLOW_MS = 1_500;  // D2's "jitter +- 1.5 s"
export const BLINK_MEAN_REST_MS = 6_500;     // research §5: measured IEBI while screen-focused
export const BLINK_SIGMA_REST_MS = 2_400;
export const BLINK_MIN_INTERVAL_MS = 1_200;  // floor: kills the double-blink artefact
export const BLINK_DOUBLET_P = 0.12;         // 12 % chance of a 250-400 ms doublet
export const BLINK_CLOSED_SLEEPY_S = 0.25;   // lengthened closed time while sleepy
export const BLINK_DOUBLET_MIN_MS = 250;
export const BLINK_DOUBLET_MAX_MS = 400;
/** CubismEyeBlink draws `userTime + rng() * (2 * interval - 1)`; main.ts sets this interval so the
 *  span is 60 s and every lognormal draw below fits without clamping. */
export const BLINK_DRAW_INTERVAL_S = 30.5;
const BLINK_SPAN_MS = (2 * BLINK_DRAW_INTERVAL_S - 1) * 1000;

/** §5.10's sequence and §10.4's leases, ms. */
export const RETURN_GAZE_MS = 900;
export const RETURN_GAZE_EASE_MS = 120;
export const RETURN_EXPR_AT_MS = 120;
export const RETURN_EXPR_MS = 1_200;
export const RETURN_BODY_AT_MS = 150;
export const RETURN_BODY_MS = 1_500;
export const RETURN_EXPR_WEIGHT = 0.4;
export const GLANCE_MS = 900;
export const WIGGLE_MS = 1_200;
/** CONTRACT GAP: §5.5 gives no ttl for touch/LLM BODY leases (Haru motions loop, so completion never
 *  fires); the plan uses TOUCH_EXPR_MS for touch and, for llm, the same 6 s the LLM's own gaze look
 *  lease already runs for (Task 8's LOOK_LEASE_TTL_MS) so one ACT holds one body for one duration. */
export const LLM_BODY_MS = LOOK_LEASE_TTL_MS;

/** Body-lane order §5.1: drag > touch > llm > behaviour > idle; `sim` (§5.10) sits above behaviour
 *  and below llm — CONTRACT GAP recorded, see the task report's Concerns. */
export const SOURCE_RANK: Record<LaneSource, number> = { drag: 5, touch: 4, llm: 3, sim: 2.5, behaviour: 2, idle: 1 };

export function fadeFor(source: LaneSource): number {
  switch (source) {
    case 'llm': return MOTION_FADE_LLM_S;
    case 'behaviour': case 'idle': return MOTION_FADE_IDLE_S;
    default: return MOTION_FADE_TOUCH_S;
  }
}

/** Lognormal with the requested arithmetic mean/sd via Box-Muller on two uniforms. */
export function lognormalMs(meanMs: number, sigmaMs: number, u1: number, u2: number): number {
  const s2 = Math.log(1 + (sigmaMs * sigmaMs) / (meanMs * meanMs));
  const mu = Math.log(meanMs) - s2 / 2;
  const z = Math.sqrt(-2 * Math.log(Math.max(1e-12, 1 - u1))) * Math.cos(2 * Math.PI * u2);
  return Math.exp(mu + Math.sqrt(s2) * z);
}

export type GazeTarget =
  | { kind: 'pattern'; pattern: GazePattern }
  | { kind: 'anchor'; anchor: LookAnchor }
  | { kind: 'point'; x: number; y: number };

export interface BodyPayload {
  id: string;
  motion: MotionRef | null;
  /** §5.5: the overlay preset the body-lane owner asked for; cleared to 'none' when it ends. */
  overlay: OverlayPreset;
  /** Set only for source 'behaviour': what `onBehaviourResult` reports back to the runner. */
  behaviourId: string | null;
}
/** The arbiter's own lane payloads. Deliberately NOT named `ExpressionPayload` / `GazePayload`:
 *  Task 8 exports differently-shaped types under those names from the same `stage/` directory
 *  (`ExpressionPayload {name; weight; utteranceEndAt}`, `GazePayload {x; y; followCursor}`), and one
 *  name must mean one shape. */
export interface ArbExpressionPayload { id: string; name: string | null; weight: number; utteranceEndAt: number | null }
export interface ArbGazePayload { id: string; target: GazeTarget; easeMs?: number }

export interface TouchReaction {
  motion: MotionRef; expression: { name: string; weight: number }; gaze: GazePattern; overlay: OverlayPreset;
}
export interface LlmCommand {
  /** Expression name resolved by the caller from `emotionMap`, or null to clear. */
  expression: string | null;
  motion: MotionRef | null;
  look: { kind: 'anchor'; anchor: LookAnchor } | { kind: 'point'; x: number; y: number } | null;
  emotion: string;
}
export interface BehaviourCommand {
  id: string; motion: MotionRef | null; expression: string | null; expressionWeight: number;
  gaze: GazePattern; overlay: OverlayPreset; durationMs: number;
}
export type BlinkState = 'follow' | 'rest' | 'sleepy' | 'sleep';
export type ArbTraceRecord = Payload<'arb:trace'>;

export interface ArbiterPorts {
  now(): number;
  schedule(fn: () => void, delayMs: number): void;
  trace(rec: ArbTraceRecord): void;
  motion: { startMotionForced(group: string, index: number, fadeInS: number, onFinished?: () => void): boolean };
  expression: { setExpression(name: string | null): void; setExpressionWeight(name: string, w: number): void };
  /** FIX ROUND 1 (finding 4): `easeMs` is the VISUAL snap time §5.10 asks for, `ttlMs` is the lease
   *  lifetime. They are different numbers (the return sequence eases in 120 ms and holds for 900),
   *  and main.ts was feeding the ease to `GazeLane.touchTarget` as its ttl — so a 900 ms gaze lease
   *  released the eyes after 120 ms while the arbiter still believed it owned the lane. */
  gaze: { apply(target: GazeTarget, easeMs?: number, ttlMs?: number): void; release(): void };
  overlay: { set(preset: OverlayPreset): void };
  blink: { force(): void; setSleepy(on: boolean): void };
}

/** One terminal result per lease, ever (§5.2) — mirrors LaneHolder's own guard for hand-built leases. */
function once(fn: (r: LaneResult) => void): (r: LaneResult) => void {
  let fired = false;
  return (r) => { if (fired) return; fired = true; fn(r); };
}

export class Arbiter {
  // Task 8's LaneHolder constructor is `(lane: Lane, policy?)`; the lane name is required. No policy
  // is passed: arbitration is decided HERE (SOURCE_RANK + the §5.1 rows), so a request that reaches
  // a holder has already won and the holder only stamps the generation and the deadline.
  private readonly body = new LaneHolder<BodyPayload>('body');
  private readonly expression = new LaneHolder<ArbExpressionPayload>('expression');
  private readonly gaze = new LaneHolder<ArbGazePayload>('gaze');
  /** The LLM expression lease hidden under a touch cover (R3-4); keeps expiring on its own clock. */
  private covered: LaneLease<ArbExpressionPayload> | null = null;
  private pendingTouchBody: { payload: BodyPayload; swapAt: number } | null = null;
  private appliedExpression: string | null = null;
  private appliedWeight = -1;
  private appliedOverlay: OverlayPreset = 'none';
  private mode: PersonaModeIpc = 'character';
  private valence: number;
  private map: LivelinessMap;
  private lastLlmMotionAt = -Infinity;
  private returnGeneration = 0;
  private blinkState: BlinkState = 'follow';
  private blinkDoubletArmed = false;
  private blinkDraws = 0;
  /** True while a grant is replacing a lease on the same lane: the outgoing lease's terminal
   *  callback must not release the gaze / clear the overlay that the incoming one is about to set. */
  private granting = 0;
  /** Behaviour ends that arrived mid-grant, waiting for the lane to settle (see `notifyBehaviourEnd`). */
  private readonly pendingBehaviourEnds: { id: string; result: LaneResult }[] = [];
  private flushingBehaviourEnds = false;
  private readonly behaviourListeners: ((id: string, result: LaneResult) => void)[] = [];

  constructor(private readonly ports: ArbiterPorts, opts: { valence?: number; liveliness?: number } = {}) {
    this.valence = opts.valence ?? 0;
    this.map = livelinessMap(opts.liveliness ?? 0.30);
  }

  // ---- inputs --------------------------------------------------------------------------------
  setMode(mode: PersonaModeIpc): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode !== 'plain') return;
    const now = this.ports.now();
    for (const holder of [this.body, this.expression, this.gaze] as const) {
      if (holder.current?.source === 'llm') holder.end('cancelled', now);
    }
    if (this.covered) { const c = this.covered; this.covered = null; c.onResult('cancelled'); }
    // The group cooldown belongs to the cancelled turn: the first ACT after the switch back is new.
    this.lastLlmMotionAt = -Infinity;
    this.applyExpression(now);
  }
  setValence(v: number): void { this.valence = v; }
  setLiveliness(L: number): void { this.map = livelinessMap(L); }
  liveliness(): LivelinessMap { return this.map; }
  setBlinkState(s: BlinkState): void {
    const wasSleepy = this.blinkState === 'sleepy';
    this.blinkState = s;
    if ((s === 'sleepy') !== wasSleepy) this.ports.blink.setSleepy(s === 'sleepy');
  }
  onBehaviourResult(cb: (id: string, result: LaneResult) => void): void { this.behaviourListeners.push(cb); }
  forceBlink(): void { this.ports.blink.force(); }

  lanes(): { lane: Lane; source: LaneSource | null; generation: number }[] {
    return [
      { lane: 'body', source: this.body.current?.source ?? null, generation: this.body.generation },
      { lane: 'expression', source: this.expression.current?.source ?? null, generation: this.expression.generation },
      { lane: 'gaze', source: this.gaze.current?.source ?? null, generation: this.gaze.generation },
    ];
  }

  // ---- per-frame ---------------------------------------------------------------------------
  update(now: number): void {
    this.body.tick(now);
    // R3-4: the covered LLM lease keeps running on its own clock — it can end UNDER the cover, in
    // which case it is reported `expired` and never restored.
    if (this.covered) {
      const c = this.covered;
      if (now >= c.deadline || now >= this.curveEndsAt(c)) {
        this.covered = null;
        c.onResult('expired');
      }
    }
    const expr = this.expression.current;
    if (expr && expr.source === 'touch' && now >= expr.deadline) {
      // The cover is not "expired": it is lifted, and whatever it covered comes back (§5.4, B-05).
      this.expression.end('preempted', now);
      if (this.covered) {
        const c = this.covered;
        this.covered = null;
        const restored = this.expression.restore(c, now);
        // FIX ROUND 1 (finding 7, same pairing rule): a restored lease keeps the terminal callback
        // its FIRST grant installed, so it will report the generation it was born with — the record
        // here must say the same thing, or `restore` leaves a grant that no result ever closes. A
        // hand-built covered lease (llm() under a touch) was never stamped by the holder and reports
        // `null`.
        if (restored) this.traceGrant(restored, this.idOf(restored.payload), c.generation > 0 ? c.generation : null);
      }
    } else {
      this.expression.tick(now);
    }
    this.gaze.tick(now);
    if (this.pendingTouchBody && now >= this.pendingTouchBody.swapAt) {
      const { payload } = this.pendingTouchBody;
      this.grant(this.body, 'touch', TOUCH_EXPR_MS, payload, now);
      this.pendingTouchBody = null;
    }
    this.applyExpression(now);
  }

  // ---- commands ----------------------------------------------------------------------------
  /** §5.3: three leases with source 'behaviour' and ttl = durationMs. False = refused (runner holds). */
  behaviour(cmd: BehaviourCommand, now: number): boolean {
    // FIX ROUND 1 (finding 5): §5.1's "refused ⇒ `preempted` reported for the INCOMING command" holds
    // for `behaviour` exactly as it does for `llm` and `sim`; a refusal used to return silently, so
    // the D16 trace recorded refusals for two of the three sources only. The id is the behaviour id
    // (what `behaviourStart`/`behaviourEnd` carry), so a reader can pair the refusal with the draw.
    const noBody = !this.mayTake(this.body, 'behaviour') || this.pendingTouchBody !== null;
    const noExpression = !this.mayTake(this.expression, 'behaviour');
    const noGaze = !this.mayTake(this.gaze, 'behaviour');
    if (noBody || noExpression || noGaze) {
      if (noBody) this.refuse('body', 'behaviour', cmd.id);
      if (noExpression) this.refuse('expression', 'behaviour', cmd.id);
      if (noGaze) this.refuse('gaze', 'behaviour', cmd.id);
      return false;
    }
    const motionId = cmd.motion ? `${cmd.motion[0]}_${cmd.motion[1]}` : cmd.id;
    this.grant(this.body, 'behaviour', cmd.durationMs, { id: motionId, motion: cmd.motion, overlay: cmd.overlay, behaviourId: cmd.id }, now);
    this.grant(this.expression, 'behaviour', cmd.durationMs, { id: cmd.expression ?? '', name: cmd.expression, weight: cmd.expressionWeight, utteranceEndAt: null }, now);
    this.applyExpression(now);
    this.grant(this.gaze, 'behaviour', cmd.durationMs, { id: cmd.gaze, target: { kind: 'pattern', pattern: cmd.gaze } }, now);
    return true;
  }

  /** §5.11: the touch acknowledgement (zero-fade same frame for expression/gaze; body per §5.1). */
  touch(r: TouchReaction, now: number): void {
    const id = `${r.motion[0]}_${r.motion[1]}`;
    // Gaze: the touch target wins outright.
    this.grant(this.gaze, 'touch', TOUCH_EXPR_MS, { id: r.gaze, target: { kind: 'pattern', pattern: r.gaze } }, now);
    this.applyOverlay(r.overlay);
    // Expression: an LLM lease already in its post-utterance hold/decay is COVERED and restored when
    // the touch ends (R3-4, B-05); one still mid-utterance is simply pre-empted — by the time the
    // cover lifts, that utterance's expression is stale.
    const cur = this.expression.current;
    if (cur?.source === 'llm' && cur.payload.utteranceEndAt !== null && !this.covered) {
      this.covered = this.expression.detach();
    }
    this.grant(this.expression, 'touch', TOUCH_EXPR_MS, { id: r.expression.name, name: r.expression.name, weight: r.expression.weight, utteranceEndAt: null }, now);
    this.applyExpression(now);
    // Body: drag is untouchable; llm swaps at the boundary; behaviour/idle/sim/touch swap now.
    const body = this.body.current;
    const payload: BodyPayload = { id, motion: r.motion, overlay: r.overlay, behaviourId: null };
    if (body?.source === 'drag') return;
    if (body?.source === 'llm') {
      const boundary = Math.max(now, body.issuedAt + MOTION_MIN_PLAY_MS);
      this.pendingTouchBody = { payload, swapAt: Math.min(boundary, now + TOUCH_PREEMPT_MAX_MS) };
      return;
    }
    this.grant(this.body, 'touch', TOUCH_EXPR_MS, payload, now);
  }

  /** §2.6 consumer: one ACT. Plain mode refuses (R3-12). */
  llm(cmd: LlmCommand, now: number): void {
    const motionId = cmd.motion ? `${cmd.motion[0]}_${cmd.motion[1]}` : '';
    if (this.mode === 'plain') {
      this.refuse('body', 'llm', motionId);
      this.refuse('expression', 'llm', cmd.expression ?? '');
      this.refuse('gaze', 'llm', cmd.look ? (cmd.look.kind === 'anchor' ? cmd.look.anchor : 'point') : '');
      return;
    }
    const weight = clampExpressionWeight(cmd.emotion, 1.0);
    const exprPayload: ArbExpressionPayload = { id: cmd.expression ?? '', name: cmd.expression, weight, utteranceEndAt: null };
    // Expression: newer LLM wins; under a touch cover the new lease becomes the covered one.
    if (this.expression.current?.source === 'touch') {
      if (this.covered) { const c = this.covered; this.covered = null; c.onResult('preempted'); }
      // FIX ROUND 1 (finding 7): this lease is built by hand because it must NOT displace the live
      // touch cover, so no LaneHolder ever stamps it and it has no lane generation. It now announces
      // itself with a `laneGrant` carrying the same `generation: null` its `laneResult` already
      // carried, so §12.2's grant↔result pairing holds for it too instead of leaving Task 17's
      // assert-trace with a result that has no grant. DECISION (ruling requested): a null generation
      // on both records, rather than routing through `LaneHolder.request` + `detach()` — that would
      // buy a real generation for the covered lease only by re-issuing the LIVE touch lease under a
      // fresh one via `restore()`, whose result still reports the ORIGINAL generation, i.e. trading
      // this asymmetry for a worse one.
      const covered: LaneLease<ArbExpressionPayload> = {
        lane: 'expression', source: 'llm', generation: 0, ttlMs: EXPR_TOTAL_CEILING_MS, payload: exprPayload,
        issuedAt: now, deadline: now + EXPR_TOTAL_CEILING_MS,
        onResult: once((r) => this.ports.trace(this.rec('laneResult', { lane: 'expression', source: 'llm', generation: null, id: this.idOf(exprPayload), result: r }))),
      };
      this.ports.trace(this.rec('laneGrant', {
        lane: 'expression', source: 'llm', generation: null, id: this.idOf(exprPayload), ttlMs: Math.round(covered.ttlMs),
      }));
      this.covered = covered;
    } else {
      this.grant(this.expression, 'llm', EXPR_TOTAL_CEILING_MS, exprPayload, now);
    }
    this.applyExpression(now);
    // Gaze: an LLM look lease pre-empts everything but touch.
    if (cmd.look) {
      const anchorId = cmd.look.kind === 'anchor' ? cmd.look.anchor : 'point';
      if (this.gaze.current?.source === 'touch') this.refuse('gaze', 'llm', anchorId);
      else this.grant(this.gaze, 'llm', LOOK_LEASE_TTL_MS, { id: anchorId, target: cmd.look }, now);
    }
    // Body (§5.1 + §5.5): refused under touch/drag; second ACT inside the cooldown updates expression only.
    if (!cmd.motion) return;
    const body = this.body.current;
    if (body?.source === 'touch' || body?.source === 'drag' || this.pendingTouchBody) { this.refuse('body', 'llm', motionId); return; }
    if (now - this.lastLlmMotionAt < MOTION_GROUP_COOLDOWN_MS) { this.refuse('body', 'llm', motionId); return; }
    this.lastLlmMotionAt = now;
    this.grant(this.body, 'llm', LLM_BODY_MS, { id: motionId, motion: cmd.motion, overlay: 'none', behaviourId: null }, now);
  }

  /** The utterance ended: starts R3-4's hold clock on the live (or covered) LLM lease. */
  utteranceEnded(now: number): void {
    const cur = this.expression.current;
    if (cur?.source === 'llm' && cur.payload.utteranceEndAt === null) cur.payload.utteranceEndAt = now;
    if (this.covered && this.covered.payload.utteranceEndAt === null) this.covered.payload.utteranceEndAt = now;
  }

  dragStart(now: number): void {
    if (this.body.current?.source === 'drag') return;
    this.pendingTouchBody = null;
    this.grant(this.body, 'drag', LANE_TTL_MAX_MS, { id: 'drag', motion: null, overlay: 'none', behaviourId: null }, now);
  }
  dragEnd(now: number): void {
    if (this.body.current?.source === 'drag') this.body.end('completed', now);
  }

  /** §5.10 / §10.4 one-shot reactions. `annoyed` is played by touch.ts (§5.11) and ignored here.
   *  `cursorWiggle` has a real producer as of R3-36 / Amendment A3-2: Task 12's `ActivitySensor`
   *  (240 DIP radius, 10 Hz ring, >= 4 x-reversals of >= 6 DIP in 1.5 s, 20 s cooldown) fires it and
   *  `SimService` fans it out on `sim:event`. The kind string here IS the produced name. */
  simEvent(kind: SimEventKind, now: number): void {
    if (kind === 'returned') {
      const gen = ++this.returnGeneration;
      this.simGaze({ kind: 'pattern', pattern: 'cursorLock' }, RETURN_GAZE_MS, now, RETURN_GAZE_EASE_MS);
      this.ports.blink.force();
      this.ports.schedule(() => {
        if (gen !== this.returnGeneration) return;
        this.simExpression('F06', RETURN_EXPR_WEIGHT, RETURN_EXPR_MS, this.ports.now());
      }, RETURN_EXPR_AT_MS);
      this.ports.schedule(() => {
        if (gen !== this.returnGeneration) return;
        this.simBody(['TapBody', 0], RETURN_BODY_MS, this.ports.now());
      }, RETURN_BODY_AT_MS);
      // §5.10's last step: "release at t+1500" — the sequence lets go of whatever it still holds.
      this.ports.schedule(() => {
        if (gen !== this.returnGeneration) return;
        this.releaseSim(this.ports.now());
      }, RETURN_BODY_MS);
      return;
    }
    if (kind === 'typingGlance') { this.simGaze({ kind: 'anchor', anchor: 'screen' }, GLANCE_MS, now); return; }
    if (kind === 'cursorWiggle') {
      this.simGaze({ kind: 'pattern', pattern: 'cursorLock' }, WIGGLE_MS, now);
      this.simExpression('F06', RETURN_EXPR_WEIGHT, WIGGLE_MS, now);
      this.applyExpression(now);
    }
  }

  /** Wraps the seeded rng handed to Live2DStage: CubismEyeBlink is its only remaining consumer once
   *  autoIdle is false, so every call is one next-blink draw (§5.7). The FIRST draw happens before
   *  any blink has been shown (CubismEyeBlink's `First` state), so it neither traces nor rolls for a
   *  doublet; every later draw traces the blink that just finished and `flag` says whether the
   *  interval it is about to return is the doublet's short one. */
  blinkRng(base: () => number): () => number {
    return () => {
      const draw = this.blinkDraws++;
      if (draw > 0) this.ports.trace(this.rec('blink', { flag: this.blinkDoubletArmed }));
      if (this.blinkState === 'sleep') return 0.999;
      let ms: number;
      if (this.blinkDoubletArmed) {
        this.blinkDoubletArmed = false;
        ms = BLINK_DOUBLET_MIN_MS + base() * (BLINK_DOUBLET_MAX_MS - BLINK_DOUBLET_MIN_MS);
      } else {
        if (draw > 0) this.blinkDoubletArmed = base() < BLINK_DOUBLET_P;
        const rest = this.blinkState !== 'follow';
        ms = Math.max(BLINK_MIN_INTERVAL_MS, lognormalMs(
          rest ? BLINK_MEAN_REST_MS : BLINK_MEAN_FOLLOW_MS, rest ? BLINK_SIGMA_REST_MS : BLINK_SIGMA_FOLLOW_MS, base(), base()));
      }
      return Math.min(0.999, ms / BLINK_SPAN_MS);
    };
  }

  // ---- internals ---------------------------------------------------------------------------
  /** §5.1: a source may take a lane that is free, or held by a strictly lower rank — equal rank means
   *  the newer command wins (the same rule Task 8's `expressionPolicy` / `gazePolicy` use). */
  private mayTake(holder: LaneHolder<unknown>, source: LaneSource): boolean {
    const cur = holder.current;
    return !cur || SOURCE_RANK[source] >= SOURCE_RANK[cur.source];
  }

  private simGaze(target: GazeTarget, ttl: number, now: number, easeMs?: number): void {
    const id = target.kind === 'pattern' ? target.pattern : target.kind === 'anchor' ? target.anchor : 'point';
    if (!this.mayTake(this.gaze, 'sim')) { this.refuse('gaze', 'sim', id); return; }
    this.grant(this.gaze, 'sim', ttl, { id, target, easeMs }, now);
  }
  private simExpression(name: string, weight: number, ttl: number, now: number): void {
    if (!this.mayTake(this.expression, 'sim')) { this.refuse('expression', 'sim', name); return; }
    this.grant(this.expression, 'sim', ttl, { id: name, name, weight, utteranceEndAt: null }, now);
    this.applyExpression(now);
  }
  private simBody(motion: MotionRef, ttl: number, now: number): void {
    const id = `${motion[0]}_${motion[1]}`;
    if (!this.mayTake(this.body, 'sim') || this.pendingTouchBody) { this.refuse('body', 'sim', id); return; }
    this.grant(this.body, 'sim', ttl, { id, motion, overlay: 'none', behaviourId: null }, now);
  }
  /** §5.10's "release at t+1500": every lane the return sequence still owns lets go. */
  private releaseSim(now: number): void {
    for (const holder of [this.body, this.expression, this.gaze] as const) {
      if (holder.current?.source === 'sim') holder.end('completed', now);
    }
  }

  private grant<P>(holder: LaneHolder<P>, source: LaneSource, ttlMs: number, payload: P, now: number): void {
    this.granting += 1;
    let ref: LaneLease<P> | null = null;
    const lease = holder.request({
      lane: holder.lane, source, generation: 0, ttlMs, payload,
      onResult: (r) => { if (ref) this.onLaneResult(holder, ref, r); },
    }, now);
    this.granting -= 1;
    if (!lease) throw new Error(`lane ${holder.lane} refused ${source} on a lane the arbiter had already won`);
    ref = lease;
    this.traceGrant(lease, this.idOf(payload));
    if (holder === (this.body as unknown as LaneHolder<P>)) {
      const p = payload as unknown as BodyPayload;
      this.applyOverlay(p.overlay);
      if (p.motion) {
        const gen = lease.generation;
        this.ports.motion.startMotionForced(p.motion[0], p.motion[1], fadeFor(source), () => {
          // R3-3: a stale completion can never clear a newer command.
          this.body.endIf(gen, 'completed', this.ports.now());
        });
      }
    } else if (holder === (this.gaze as unknown as LaneHolder<P>)) {
      const p = payload as unknown as ArbGazePayload;
      this.ports.gaze.apply(p.target, p.easeMs, lease.ttlMs);
    }
    // A behaviour end reported while this grant was in flight (finding 1) runs now, with the new
    // lease fully installed — so the runner's re-entrant `behaviour()` sees the truth and holds.
    this.flushBehaviourEnds();
  }

  /** Every terminal result: one trace record plus the lane's own after-effect. */
  private onLaneResult<P>(holder: LaneHolder<P>, lease: LaneLease<P>, result: LaneResult): void {
    this.ports.trace(this.rec('laneResult', {
      lane: lease.lane, source: lease.source, generation: lease.generation, id: this.idOf(lease.payload), result,
    }));
    // FIX ROUND 1 (finding 1): the runner MUST hear about its behaviour whatever ended it. This used
    // to sit below the `granting` guard, so a behaviour pre-empted by a new grant (drag/touch/llm/sim
    // — main calls `dragStart()` on every `arb:grab`, i.e. on every tap) was never reported: the
    // runner kept `currentId`, emitted no `behaviourEnd` and refused to select again until
    // `nextDecisionAt`. Only the gaze release and the overlay clear belong under the guard.
    if (holder === (this.body as unknown as LaneHolder<P>)) {
      const id = (lease.payload as unknown as BodyPayload).behaviourId;
      if (id) this.notifyBehaviourEnd(id, result);
    }
    if (this.granting > 0) return;   // an incoming lease on the same lane is about to set its own state
    if (holder === (this.gaze as unknown as LaneHolder<P>)) {
      if (!this.gaze.current) this.ports.gaze.release();
      return;
    }
    if (holder === (this.body as unknown as LaneHolder<P>)) {
      if (!this.body.current && !this.pendingTouchBody) this.applyOverlay('none');
    }
  }

  /** Behaviour-end delivery, deferred out of the middle of a grant. A listener is the BehaviourRunner,
   *  whose `onEnd` calls `decide()` → `behaviour()` synchronously; running that while `LaneHolder.request`
   *  is between "finished the old lease" and "installed the new one" would let the runner win a lane the
   *  incoming command is about to overwrite silently. Queued during a grant, flushed the moment it ends. */
  private notifyBehaviourEnd(id: string, result: LaneResult): void {
    this.pendingBehaviourEnds.push({ id, result });
    this.flushBehaviourEnds();
  }

  private flushBehaviourEnds(): void {
    if (this.granting > 0 || this.flushingBehaviourEnds) return;
    this.flushingBehaviourEnds = true;
    try {
      for (let next = this.pendingBehaviourEnds.shift(); next; next = this.pendingBehaviourEnds.shift()) {
        for (const cb of this.behaviourListeners) cb(next.id, next.result);
      }
    } finally {
      this.flushingBehaviourEnds = false;
    }
  }

  private refuse(lane: Lane, source: LaneSource, id: string): void {
    this.ports.trace(this.rec('laneResult', { lane, source, generation: null, id, result: 'preempted' }));
  }

  /** R3-4's curve is over at hold + decay: BEFORE that the lease is live however small its weight,
   *  AFTER it the lease is done — `completed` when it is the live one, `expired` when it is covered. */
  private curveEndsAt(lease: LaneLease<ArbExpressionPayload>): number {
    const holdUntil = Math.min(
      (lease.payload.utteranceEndAt ?? lease.issuedAt) + EXPR_HOLD_AFTER_UTTERANCE_MS,
      lease.issuedAt + EXPR_HOLD_CEILING_MS,
    );
    return holdUntil + EXPR_DECAY_MS;
  }

  private weightOf(lease: LaneLease<ArbExpressionPayload>, now: number): number {
    return expressionWeightAt({ issuedAt: lease.issuedAt, utteranceEndAt: lease.payload.utteranceEndAt, weight: lease.payload.weight }, now);
  }

  private applyOverlay(preset: OverlayPreset): void {
    if (preset === this.appliedOverlay) return;
    this.appliedOverlay = preset;
    this.ports.overlay.set(preset);
  }

  private applyExpression(now: number): void {
    const cur = this.expression.current;
    let name: string | null; let weight: number;
    if (cur && cur.source === 'llm') {
      name = cur.payload.name;
      if (now >= this.curveEndsAt(cur)) { this.expression.end('completed', now); return; }
      weight = this.weightOf(cur, now);
    } else if (cur) { name = cur.payload.name; weight = cur.payload.weight; }
    else { const b = baselineExpression(this.valence); name = b.name; weight = b.weight; }
    if (name === this.appliedExpression && Math.abs(weight - this.appliedWeight) < 0.005) return;
    if (this.appliedExpression && this.appliedExpression !== name) this.ports.expression.setExpressionWeight(this.appliedExpression, 1.0);
    if (name !== this.appliedExpression) this.ports.expression.setExpression(name);
    if (name) this.ports.expression.setExpressionWeight(name, weight);
    this.appliedExpression = name; this.appliedWeight = weight;
  }

  private traceGrant(lease: LaneLease<unknown>, id: string, generation: number | null = lease.generation): void {
    this.ports.trace(this.rec('laneGrant', {
      lane: lease.lane, source: lease.source, generation, id, ttlMs: Math.round(lease.ttlMs),
    }));
  }

  private idOf(payload: unknown): string {
    const p = payload as { id?: unknown };
    return typeof p?.id === 'string' ? p.id.slice(0, 64) : '';
  }

  /** §2.4's per-kind shape: fields without meaning are omitted, never null-filled. */
  private rec(kind: ArbTraceRecord['kind'], f: Partial<ArbTraceRecord>): ArbTraceRecord {
    return { tsRenderer: this.ports.now(), kind, lane: null, source: null, generation: null, id: '', result: null, value: null, ...f };
  }
}
