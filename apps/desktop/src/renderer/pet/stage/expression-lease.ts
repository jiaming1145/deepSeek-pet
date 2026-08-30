import type { LaneResult, LaneSource } from '@ds/protocol';
import { LaneHolder, type LaneLease, type LanePolicy, type LaneRequest } from './lanes';

export const EXPR_INTENSITY_CLAMP = 0.65;      // R3-4: min(w, 0.65)
export const EXPR_SURPRISED_MAX = 1.0;         // R3-4: `surprised` may reach 1.0
export const EXPR_HOLD_AFTER_UTTERANCE_MS = 3_000;
export const EXPR_HOLD_CEILING_MS = 82_000;    // R3-4: min(utteranceEnd + 3 s, issuedAt + 82 s)
export const EXPR_DECAY_MS = 8_000;            // easeOutCubic to baseline
export const EXPR_TOTAL_CEILING_MS = 90_000;   // D14's never-exceed bound: 82_000 + 8_000
export const EXPR_FADE_MS = 300;               // bar §0: "expressions <= 300 ms"

/** easeOutCubic, the R3-4 curve. t in [0,1]. */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/** The applied weight at `nowMs`, given the lease. Exported so it is unit-testable alone. */
export function expressionWeightAt(lease: {
  issuedAt: number; utteranceEndAt: number | null; weight: number;
}, nowMs: number): number {
  const holdUntil = Math.min(
    (lease.utteranceEndAt ?? lease.issuedAt) + EXPR_HOLD_AFTER_UTTERANCE_MS,
    lease.issuedAt + EXPR_HOLD_CEILING_MS,
  );
  if (nowMs <= holdUntil) return lease.weight;
  const t = Math.min(1, (nowMs - holdUntil) / EXPR_DECAY_MS);
  return lease.weight * (1 - easeOutCubic(t));
}

export function baselineExpression(valence: number): { name: string | null; weight: number } {
  if (valence >= 0.35) return { name: 'F01', weight: 0.25 };   // faint smile
  if (valence <= -0.20) return { name: 'F04', weight: 0.15 };  // faintly downcast
  return { name: null, weight: 0 };                             // rest face
}

/** §5.4 incoming clamp: `surprised` ≤ 1.0, everything else ≤ 0.65. Non-finite → 0. */
export function clampExpressionWeight(emotion: string, w: number): number {
  const cap = emotion === 'surprised' ? EXPR_SURPRISED_MAX : EXPR_INTENSITY_CLAMP;
  if (!Number.isFinite(w) || w < 0) return 0;
  return Math.min(w, cap);
}

export interface ExpressionPayload {
  /** Expression name in the bound pack (e.g. 'F02'). */
  name: string;
  /** Already clamped by `clampExpressionWeight` (the lane does not clamp again). */
  weight: number;
  /** Set by `setUtteranceEnd` when the LLM turn's speech finishes; null while speaking. */
  utteranceEndAt: number | null;
}

/** The model hooks the lane drives: Phase 1 `CompanionModel.setExpression` and Task 5's `setExpressionWeight`. */
export interface ExpressionSink {
  setExpression(name: string | null): void;
  setExpressionWeight(name: string, weight: number): void;
}

const RANK: Record<LaneSource, number> = { touch: 3, llm: 2, behaviour: 1, sim: 0, idle: 0, drag: 0 };

/** §5.1 expression row: touch > llm > behaviour > sim; equal rank ⇒ the newer wins (llm over llm). */
export const expressionPolicy: LanePolicy<ExpressionPayload> = (incoming, current) =>
  RANK[incoming.source] >= RANK[current.source];

export class ExpressionLane {
  readonly holder = new LaneHolder<ExpressionPayload>('expression', expressionPolicy);
  private covered: LaneLease<ExpressionPayload> | null = null;
  private shown: string | null = null;
  private baseline = baselineExpression(0);

  constructor(private readonly sink: ExpressionSink) {}

  /** The LLM lease currently covered by a touch overlay (R3-4), if any. */
  get coveredLease(): LaneLease<ExpressionPayload> | null { return this.covered; }

  /** "Neutral" is the mood baseline (R3-4): a pure function of the sim's valence. */
  setBaseline(valence: number, nowMs: number): void {
    this.baseline = baselineExpression(valence);
    this.apply(nowMs);
  }

  request(cmd: LaneRequest<ExpressionPayload>, nowMs: number): LaneLease<ExpressionPayload> | null {
    const cur = this.holder.current;
    if (cmd.source === 'touch' && cur?.source === 'llm') {
      // §5.1: "cover, do not cancel" — the LLM lease keeps expiring underneath.
      this.covered = this.holder.detach();
    }
    const lease = this.holder.request(cmd, nowMs);
    if (lease) this.apply(nowMs);
    return lease;
  }

  /** Marks the end of the utterance on the live (or covered) LLM lease: the hold runs 3 s from here. */
  setUtteranceEnd(nowMs: number): void {
    const cur = this.holder.current;
    const target = cur?.source === 'llm' ? cur : this.covered?.source === 'llm' ? this.covered : null;
    if (target) target.payload.utteranceEndAt = nowMs;
  }

  end(result: LaneResult, nowMs: number): void {
    this.holder.end(result, nowMs);
    this.afterEnd(nowMs);
  }

  endIf(generation: number, result: LaneResult, nowMs: number): boolean {
    const ended = this.holder.endIf(generation, result, nowMs);
    if (ended) this.afterEnd(nowMs);
    return ended;
  }

  /** Per frame. Returns the lease that ended this tick, if any. */
  tick(nowMs: number): LaneLease<ExpressionPayload> | null {
    if (this.covered && nowMs >= this.covered.deadline) {
      // §5.2: "If it expires while covered, it reports `expired` and is not restored."
      this.covered.onResult('expired');
      this.covered = null;
    }
    const cur = this.holder.current;
    let ended: LaneLease<ExpressionPayload> | null = null;
    if (cur && nowMs >= cur.deadline) {
      // B-05: the restore displaces the overlay, so a cover over a live LLM lease ends `preempted`.
      this.holder.end(this.covered ? 'preempted' : 'expired', nowMs);
      ended = cur;
    } else if (cur && expressionWeightAt(this.curve(cur), nowMs) <= 0) {
      this.holder.end('completed', nowMs);
      ended = cur;
    }
    if (ended) this.afterEnd(nowMs); else this.apply(nowMs);
    return ended;
  }

  private afterEnd(nowMs: number): void {
    if (this.covered && !this.holder.current) {
      const c = this.covered;
      this.covered = null;
      this.holder.restore(c, nowMs);
    }
    this.apply(nowMs);
  }

  private curve(l: LaneLease<ExpressionPayload>) {
    return { issuedAt: l.issuedAt, utteranceEndAt: l.payload.utteranceEndAt, weight: l.payload.weight };
  }

  private apply(nowMs: number): void {
    const cur = this.holder.current;
    const name = cur ? cur.payload.name : this.baseline.name;
    const weight = cur ? expressionWeightAt(this.curve(cur), nowMs) : this.baseline.weight;
    if (name !== this.shown) {
      // §5.4: expression objects are shared — a released expression must go back to weight 1.0.
      if (this.shown !== null) this.sink.setExpressionWeight(this.shown, 1.0);
      this.shown = name;
      this.sink.setExpression(name);
    }
    if (name !== null) this.sink.setExpressionWeight(name, weight);
  }
}
