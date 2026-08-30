/**
 * §12.7 B-05 `arbiter/touch-preempt-restore.fixture.ts`.
 * Input: LLM expression lease at t=0 (ttl 90 s) → touch at t=2 s → touch overlay ends at t=3.4 s.
 * Expected: expression lane `llm` → `touch` (covered) → `llm` restored WITH its remaining time; the
 * weight follows §5.4's curve from the real elapsed time. Emitted: `laneResult preempted` for the
 * touch lease only; the LLM lease reports nothing until its own end. Persisted: nothing.
 */
export const TOUCH_PREEMPT_RESTORE = {
  llm: { at: 0, ttlMs: 90_000, name: 'F02', emotion: 'happy', requestedWeight: 0.9 },
  touch: { at: 2_000, name: 'F01', weight: 0.45 },   // ttl = TOUCH_EXPR_MS (lane-metrics, Task 5)
  overlayEndsAt: 3_400,
  expect: {
    llmWeightApplied: 0.65,                            // min(0.9, EXPR_INTENSITY_CLAMP)
    resultsByOverlayEnd: ['touch:preempted'] as const, // the LLM lease is silent here
    restoredDeadline: 90_000,                          // issuedAt + ttl, unchanged by the cover
    /** expressionWeightAt at 3 400 ms: holdUntil = 0 + 3 000 (utteranceEndAt null), t = 400/8 000. */
    weightAt3400: 0.65 * (1 - (1 - Math.pow(1 - 0.05, 3))),
    /**
     * FIX ROUND 1 (finding 2). These two were `90_000` / `'expired'`, an outcome the §5.4 curve
     * cannot produce for this input and which no test read. With `utteranceEndAt: null` the curve
     * reaches 0 at `issuedAt + EXPR_HOLD_AFTER_UTTERANCE_MS + EXPR_DECAY_MS = 0 + 3_000 + 8_000`,
     * and `ExpressionLane.tick` ends the lease `completed` there (D14: "persist until the next ACT
     * or 90 s, THEN decay" -- the 90 s ttl is a ceiling, not the expected outcome). Restated to the
     * reachable pair and now ASSERTED by `expression-lease.test.ts`, so it can no longer drift.
     * DECISION (fix round 1, no controller available): restated rather than deleted -- B-05 is the
     * §12.7 artefact of record and Task 13/17 need a true statement of when the LLM lease reports.
     */
    llmResultAt: 11_000,
    llmResult: 'completed' as const,
  },
} as const;
