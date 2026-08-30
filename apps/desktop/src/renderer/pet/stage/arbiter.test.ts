import { describe, expect, it } from 'vitest';
import type { Payload } from '@ds/protocol';
import {
  Arbiter, BLINK_DOUBLET_P, BLINK_MEAN_FOLLOW_MS, BLINK_MEAN_REST_MS, BLINK_MIN_INTERVAL_MS,
  BLINK_SIGMA_FOLLOW_MS, BLINK_SIGMA_REST_MS, BLINK_CLOSED_SLEEPY_S, BLINK_DRAW_INTERVAL_S,
  fadeFor, lognormalMs, GLANCE_MS, RETURN_GAZE_EASE_MS, RETURN_GAZE_MS,
  type ArbiterPorts, type TouchReaction,
} from './arbiter';
import {
  MOTION_FADE_IDLE_S, MOTION_FADE_LLM_S, MOTION_FADE_TOUCH_S, MOTION_GROUP_COOLDOWN_MS,
  MOTION_MIN_PLAY_MS, TOUCH_EXPR_MS, TOUCH_PREEMPT_MAX_MS,
} from '../../shared/lane-metrics';
import { EXPR_TOTAL_CEILING_MS } from './expression-lease';

type Trace = Payload<'arb:trace'>;

function harness(opts: { valence?: number } = {}) {
  let now = 0;
  const timers: { due: number; fn: () => void }[] = [];
  const calls: string[] = [];
  const traces: Trace[] = [];
  const ports: ArbiterPorts = {
    now: () => now,
    schedule: (fn, ms) => { timers.push({ due: now + ms, fn }); },
    trace: (rec) => { traces.push(rec); },
    motion: { startMotionForced: (g, i, fade) => { calls.push(`motion:${g}[${i}]@${fade}`); return true; } },
    expression: {
      setExpression: (n) => { calls.push(`expr:${n}`); },
      setExpressionWeight: (n, w) => { calls.push(`weight:${n}=${w.toFixed(2)}`); },
    },
    gaze: {
      apply: (t, ease) => { calls.push(`gaze:${t.kind === 'pattern' ? t.pattern : t.kind === 'anchor' ? t.anchor : `${t.x},${t.y}`}${ease === undefined ? '' : `@${ease}`}`); },
      release: () => { calls.push('gaze:release'); },
    },
    overlay: { set: (p) => { calls.push(`overlay:${p}`); } },
    blink: { force: () => { calls.push('blink:force'); }, setSleepy: (on) => { calls.push(`sleepy:${on}`); } },
  };
  const arb = new Arbiter(ports, { valence: opts.valence ?? 0 });
  /** Advances the clock, firing due timers in order and ticking the arbiter at each stop. */
  const advance = (to: number): void => {
    timers.sort((a, b) => a.due - b.due);
    while (timers.length > 0 && timers[0].due <= to) {
      const t = timers.shift()!;
      now = t.due;
      t.fn();
      arb.update(now);
    }
    now = to;
    arb.update(now);
  };
  const touch: TouchReaction = {
    motion: ['TapBody', 0], expression: { name: 'F02', weight: 0.55 }, gaze: 'cursorLock', overlay: 'headTilt',
  };
  const behaviour = (id = 'idle_breathe') => arb.behaviour({
    id, motion: ['Idle', 0], expression: null, expressionWeight: 0.55, gaze: 'follow', overlay: 'none', durationMs: 8000,
  }, now);
  return { arb, ports, calls, traces, advance, touch, behaviour, get now() { return now; } };
}

describe('fadeFor — MOTION_FADE_* by source (§5.5)', () => {
  it('maps every source', () => {
    expect(fadeFor('touch')).toBe(MOTION_FADE_TOUCH_S);
    expect(fadeFor('sim')).toBe(MOTION_FADE_TOUCH_S);
    expect(fadeFor('llm')).toBe(MOTION_FADE_LLM_S);
    expect(fadeFor('behaviour')).toBe(MOTION_FADE_IDLE_S);
    expect(fadeFor('idle')).toBe(MOTION_FADE_IDLE_S);
    expect(fadeFor('drag')).toBe(MOTION_FADE_TOUCH_S);
  });
});

