import type { LaneResult } from '@ds/protocol';
import type { BehaviorSelector, ConditionFacts } from '@ds/behaviors';
import type { ArbTraceRecord, BehaviourCommand } from './arbiter';

export const CONDITION_POLL_MS = 1_000;   // research §1: the selector is event-driven + a 1 Hz re-poll

/** The two arbiter members the runner uses; structural so the test injects a fake. */
export interface RunnerArbiter {
  behaviour(cmd: BehaviourCommand, now: number): boolean;
  onBehaviourResult(cb: (id: string, result: LaneResult) => void): void;
}
type RunnerSelector = Pick<BehaviorSelector, 'update' | 'select' | 'finish'>;

export class BehaviourRunner {
  private currentId: string | null = null;
  private nextDecisionAt = 0;
  private frozen = false;

  constructor(private readonly deps: {
    selector: RunnerSelector;
    arbiter: RunnerArbiter;
    facts(): ConditionFacts;          // built from the latest SimSnapshot
    now(): number;                    // performance.now()
    trace(rec: ArbTraceRecord): void;
  }) {
    deps.arbiter.onBehaviourResult((id, result) => this.onEnd(id, result));
  }

  /** The 1 Hz condition re-poll: refresh the selector's view of the world, then decide if it is time. */
  update(): void {
    this.deps.selector.update(this.deps.facts(), this.deps.now());
    this.decide();
  }

  /** Freezes selection without ending the current behaviour (D7: "wandering freezes"). */
  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
    if (!frozen) this.decide();
  }

  current(): string | null { return this.currentId; }

  /**
   * §5.3: a new behaviour is drawn only at a boundary — the body lease ended, or `nextDecisionAt`
   * passed. The re-poll above never re-selects mid-behaviour, which is what keeps D1 ("no behaviour
   * twice in a row") the selector's business alone.
   */
  private decide(): void {
    if (this.frozen) return;
    const now = this.deps.now();
    if (this.currentId !== null && now < this.nextDecisionAt) return;
    const sel = this.deps.selector.select(this.deps.facts(), now);
    if (!sel) return;                                                    // §4.4: hold, never invent
    const b = sel.behavior;
    const granted = this.deps.arbiter.behaviour({
      id: b.id, motion: b.motion, expression: b.expression, expressionWeight: b.expressionWeight,
      gaze: b.gaze, overlay: b.overlay, durationMs: sel.durationMs,
    }, now);
    if (!granted) return;                                                // §5.1: refused under llm/touch
    this.currentId = b.id;
    this.nextDecisionAt = sel.nextDecisionAt;
    this.deps.trace({
      tsRenderer: now, kind: 'behaviourStart', lane: null, source: null, generation: null, id: b.id, result: null, value: null,
      durationMs: Math.round(sel.durationMs), eligible: sel.trace.eligible, weights: sel.trace.weights, seed: sel.trace.seed,
      bagSize: sel.trace.eligible.length,
    });
  }

  private onEnd(id: string, result: LaneResult): void {
    const now = this.deps.now();
    this.deps.selector.finish(id, now, result);
    this.deps.trace({ tsRenderer: now, kind: 'behaviourEnd', lane: null, source: null, generation: null, id, result, value: null });
    if (this.currentId === id) this.currentId = null;
    // A boundary, not a re-poll: the conditions are whatever the last `update()` left.
    this.decide();
  }
}
