import { describe, expect, it } from 'vitest';
import {
  AWAY_OFFSET_DEG, CURSOR_REST_EPS_DIP, CURSOR_REST_MS, EYES_ONLY_THRESHOLD_DEG, GAZE_BODY_DELAY_MS,
  GAZE_BODY_FRACTION, GAZE_HEAD_DELAY_MS, GAZE_HEAD_FRACTION, GazeLane, LOOK_LEASE_TTL_MS, SACCADE_MAX_MS,
  SACCADE_MIN_MS, SACCADE_SIGMA_MS, SACCADE_SUPPRESS_MS, SACCADE_TYPES, anchorTarget, drawSaccadeInterval,
  pickSaccadeType, type GazeLaneDeps,
} from './gaze-lane';

/** mulberry32 — the same generator Task 3's rng.ts seeds; local so this test has no @ds/sim import. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function harness(seed = 1) {
  const targets: [number, number][] = [];
  const traces: { kind: 'gazeBreak'; label: string; value: number }[] = [];
  const deps: GazeLaneDeps = {
    rng: mulberry32(seed),
    setTarget: (x, y) => targets.push([x, y]),
    trace: (rec) => traces.push(rec),
  };
  const lane = new GazeLane(deps, 0);
  return { lane, targets, traces, deps };
}

describe('constants (§5.6, D3)', () => {
  it('pins every number', () => {
    expect(CURSOR_REST_MS).toBe(5_000);
    expect(CURSOR_REST_EPS_DIP).toBe(2);
    expect(SACCADE_MIN_MS).toBe(8_000);
    expect(SACCADE_MAX_MS).toBe(20_000);
    expect(SACCADE_SIGMA_MS).toBe(4_000);
    expect(SACCADE_SUPPRESS_MS).toBe(4_000);
    expect(EYES_ONLY_THRESHOLD_DEG).toBe(12);
    expect(GAZE_HEAD_DELAY_MS).toBe(100);
    expect(GAZE_HEAD_FRACTION).toBe(0.65);
    expect(GAZE_BODY_DELAY_MS).toBe(480);
    expect(GAZE_BODY_FRACTION).toBe(0.20);
    expect(LOOK_LEASE_TTL_MS).toBe(6_000);
    expect(AWAY_OFFSET_DEG).toEqual([20, 30]);
    expect(SACCADE_TYPES.map((t) => [t.type, t.weight])).toEqual([['lookAwayBack', 0.6], ['microFidget', 0.25], ['doubleGlance', 0.15]]);
    expect(SACCADE_TYPES.reduce((s, t) => s + t.weight, 0)).toBeCloseTo(1, 10);
  });
});

describe('drawSaccadeInterval', () => {
  it('is clamped to [8000, 20000] with a mean near saccadeIntervalMs over 10 000 draws', () => {
    const rng = mulberry32(7);
    let sum = 0;
    for (let i = 0; i < 10_000; i++) {
      const v = drawSaccadeInterval(16_400, rng);
      expect(v).toBeGreaterThanOrEqual(SACCADE_MIN_MS);
      expect(v).toBeLessThanOrEqual(SACCADE_MAX_MS);
      sum += v;
    }
    expect(sum / 10_000).toBeGreaterThan(13_500);
    expect(sum / 10_000).toBeLessThan(17_000);
  });
  it('clamps an out-of-range mean at both ends', () => {
    // The brief's original form asserted `toBe(SACCADE_MIN_MS)` on EVERY low-mean draw. That is not
    // a property of §5.6's draw: at meanMs = 1 000 with SACCADE_SIGMA_MS = 4 000 the lognormal's
    // coefficient of variation is 4, so P(draw > 8 000) ~= 1.9 % and roughly 4 of 200 seeded draws
    // land above the floor (measured: 198/200 clamp, seed 3). The invariant the clamp actually
    // guarantees — and the one D3 needs — is that NO draw ever leaves [8 000, 20 000]; the "clamps
    // at both ends" intent is kept by pinning MAX on every high-mean draw and MIN on the non-tail
    // low-mean draws. See Deviations in the task report.
    const lo = mulberry32(3); const hi = mulberry32(3);
    let clampedAtMin = 0;
    for (let i = 0; i < 200; i++) {
      const low = drawSaccadeInterval(1_000, lo);
      expect(low).toBeGreaterThanOrEqual(SACCADE_MIN_MS);
      expect(low).toBeLessThanOrEqual(SACCADE_MAX_MS);
      if (low === SACCADE_MIN_MS) clampedAtMin += 1;
      expect(drawSaccadeInterval(200_000, hi)).toBe(SACCADE_MAX_MS);
    }
    expect(clampedAtMin).toBeGreaterThanOrEqual(195);
  });
});

describe('pickSaccadeType / anchorTarget', () => {
  it('splits the unit interval by weight', () => {
    expect(pickSaccadeType(0)).toBe('lookAwayBack');
    expect(pickSaccadeType(0.59)).toBe('lookAwayBack');
    expect(pickSaccadeType(0.6)).toBe('microFidget');
    expect(pickSaccadeType(0.85)).toBe('doubleGlance');
    expect(pickSaccadeType(0.999)).toBe('doubleGlance');
  });
  it('maps every anchor per §5.6', () => {
    const cursor = { x: 0.3, y: -0.2 };
    const rng = () => 0.5;
    expect(anchorTarget('cursor', cursor, rng)).toEqual(cursor);
    expect(anchorTarget('user', cursor, rng)).toEqual({ x: 0, y: 0.15 });
    expect(anchorTarget('screen', cursor, rng)).toEqual({ x: 0, y: 0.35 });
    expect(anchorTarget('up', cursor, rng)).toEqual({ x: 0, y: 0.7 });
    expect(anchorTarget('down', cursor, rng)).toEqual({ x: 0, y: -0.7 });
    expect(anchorTarget('left', cursor, rng)).toEqual({ x: -0.7, y: 0 });
    expect(anchorTarget('right', cursor, rng)).toEqual({ x: 0.7, y: 0 });
    const away = anchorTarget('away', cursor, rng);
    expect(Math.abs(away.x) * 30).toBeGreaterThanOrEqual(20);
    expect(Math.abs(away.x) * 30).toBeLessThanOrEqual(30);
    expect(away.y).toBe(0);
  });
});

describe('GazeLane', () => {
  it('follows the cursor, then enters restDrift after 5 s of rest and leaves on a real move', () => {
    const { lane } = harness();
    lane.setCursor({ x: 0.4, y: 0.1, dipX: 100, dipY: 100 }, 0);
    expect(lane.tick(0).eyes).toEqual({ x: 0.4, y: 0.1 });
    lane.setCursor({ x: 0.41, y: 0.1, dipX: 101, dipY: 100 }, 2_000);   // < CURSOR_REST_EPS_DIP: still resting
    lane.tick(4_999);
    expect(lane.state).toBe('follow');
    lane.tick(5_000);
    expect(lane.state).toBe('restDrift');
    lane.setCursor({ x: 0.2, y: 0.0, dipX: 140, dipY: 100 }, 5_100);
    lane.tick(5_100);
    expect(lane.state).toBe('follow');
  });

  it('breaks the follow every 8-20 s, emits gazeBreak with degrees, returns, and suppresses a second break for 4 s', () => {
    const { lane, traces } = harness(11);
    lane.setLiveliness({ saccadeIntervalMs: 16_400, saccadeAmplitude: 0.65 });
    lane.setCursor({ x: 0, y: 0, dipX: 0, dipY: 0 }, 0);
    let firstBreakAt = -1;
    let breakEndedAt = -1;
    for (let t = 0; t <= 60_000; t += 16) {
      lane.setCursor({ x: 0, y: 0, dipX: (t / 16) % 2 === 0 ? 0 : 10, dipY: 0 }, t);   // keeps the cursor "moving"
      lane.tick(t);
      if (lane.state === 'saccadeBreak' && firstBreakAt < 0) firstBreakAt = t;
      if (firstBreakAt >= 0 && breakEndedAt < 0 && lane.state === 'follow') breakEndedAt = t;
    }
    expect(firstBreakAt).toBeGreaterThanOrEqual(SACCADE_MIN_MS);
    expect(firstBreakAt).toBeLessThanOrEqual(SACCADE_MAX_MS + 16);
    expect(breakEndedAt).toBeGreaterThan(firstBreakAt);
    expect(traces.length).toBeGreaterThanOrEqual(3);
    for (const rec of traces) {
      expect(rec.kind).toBe('gazeBreak');
      expect(['lookAwayBack', 'microFidget', 'doubleGlance']).toContain(rec.label);
      expect(rec.value).toBeGreaterThan(0);
      expect(rec.value).toBeLessThanOrEqual(35 * 0.65);
    }
  });

  it('LLM look lease pre-empts the saccade timer for 6 s and maps the anchor', () => {
    const { lane, targets } = harness();
    lane.setCursor({ x: 0.5, y: 0.5, dipX: 0, dipY: 0 }, 0);
    const log: string[] = [];
    const lease = lane.look({ kind: 'anchor', anchor: 'user' }, 1_000, (r) => log.push(r))!;
    expect(lease.source).toBe('llm');
    expect(lease.ttlMs).toBe(LOOK_LEASE_TTL_MS);
    expect(lane.tick(1_000).eyes).toEqual({ x: 0, y: 0.15 });
    expect(targets.at(-1)).toEqual([0, 0.15]);
    lane.tick(6_999);
    expect(log).toEqual([]);
    lane.tick(7_000);
    expect(log).toEqual(['expired']);
    lane.setCursor({ x: 0.5, y: 0.5, dipX: 50, dipY: 0 }, 7_000);   // a real move: back to follow, not restDrift
    expect(lane.tick(7_000).eyes).toEqual({ x: 0.5, y: 0.5 });
    expect(lane.state).not.toBe('saccadeBreak');
    lane.tick(7_000 + SACCADE_SUPPRESS_MS - 1);
    expect(lane.state).not.toBe('saccadeBreak');
  });

  it('a point look target and a touch target; touch beats llm, llm is refused under touch', () => {
    const { lane } = harness();
    const log: string[] = [];
    lane.look({ kind: 'point', x: -0.75, y: -0.5 }, 0, (r) => log.push(`llm:${r}`));
    expect(lane.tick(0).eyes).toEqual({ x: -0.75, y: -0.5 });
    lane.touchTarget({ x: 0.1, y: 0.2, followCursor: false }, 400, 100, (r) => log.push(`touch:${r}`));
    expect(log).toEqual(['llm:preempted']);
    expect(lane.look({ kind: 'anchor', anchor: 'up' }, 150, (r) => log.push(`llm2:${r}`))).toBeNull();
    expect(log).toEqual(['llm:preempted', 'llm2:preempted']);
    lane.tick(500);
    expect(log).toEqual(['llm:preempted', 'llm2:preempted', 'touch:expired']);
  });

  it('sleep overrides everything; head and body lag the eyes on a large jump, not on a small one', () => {
    const { lane } = harness();
    lane.setCursor({ x: 0, y: 0, dipX: 0, dipY: 0 }, 0);
    lane.tick(0);
    lane.look({ kind: 'anchor', anchor: 'right' }, 100);          // 0.7 × 30° = 21° > EYES_ONLY_THRESHOLD_DEG
    const t0 = lane.tick(100);
    expect(t0.eyes.x).toBe(0.7);
    expect(t0.head.x).toBe(0);
    expect(lane.tick(100 + GAZE_HEAD_DELAY_MS).head.x).toBeCloseTo(0.7 * GAZE_HEAD_FRACTION, 10);
    expect(lane.tick(100 + GAZE_BODY_DELAY_MS).body.x).toBeCloseTo(0.7 * GAZE_BODY_FRACTION, 10);
    lane.end('cancelled', 1_000);
    lane.tick(1_000);
    lane.look({ kind: 'point', x: 0.2, y: 0 }, 1_100);              // 6° < threshold: eyes only
    const small = lane.tick(1_100 + GAZE_BODY_DELAY_MS);
    expect(small.eyes.x).toBe(0.2);
    expect(small.head.x).toBeCloseTo(0.7 * GAZE_HEAD_FRACTION, 10);
    lane.setPresentation('sleep');
    lane.tick(2_000);
    expect(lane.state).toBe('sleep');
    lane.setPresentation('awake');
    lane.tick(2_100);
    expect(lane.state).toBe('follow');
  });
});