describe('Arbiter — interruption matrix (§5.1)', () => {
  it('drag pre-empts anything on the body lane immediately', () => {
    const h = harness();
    h.behaviour();
    expect(h.calls).toContain(`motion:Idle[0]@${MOTION_FADE_IDLE_S}`);
    h.arb.dragStart(h.now);
    const results = h.traces.filter((t) => t.kind === 'laneResult' && t.lane === 'body');
    expect(results.at(-1)).toMatchObject({ source: 'behaviour', result: 'preempted' });
    expect(h.arb.lanes().find((l) => l.lane === 'body')).toMatchObject({ source: 'drag' });
  });

  it('touch over an LLM motion swaps at min(MIN_PLAY boundary, now + TOUCH_PREEMPT_MAX_MS)', () => {
    const h = harness();
    h.arb.llm({ expression: 'F01', motion: ['TapBody', 1], look: null, emotion: 'happy' }, 0);
    h.advance(100);
    h.arb.touch(h.touch, 100);
    // Expression and gaze acknowledge on the same frame; the body waits.
    expect(h.calls).toContain('expr:F02');
    expect(h.calls).not.toContain(`motion:TapBody[0]@${MOTION_FADE_TOUCH_S}`);
    h.advance(100 + TOUCH_PREEMPT_MAX_MS - 1);
    expect(h.calls).not.toContain(`motion:TapBody[0]@${MOTION_FADE_TOUCH_S}`);
    h.advance(100 + TOUCH_PREEMPT_MAX_MS);
    expect(h.calls).toContain(`motion:TapBody[0]@${MOTION_FADE_TOUCH_S}`);
    expect(h.traces.filter((t) => t.kind === 'laneResult' && t.lane === 'body').at(-1))
      .toMatchObject({ source: 'llm', result: 'preempted' });
  });

  it('touch over an LLM motion past its MIN_PLAY boundary swaps at the boundary when that is sooner', () => {
    const h = harness();
    h.arb.llm({ expression: 'F01', motion: ['TapBody', 1], look: null, emotion: 'happy' }, 0);
    h.advance(700);
    h.arb.touch(h.touch, 700);
    h.advance(MOTION_MIN_PLAY_MS - 1);
    expect(h.calls).not.toContain(`motion:TapBody[0]@${MOTION_FADE_TOUCH_S}`);
    h.advance(MOTION_MIN_PLAY_MS);
    expect(h.calls).toContain(`motion:TapBody[0]@${MOTION_FADE_TOUCH_S}`);
  });

  it('touch covers an LLM expression lease and restores it with its remaining time (B-05)', () => {
    const h = harness();
    h.arb.llm({ expression: 'F01', motion: null, look: null, emotion: 'happy' }, 0);
    h.arb.utteranceEnded(1000);
    h.advance(2000);
    h.arb.touch(h.touch, 2000);
    expect(h.calls.at(-3)).toBe('expr:F02');
    h.advance(2000 + TOUCH_EXPR_MS);
    // Restored: F01 back, weight evaluated at the real elapsed time (holdUntil = 4000, still holding).
    expect(h.calls.slice(-4)).toContain('weight:F02=1.00');
    expect(h.calls.slice(-4)).toContain('expr:F01');
    expect(h.calls.slice(-4)).toContain('weight:F01=0.65');
    const results = h.traces.filter((t) => t.kind === 'laneResult' && t.lane === 'expression');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ source: 'touch', result: 'preempted' });
    // The LLM lease keeps counting down while covered: it ends on its own curve, not later.
    h.advance(4000 + 8000);
    expect(h.traces.filter((t) => t.kind === 'laneResult' && t.lane === 'expression').at(-1))
      .toMatchObject({ source: 'llm', result: 'completed' });
  });

  it('a covered LLM lease that expires under the touch reports expired and is not restored', () => {
    const h = harness();
    h.arb.llm({ expression: 'F01', motion: null, look: null, emotion: 'happy' }, 0);
    h.arb.utteranceEnded(0);
    h.advance(10_500);                       // hold ends at 3000, decay ends at 11000
    h.arb.touch(h.touch, 10_500);
    h.advance(10_500 + TOUCH_EXPR_MS);
    const results = h.traces.filter((t) => t.kind === 'laneResult' && t.lane === 'expression');
    expect(results.map((r) => `${r.source}:${r.result}`)).toEqual(['llm:expired', 'touch:preempted']);
    expect(h.calls.at(-1)).toBe('expr:null');
  });

  it('an LLM motion arriving under a touch is refused and reported preempted; its expression is queued behind the cover', () => {
    const h = harness();
    h.arb.touch(h.touch, 0);
    h.arb.llm({ expression: 'F01', motion: ['TapBody', 2], look: null, emotion: 'happy' }, 10);
    expect(h.calls).not.toContain(`motion:TapBody[2]@${MOTION_FADE_LLM_S}`);
    const refused = h.traces.filter((t) => t.kind === 'laneResult' && t.lane === 'body' && t.source === 'llm');
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ result: 'preempted', generation: null });
    h.advance(TOUCH_EXPR_MS);
    expect(h.calls.at(-2)).toBe('expr:F01');
  });

  it('a newer LLM motion wins over an older one regardless of MIN_PLAY', () => {
    const h = harness();
    h.arb.llm({ expression: 'F01', motion: ['TapBody', 1], look: null, emotion: 'happy' }, 0);
    h.advance(MOTION_GROUP_COOLDOWN_MS + 1);
    h.arb.llm({ expression: 'F02', motion: ['TapBody', 2], look: null, emotion: 'curious' }, h.now);
    expect(h.calls).toContain(`motion:TapBody[2]@${MOTION_FADE_LLM_S}`);
    expect(h.traces.filter((t) => t.kind === 'laneResult' && t.lane === 'body').at(-1))
      .toMatchObject({ source: 'llm', result: 'preempted' });
  });

  it('a second ACT inside MOTION_GROUP_COOLDOWN_MS updates the expression only', () => {
    const h = harness();
    h.arb.llm({ expression: 'F01', motion: ['TapBody', 1], look: null, emotion: 'happy' }, 0);
    h.advance(MOTION_GROUP_COOLDOWN_MS - 1);
    h.arb.llm({ expression: 'F02', motion: ['TapBody', 2], look: null, emotion: 'curious' }, h.now);
    expect(h.calls).not.toContain(`motion:TapBody[2]@${MOTION_FADE_LLM_S}`);
    expect(h.calls.at(-2)).toBe('expr:F02');
    expect(h.traces.filter((t) => t.kind === 'laneResult' && t.lane === 'body' && t.generation === null).at(-1))
      .toMatchObject({ source: 'llm', result: 'preempted' });
  });

  it('a behaviour is refused under llm and touch; granted otherwise', () => {
    const h = harness();
    h.arb.llm({ expression: 'F01', motion: ['TapBody', 1], look: null, emotion: 'happy' }, 0);
    expect(h.behaviour()).toBe(false);
    h.arb.dragStart(0);
    h.arb.dragEnd(0);
    h.arb.touch(h.touch, 0);
    expect(h.behaviour()).toBe(false);
    h.advance(TOUCH_EXPR_MS);
    expect(h.behaviour()).toBe(true);
    const grants = h.traces.filter((t) => t.kind === 'laneGrant' && t.source === 'behaviour').map((t) => t.lane);
    expect(grants).toEqual(['body', 'expression', 'gaze']);
  });

  it('a behaviour body lease expires at durationMs and reports the result to the runner', () => {
    const h = harness();
    const ended: string[] = [];
    h.arb.onBehaviourResult((id, result) => ended.push(`${id}:${result}`));
    h.behaviour('stretch');
    h.advance(7999);
    expect(ended).toEqual([]);
    h.advance(8000);
    expect(ended).toEqual(['stretch:expired']);
    expect(h.traces.filter((t) => t.kind === 'laneGrant' && t.lane === 'body')[0]).toMatchObject({ id: 'Idle_0', ttlMs: 8000 });
  });
});

