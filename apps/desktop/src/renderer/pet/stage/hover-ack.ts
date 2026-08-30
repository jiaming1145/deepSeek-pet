export type HoverState = 'out' | 'acknowledging' | 'held' | 'faded';
export const HOVER_ACK_MAX_MS = 250;      // the glance must START within 250 ms of entering
export const HOVER_ACK_GLANCE_MS = 400;   // how long the glance itself takes
export const WORK_MODE_FADE_AFTER_MS = 3_000;
export const WORK_MODE_FADE_OPACITY = 0.35;
export const WORK_MODE_FADE_MS = 250;     // --dur-overlay
export const WORK_MODE_DEFAULT = false;   // "opt-in, default off"

/** Every side effect of the §5.9 table, injected. Task 13 binds them. */
export interface HoverAckDeps {
  /** Gaze lane `source:'touch'` lease to the cursor for `ttlMs` (GazeLane.touchTarget, followCursor:true). */
  glance(ttlMs: number): void;
  /** BehaviourRunner.setFrozen (D7 "wandering freezes"). */
  setFrozen(frozen: boolean): void;
  /** Model opacity tween; the name keeps the Framework's typo (§0.2 `setModelOapcity`). */
  setModelOapcity(opacity: number, fadeMs: number): void;
  /** `arb:passthrough {faded}` to main. */
  sendPassthrough(faded: boolean): void;
  /** `chat:open {source:'pet', focusComposer:true}` (FW-4: main answers requestChat('pet', true)). */
  openChat(): void;
  /**
   * `SimSnapshot.uiWorkMode` as of the last `sim:state` (R3-35 / contract Amendment A3-1): the tray's
   * 工作模式 checkbox writes the `ui_work_mode` kv key (Task 6 → Task 15), `SimService` puts it on
   * every snapshot, and Task 13's `pet/main.ts` assigns it into the box this getter reads. It is
   * READ AT TICK TIME, never latched at `enter()`, so a toggle arriving mid-hover takes effect on
   * the next tick in both directions (pinned by `hover-ack.test.ts`).
   */
  workMode(): boolean;
  /** `arb:trace {kind:'hoverAck', label: state}`. */
  trace(rec: { kind: 'hoverAck'; label: HoverState }): void;
}

export class HoverAckMachine {
  private st: HoverState = 'out';
  private glanceEndsAt = 0;
  private stillSince = 0;
  private latency = 0;

  constructor(private readonly deps: HoverAckDeps) {}

  get state(): HoverState { return this.st; }
  /**
   * ms from the picker's opaque report to the glance request, i.e. `nowMs - opaqueAt` at `enter`.
   * FIX ROUND 1 (finding 3): this was a hardcoded 0, which made
   * `expect(m.ackLatencyMs).toBeLessThanOrEqual(HOVER_ACK_MAX_MS)` a test that could not fail and
   * left bar §0's "hover < 250 ms -> acknowledge" unmeasured by anything. The caller (Task 13's
   * picker path) passes the timestamp the pixel was reported opaque; the whole picker->enter path
   * is still Task 13/17's to prove end to end, but the bound is now a real measurement here.
   */
  get ackLatencyMs(): number { return this.latency; }

  /** Row 1: picker reports opaque. `opaqueAt` defaults to `nowMs` (the picker reported this frame). */
  enter(nowMs: number, opaqueAt: number = nowMs): void {
    if (this.st !== 'out') return;
    this.st = 'acknowledging';
    this.stillSince = nowMs;
    this.glanceEndsAt = nowMs + HOVER_ACK_GLANCE_MS;
    this.deps.glance(HOVER_ACK_GLANCE_MS);
    this.latency = Math.max(0, nowMs - opaqueAt);
    this.deps.setFrozen(true);
    this.deps.trace({ kind: 'hoverAck', label: 'acknowledging' });
  }

  /** Cursor moved while inside: restarts the work-mode rest timer. */
  move(nowMs: number): void {
    if (this.st === 'out') return;
    this.stillSince = nowMs;
  }

  /** Rows 4 and 5: cursor leaves. */
  leave(_nowMs: number): void {
    if (this.st === 'out') return;
    // FIX ROUND 1 (finding 7): §12's trace table is one record per state change, so `held` and `out`
    // are traced too. The `out` record is emitted BEFORE the effects (unlike `acknowledging` and
    // `faded`, which follow theirs) so that the ordering assertions in `hover-ack.test.ts` keep
    // reading the effect sequence; the two are one synchronous transition either way.
    this.deps.trace({ kind: 'hoverAck', label: 'out' });
    if (this.st === 'faded') {
      this.deps.setModelOapcity(1, WORK_MODE_FADE_MS);
      this.deps.sendPassthrough(false);
    }
    this.st = 'out';
    this.deps.setFrozen(false);
  }

  /** Row 6: a click whose press landed while hoverAck had already fired. Row 7 (faded) is
   *  impossible by construction — the window is pass-through — and is ignored here. */
  click(_nowMs: number): void {
    if (this.st === 'acknowledging' || this.st === 'held') this.deps.openChat();
  }

  /** Rows 2 and 3, driven per frame. */
  tick(nowMs: number): void {
    if (this.st === 'acknowledging' && nowMs >= this.glanceEndsAt) {
      this.st = 'held';
      this.deps.trace({ kind: 'hoverAck', label: 'held' });
    }
    if (this.st === 'held' && this.deps.workMode() && nowMs - this.stillSince > WORK_MODE_FADE_AFTER_MS) {
      this.st = 'faded';
      this.deps.setModelOapcity(WORK_MODE_FADE_OPACITY, WORK_MODE_FADE_MS);
      this.deps.sendPassthrough(true);
      this.deps.trace({ kind: 'hoverAck', label: 'faded' });
    }
  }
}
