import { LANE_TTL_MAX_MS, type Lane, type LaneResult, type LaneSource } from '@ds/protocol';

/** R3-3: `{lane, source, generation, ttlMs, payload}`. The OWNER stamps the deadline. */
export interface LaneCommand<P> {
  lane: Lane;
  source: LaneSource;
  /** Assigned by the OWNING lane, monotonically increasing. Never crosses a process boundary. */
  generation: number;
  /** Requested lifetime. Clamped into [0, LANE_TTL_MAX_MS] by the owner. */
  ttlMs: number;
  payload: P;
}

/** A granted lease. `deadline` is in the OWNER's clock (performance.now() here) — R3-3 forbids
 *  comparing a deadline stamped in another process's clock. */
export interface LaneLease<P> extends LaneCommand<P> {
  issuedAt: number;
  deadline: number;
  onResult(result: LaneResult): void;
}

/** What a caller hands to `request`: the envelope plus its terminal callback. The caller's
 *  `generation` is ignored (the holder assigns it); pass 0 by convention. */
export interface LaneRequest<P> extends LaneCommand<P> {
  onResult?(result: LaneResult): void;
}

/** Arbitration: `true` grants `incoming` (current → `preempted`), `false` refuses it
 *  (incoming → `preempted`, per §5.1 "refused (`preempted` reported for the incoming command)"). */
export type LanePolicy<P> = (incoming: LaneCommand<P>, current: LaneLease<P>) => boolean;

/** §5.2: ttl clamped into [0, LANE_TTL_MAX_MS]; a non-finite ttl is 0 (expires on the next tick). */
export function clampTtl(ttlMs: number): number {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) return 0;
  return Math.min(ttlMs, LANE_TTL_MAX_MS);
}

export class LaneHolder<P> {
  private cur: LaneLease<P> | null = null;
  private gen = 0;

  constructor(readonly lane: Lane, private readonly policy: LanePolicy<P> = () => true) {}

  get current(): LaneLease<P> | null { return this.cur; }
  get generation(): number { return this.gen; }

  /** Returns the granted lease, or null when the incoming command loses arbitration. */
  request(cmd: LaneRequest<P>, nowMs: number): LaneLease<P> | null {
    if (this.cur && !this.policy(cmd, this.cur)) {
      cmd.onResult?.('preempted');
      return null;
    }
    if (this.cur) this.finish(this.cur, 'preempted');
    const ttlMs = clampTtl(cmd.ttlMs);
    return this.issue(cmd, ttlMs, nowMs, nowMs + ttlMs, once(cmd.onResult));
  }

  /** Expires the lease if past its deadline; returns the lease that ended, if any. */
  tick(nowMs: number): LaneLease<P> | null {
    const c = this.cur;
    if (!c || nowMs < c.deadline) return null;
    this.finish(c, 'expired');
    return c;
  }

  /** Ends the current lease with `result`, running its callback exactly once. */
  end(result: LaneResult, _nowMs: number): void {
    if (this.cur) this.finish(this.cur, result);
  }

  /** §5.2 stale-generation rule: ends only when `generation` is the live one. */
  endIf(generation: number, result: LaneResult, nowMs: number): boolean {
    if (!this.cur || this.cur.generation !== generation) return false;
    this.end(result, nowMs);
    return true;
  }

  /** Removes the current lease WITHOUT a result (R3-4 cover). The caller keeps it for `restore`. */
  detach(): LaneLease<P> | null {
    const c = this.cur;
    this.cur = null;
    return c;
  }

  /** Re-issues a detached lease with its ORIGINAL issuedAt/deadline (R3-4 "restored with its
   *  remaining time") under a fresh generation. Past its deadline ⇒ reports `expired`, grants nothing. */
  restore(lease: LaneLease<P>, nowMs: number): LaneLease<P> | null {
    if (nowMs >= lease.deadline) {
      lease.onResult('expired');
      return null;
    }
    if (this.cur) this.finish(this.cur, 'preempted');
    return this.issue(lease, lease.ttlMs, lease.issuedAt, lease.deadline, lease.onResult);
  }

  private issue(cmd: LaneCommand<P>, ttlMs: number, issuedAt: number, deadline: number, onResult: (r: LaneResult) => void): LaneLease<P> {
    this.gen += 1;
    const lease: LaneLease<P> = {
      lane: this.lane, source: cmd.source, generation: this.gen, ttlMs, payload: cmd.payload,
      issuedAt, deadline, onResult,
    };
    this.cur = lease;
    return lease;
  }

  private finish(lease: LaneLease<P>, result: LaneResult): void {
    if (this.cur === lease) this.cur = null;
    lease.onResult(result);
  }
}

/** One terminal result per lease, ever (§5.2). */
function once(fn: ((r: LaneResult) => void) | undefined): (r: LaneResult) => void {
  let fired = false;
  return (r) => {
    if (fired) return;
    fired = true;
    fn?.(r);
  };
}