describe('Arbiter — expression application (§5.4)', () => {
  it('clamps LLM weight to 0.65 (surprised 1.0) and resets the weight to 1.0 on release', () => {
    const h = harness();
    h.arb.llm({ expression: 'F03', motion: null, look: null, emotion: 'surprised' }, 0);
    expect(h.calls).toContain('weight:F03=1.00');
    h.arb.llm({ expression: 'F01', motion: null, look: null, emotion: 'happy' }, 10);
    expect(h.calls.slice(-3)).toEqual(['weight:F03=1.00', 'expr:F01', 'weight:F01=0.65']);
  });

  it('holds the mood baseline when no lease is live', () => {
    const h = harness({ valence: 0.5 });
    h.arb.update(0);
    expect(h.calls.slice(-2)).toEqual(['expr:F01', 'weight:F01=0.25']);
    h.arb.setValence(-0.5);
    h.arb.update(1);
    expect(h.calls.slice(-3)).toEqual(['weight:F01=1.00', 'expr:F04', 'weight:F04=0.15']);
  });
});

describe('Arbiter — plain mode (R3-12, §9.4)', () => {
  it('refuses every source:llm command and cancels a live LLM lease on the switch', () => {
    const h = harness();
    h.arb.llm({ expression: 'F01', motion: ['TapBody', 1], look: null, emotion: 'happy' }, 0);
    h.arb.setMode('plain');
    expect(h.traces.filter((t) => t.kind === 'laneResult' && t.source === 'llm').map((t) => t.result)).toEqual(['cancelled', 'cancelled']);
    const before = h.calls.length;
    h.arb.llm({ expression: 'F02', motion: ['TapBody', 2], look: { kind: 'anchor', anchor: 'user' }, emotion: 'curious' }, 10);
    expect(h.calls.length).toBe(before);
    expect(h.traces.filter((t) => t.kind === 'laneGrant' && t.source === 'llm')).toHaveLength(2);
    h.arb.setMode('character');
    h.arb.llm({ expression: 'F02', motion: ['TapBody', 2], look: null, emotion: 'curious' }, 20);
    expect(h.calls).toContain(`motion:TapBody[2]@${MOTION_FADE_LLM_S}`);
  });
});

describe('Arbiter — sim one-shots (§5.10, §10.4)', () => {
  it('runs the D5 return sequence at t+0 / t+120 / t+150 / t+1500 with a returnGeneration guard', () => {
    const h = harness();
    h.arb.simEvent('returned', 0);
    expect(h.calls.slice(0, 2)).toEqual(['gaze:cursorLock@120', 'blink:force']);
    h.advance(119);
    expect(h.calls).not.toContain('expr:F06');
    h.advance(120);
    expect(h.calls.slice(-2)).toEqual(['expr:F06', 'weight:F06=0.40']);
    h.advance(150);
    expect(h.calls.at(-1)).toBe(`motion:TapBody[0]@${MOTION_FADE_TOUCH_S}`);
    const grants = h.traces.filter((t) => t.kind === 'laneGrant' && t.source === 'sim');
    expect(grants.map((g) => `${g.lane}:${g.ttlMs}`)).toEqual(['gaze:900', 'expression:1200', 'body:1500']);
    h.advance(1500);
    expect(h.arb.lanes().every((l) => l.source === null)).toBe(true);
    // A second `returned` before the timers fire supersedes the first: the stale timers do nothing.
    h.arb.simEvent('returned', 2000);
    h.arb.simEvent('returned', 2010);
    h.advance(2200);
    expect(h.traces.filter((t) => t.kind === 'laneGrant' && t.source === 'sim' && t.lane === 'expression')).toHaveLength(2);
  });

  it('typingGlance is gaze-only (900 ms, screen); cursorWiggle is gaze cursorLock + F06 0.4 for 1200 ms', () => {
    const h = harness();
    h.arb.simEvent('typingGlance', 0);
    expect(h.calls).toEqual(['gaze:screen']);
    const g1 = h.traces.filter((t) => t.kind === 'laneGrant');
    expect(g1.map((g) => `${g.lane}:${g.ttlMs}`)).toEqual(['gaze:900']);
    h.advance(900);
    h.arb.simEvent('cursorWiggle', 900);
    expect(h.calls.slice(-3)).toEqual(['gaze:cursorLock', 'expr:F06', 'weight:F06=0.40']);
    const g2 = h.traces.filter((t) => t.kind === 'laneGrant').slice(1);
    expect(g2.map((g) => `${g.lane}:${g.ttlMs}`)).toEqual(['gaze:1200', 'expression:1200']);
    expect(h.traces.some((t) => t.kind === 'laneGrant' && t.lane === 'body')).toBe(false);
  });

  it('a sim reaction is refused under llm/touch/drag and never fights the body lane', () => {
    const h = harness();
    h.arb.llm({ expression: 'F01', motion: ['TapBody', 1], look: null, emotion: 'happy' }, 0);
    h.arb.simEvent('returned', 0);
    h.advance(200);
    expect(h.calls).not.toContain(`motion:TapBody[0]@${MOTION_FADE_TOUCH_S}`);
  });
});

describe('Arbiter — blink draw (§5.7, D2)', () => {
  it('pins the D2 constants', () => {
    expect([BLINK_MEAN_FOLLOW_MS, BLINK_SIGMA_FOLLOW_MS, BLINK_MEAN_REST_MS, BLINK_SIGMA_REST_MS])
      .toEqual([4_000, 1_500, 6_500, 2_400]);
    expect([BLINK_MIN_INTERVAL_MS, BLINK_DOUBLET_P, BLINK_CLOSED_SLEEPY_S]).toEqual([1_200, 0.12, 0.25]);
  });

  it('lognormalMs has the requested mean/sd to within 3 % over 20 000 draws and never goes below the floor', () => {
    let a = 7 >>> 0;
    const rng = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const xs: number[] = [];
    for (let i = 0; i < 20_000; i++) xs.push(lognormalMs(BLINK_MEAN_FOLLOW_MS, BLINK_SIGMA_FOLLOW_MS, rng(), rng()));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean - 4000) / 4000).toBeLessThan(0.03);
    expect(Math.abs(sd - 1500) / 1500).toBeLessThan(0.05);
    expect(Math.min(...xs)).toBeGreaterThan(0);
  });

  it('blinkRng returns the next interval as a fraction of the CubismEyeBlink span, floors it, emits one blink trace per completed blink and 12 % doublets', () => {
    const h = harness();
    let k = 0;
    const seq = [0.5, 0.5, 0.01, 0.5, 0.5, 0.5, 0.99, 0.5, 0.5, 0.5];
    const rng = h.arb.blinkRng(() => seq[k++ % seq.length]);
    const span = 2 * BLINK_DRAW_INTERVAL_S - 1;
    const first = rng();                       // CubismEyeBlink's First-state draw: no blink yet
    expect(h.traces.filter((t) => t.kind === 'blink')).toHaveLength(0);
    expect(first * span * 1000).toBeGreaterThanOrEqual(BLINK_MIN_INTERVAL_MS);
    const second = rng();                      // doublet roll 0.01 < 0.12: arms a 250-400 ms doublet
    expect(h.traces.filter((t) => t.kind === 'blink')).toHaveLength(1);
    expect(h.traces.at(-1)).toMatchObject({ kind: 'blink', flag: false, lane: null, source: null, generation: null, id: '', result: null, value: null });
    const third = rng();
    expect(third * span * 1000).toBeGreaterThanOrEqual(250);
    expect(third * span * 1000).toBeLessThanOrEqual(400);
    expect(h.traces.at(-1)).toMatchObject({ kind: 'blink', flag: true });
    expect(second).toBeGreaterThan(0);
    h.arb.setBlinkState('sleep');
    expect(rng()).toBeGreaterThanOrEqual(0.999);   // sleep: no blink inside the span
    expect(h.calls).not.toContain('sleepy:true');
    h.arb.setBlinkState('sleepy');
    expect(h.calls.at(-1)).toBe('sleepy:true');
    h.arb.setBlinkState('rest');
    expect(h.calls.at(-1)).toBe('sleepy:false');
  });
});

describe('Arbiter — fix round 1', () => {
  it('reports a behaviour that a NEW grant pre-empted, not only one that expired (finding 1)', () => {
    // main calls arbiter.dragStart() on every `arb:grab`, i.e. on every single tap. The report used
    // to be skipped whenever `granting > 0`, so the runner kept `currentId`, emitted no
    // `behaviourEnd`, never called `selector.finish` and refused to re-select for 4-9 s.
    for (const preempt of [
      (h: ReturnType<typeof harness>) => { h.arb.dragStart(h.now); },
      (h: ReturnType<typeof harness>) => { h.arb.touch(h.touch, h.now); },
      (h: ReturnType<typeof harness>) => { h.arb.llm({ expression: 'F01', motion: ['TapBody', 1], look: null, emotion: 'happy' }, h.now); },
      (h: ReturnType<typeof harness>) => { h.arb.simEvent('returned', h.now); h.advance(150); },
    ]) {
      const h = harness();
      const ended: string[] = [];
      h.arb.onBehaviourResult((id, result) => ended.push(`${id}:${result}`));
      h.behaviour('stretch');
      preempt(h);
      expect(ended).toEqual(['stretch:preempted']);
    }
  });

  it('a behaviour end delivered mid-grant sees the settled lane, so the runner cannot steal it (finding 1)', () => {
    const h = harness();
    // The real BehaviourRunner re-enters `behaviour()` from its result callback (`onEnd → decide`).
    let reentered: boolean | null = null;
    h.arb.onBehaviourResult(() => { reentered = h.behaviour('yawn'); });
    h.behaviour('stretch');
    h.arb.dragStart(h.now);
    expect(reentered).toBe(false);                                   // drag owns the body lane
    expect(h.arb.lanes().find((l) => l.lane === 'body')).toMatchObject({ source: 'drag' });
  });

  it('a behaviour re-entered from a behaviour end is refused, and the end sees all three lanes settled (fix round 2, finding 1)', () => {
    // The runner's `onEnd` calls `decide()` synchronously, and behaviour-vs-behaviour is EQUAL rank,
    // so a re-entrant command would be granted — winning three lanes the command in flight is about
    // to overwrite two of, leaving the body playing one behaviour and expression/gaze another.
    const h = harness();
    const ended: string[] = [];
    let reentered: boolean | null = null;
    let lanesAtEnd: { lane: string; source: string | null; generation: number }[] = [];
    h.arb.onBehaviourResult((id, result) => {
      ended.push(`${id}:${result}`);
      lanesAtEnd = h.arb.lanes();
      if (reentered === null) reentered = h.behaviour('yawn');
    });
    h.behaviour('stretch');
    h.behaviour('doze');                                   // equal rank: pre-empts `stretch`
    expect(ended).toEqual(['stretch:preempted']);
    expect(reentered).toBe(false);
    // The end was delivered with `doze` installed on ALL THREE lanes (generation 2 everywhere), not
    // after the body grant alone.
    expect(lanesAtEnd.map((l) => `${l.lane}:${l.source}:${l.generation}`))
      .toEqual(['body:behaviour:2', 'expression:behaviour:2', 'gaze:behaviour:2']);
    // `yawn` took nothing: six behaviour grants (three each for stretch and doze) and three refusals.
    expect(h.traces.filter((t) => t.kind === 'laneGrant' && t.source === 'behaviour')).toHaveLength(6);
    expect(h.traces.filter((t) => t.kind === 'laneResult' && t.source === 'behaviour' && t.id === 'yawn')
      .map((t) => `${t.lane}:${t.result}:${t.generation}`))
      .toEqual(['body:preempted:null', 'expression:preempted:null', 'gaze:preempted:null']);
    expect(h.arb.lanes().map((l) => `${l.lane}:${l.source}:${l.generation}`))
      .toEqual(['body:behaviour:2', 'expression:behaviour:2', 'gaze:behaviour:2']);
  });

  it('mayTake() answers for all three lanes without touching them (fix round 2, finding 3)', () => {
    const h = harness();
    expect(h.arb.mayTake('behaviour')).toBe(true);
    h.behaviour('stretch');
    expect(h.arb.mayTake('behaviour')).toBe(true);          // equal rank: a boundary may re-decide
    h.arb.llm({ expression: 'F01', motion: ['TapBody', 1], look: null, emotion: 'happy' }, 0);
    expect(h.arb.mayTake('behaviour')).toBe(false);
    expect(h.arb.mayTake('touch')).toBe(true);
    const before = h.traces.length;
    expect(h.arb.mayTake('behaviour')).toBe(false);
    expect(h.traces).toHaveLength(before);                  // a probe is not a command: no records
  });

  it('a refused behaviour reports `preempted` on the lanes that refused it (finding 5)', () => {
    const h = harness();
    h.arb.llm({ expression: 'F01', motion: ['TapBody', 1], look: null, emotion: 'happy' }, 0);
    expect(h.behaviour('stretch')).toBe(false);
    const refusals = h.traces.filter((t) => t.kind === 'laneResult' && t.source === 'behaviour');
    expect(refusals.map((r) => `${r.lane}:${r.id}:${r.result}:${r.generation}`))
      .toEqual(['body:stretch:preempted:null', 'expression:stretch:preempted:null']);
    // The LLM took body + expression only, so the gaze lane was free and is not reported.
    expect(refusals.some((r) => r.lane === 'gaze')).toBe(false);
  });

  it('the covered LLM expression lease announces itself with a laneGrant (finding 7)', () => {
    const h = harness();
    h.arb.touch(h.touch, 0);
    h.arb.llm({ expression: 'F01', motion: null, look: null, emotion: 'happy' }, 10);
    const covered = h.traces.filter((t) => t.lane === 'expression' && t.source === 'llm');
    expect(covered.map((t) => `${t.kind}:${t.id}:${t.generation}`)).toEqual(['laneGrant:F01:null']);
    expect(covered[0]).toMatchObject({ ttlMs: EXPR_TOTAL_CEILING_MS });
    // ... and the record closes when the cover lifts (a restore is a second grant of the SAME lease,
    // R3-4) and the restored lease finishes its own curve. Every record carries the same generation,
    // so nothing is left dangling for Task 17's assert-trace.
    h.advance(TOUCH_EXPR_MS);
    h.advance(60_000);
    const after = h.traces.filter((t) => t.lane === 'expression' && t.source === 'llm');
    expect(after.map((t) => `${t.kind}:${t.generation}`))
      .toEqual(['laneGrant:null', 'laneGrant:null', 'laneResult:null']);
  });

  it('gaze grants hand the port the lease ttl AND the ease as separate numbers (finding 4)', () => {
    // main.ts fed `ease` to GazeLane.touchTarget as its ttl, so §5.10's 900 ms gaze lease died at 120 ms.
    const seen: { ease: number | undefined; ttl: number | undefined }[] = [];
    let now = 0;
    const timers: { due: number; fn: () => void }[] = [];
    const ports: ArbiterPorts = {
      now: () => now,
      schedule: (fn, ms) => { timers.push({ due: now + ms, fn }); },
      trace: () => {},
      motion: { startMotionForced: () => true },
      expression: { setExpression: () => {}, setExpressionWeight: () => {} },
      gaze: { apply: (_t, ease, ttl) => { seen.push({ ease, ttl }); }, release: () => {} },
      overlay: { set: () => {} },
      blink: { force: () => {}, setSleepy: () => {} },
    };
    const arb = new Arbiter(ports);
    arb.simEvent('returned', 0);
    expect(seen).toEqual([{ ease: RETURN_GAZE_EASE_MS, ttl: RETURN_GAZE_MS }]);
    arb.simEvent('typingGlance', 0);
    expect(seen.at(-1)).toEqual({ ease: undefined, ttl: GLANCE_MS });
  });
});
