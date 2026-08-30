import { describe, expect, it } from 'vitest';
import { TOUCH_EXPR_MS } from '../../shared/lane-metrics';
import { TOUCH_PREEMPT_RESTORE as B05 } from '../../../../tests/fixtures/arbiter/touch-preempt-restore.fixture';
import {
  EXPR_DECAY_MS, EXPR_FADE_MS, EXPR_HOLD_AFTER_UTTERANCE_MS, EXPR_HOLD_CEILING_MS, EXPR_INTENSITY_CLAMP,
  EXPR_SURPRISED_MAX, EXPR_TOTAL_CEILING_MS, ExpressionLane, baselineExpression, clampExpressionWeight,
  easeOutCubic, expressionWeightAt, type ExpressionSink,
} from './expression-lease';

function sink() {
  const calls: string[] = [];
  const s: ExpressionSink = {
    setExpression: (name) => calls.push(`start:${name}`),
    setExpressionWeight: (name, w) => calls.push(`weight:${name}:${w.toFixed(4)}`),
  };
  return { s, calls };
}

describe('constants (§5.4, R3-4)', () => {
  it('pins the seven numbers', () => {
    expect(EXPR_INTENSITY_CLAMP).toBe(0.65);
    expect(EXPR_SURPRISED_MAX).toBe(1.0);
    expect(EXPR_HOLD_AFTER_UTTERANCE_MS).toBe(3_000);
    expect(EXPR_HOLD_CEILING_MS).toBe(82_000);
    expect(EXPR_DECAY_MS).toBe(8_000);
    expect(EXPR_TOTAL_CEILING_MS).toBe(90_000);
    expect(EXPR_TOTAL_CEILING_MS).toBe(EXPR_HOLD_CEILING_MS + EXPR_DECAY_MS);
    expect(EXPR_FADE_MS).toBe(300);
  });
});

describe('easeOutCubic / expressionWeightAt', () => {
  it('is the cubic ease-out', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10);
    expect(easeOutCubic(1)).toBe(1);
  });
  it('holds until utteranceEnd + 3 s, then decays to 0 over 8 s', () => {
    const lease = { issuedAt: 1_000, utteranceEndAt: 5_000, weight: 0.65 };
    expect(expressionWeightAt(lease, 8_000)).toBe(0.65);
    expect(expressionWeightAt(lease, 8_001)).toBeLessThan(0.65);
    expect(expressionWeightAt(lease, 12_000)).toBeCloseTo(0.65 * (1 - easeOutCubic(0.5)), 10);
    expect(expressionWeightAt(lease, 16_000)).toBe(0);
    expect(expressionWeightAt(lease, 60_000)).toBe(0);
  });
  it('never holds past issuedAt + 82 s and is 0 by issuedAt + 90 s (D14 ceiling)', () => {
    const lease = { issuedAt: 0, utteranceEndAt: 100_000, weight: 0.65 };
    expect(expressionWeightAt(lease, 82_000)).toBe(0.65);
    expect(expressionWeightAt(lease, 82_001)).toBeLessThan(0.65);
    expect(expressionWeightAt(lease, 90_000)).toBe(0);
  });
  it('uses issuedAt when the utterance has not ended', () => {
    expect(expressionWeightAt({ issuedAt: 0, utteranceEndAt: null, weight: 0.5 }, 3_000)).toBe(0.5);
    expect(expressionWeightAt({ issuedAt: 0, utteranceEndAt: null, weight: 0.5 }, 11_000)).toBe(0);
  });
});

describe('baselineExpression / clampExpressionWeight', () => {
  it('maps valence to F01 / rest / F04', () => {
    expect(baselineExpression(0.35)).toEqual({ name: 'F01', weight: 0.25 });
    expect(baselineExpression(0.10)).toEqual({ name: null, weight: 0 });
    expect(baselineExpression(-0.20)).toEqual({ name: 'F04', weight: 0.15 });
  });
  it('clamps to 0.65, except surprised to 1.0', () => {
    expect(clampExpressionWeight('happy', 0.9)).toBe(0.65);
    expect(clampExpressionWeight('surprised', 0.9)).toBe(0.9);
    expect(clampExpressionWeight('surprised', 1.4)).toBe(1.0);
    expect(clampExpressionWeight('sad', 0.3)).toBe(0.3);
    expect(clampExpressionWeight('sad', Number.NaN)).toBe(0);
  });
});

describe('ExpressionLane', () => {
  it('B-05: touch covers the LLM lease, restores it with its remaining time, and only the touch reports', () => {
    const { s, calls } = sink();
    const lane = new ExpressionLane(s);
    const log: string[] = [];
    const llm = lane.request({
      lane: 'expression', source: 'llm', generation: 0, ttlMs: B05.llm.ttlMs,
      payload: { name: B05.llm.name, weight: clampExpressionWeight(B05.llm.emotion, B05.llm.requestedWeight), utteranceEndAt: null },
      onResult: (r) => log.push(`llm:${r}`),
    }, B05.llm.at)!;
    expect(llm.payload.weight).toBe(B05.expect.llmWeightApplied);
    expect(calls).toEqual(['start:F02', 'weight:F02:0.6500']);
    lane.tick(1_000);
    lane.request({
      lane: 'expression', source: 'touch', generation: 0, ttlMs: TOUCH_EXPR_MS,
      payload: { name: B05.touch.name, weight: B05.touch.weight, utteranceEndAt: null },
      onResult: (r) => log.push(`touch:${r}`),
    }, B05.touch.at);
    expect(lane.holder.current?.source).toBe('touch');
    expect(lane.coveredLease?.source).toBe('llm');
    expect(calls.slice(-3)).toEqual(['weight:F02:1.0000', 'start:F01', 'weight:F01:0.4500']);
    lane.tick(3_000);
    expect(log).toEqual([]);
    const ended = lane.tick(B05.overlayEndsAt);
    expect(ended?.source).toBe('touch');
    expect(log).toEqual([...B05.expect.resultsByOverlayEnd]);
    const restored = lane.holder.current!;
    expect(restored.source).toBe('llm');
    expect(restored.issuedAt).toBe(0);
    expect(restored.deadline).toBe(B05.expect.restoredDeadline);
    expect(calls.slice(-3)).toEqual(['weight:F01:1.0000', 'start:F02', `weight:F02:${B05.expect.weightAt3400.toFixed(4)}`]);
    expect(B05.expect.weightAt3400).toBeCloseTo(0.55729375, 8);
    lane.tick(11_000);
    expect(log).toEqual(['touch:preempted', 'llm:completed']);
    expect(calls.slice(-2)).toEqual(['weight:F02:1.0000', 'start:null']);
  });

  it('a covered lease that expires while covered reports expired and is not restored', () => {
    const { s } = sink();
    const lane = new ExpressionLane(s);
    const log: string[] = [];
    lane.request({ lane: 'expression', source: 'llm', generation: 0, ttlMs: 2_500,
      payload: { name: 'F02', weight: 0.5, utteranceEndAt: null }, onResult: (r) => log.push(`llm:${r}`) }, 0);
    lane.request({ lane: 'expression', source: 'touch', generation: 0, ttlMs: TOUCH_EXPR_MS,
      payload: { name: 'F01', weight: 0.4, utteranceEndAt: null }, onResult: (r) => log.push(`touch:${r}`) }, 2_000);
    lane.tick(2_500);
    expect(log).toEqual(['llm:expired']);
    lane.tick(3_400);
    expect(log).toEqual(['llm:expired', 'touch:expired']);
    expect(lane.holder.current).toBeNull();
  });

  it('resets the weight to 1.0 when an expression is released and shows the baseline', () => {
    const { s, calls } = sink();
    const lane = new ExpressionLane(s);
    lane.setBaseline(0.5, 0);
    expect(calls).toEqual(['start:F01', 'weight:F01:0.2500']);
    lane.request({ lane: 'expression', source: 'llm', generation: 0, ttlMs: 5_000,
      payload: { name: 'F02', weight: 0.6, utteranceEndAt: null } }, 0);
    lane.end('cancelled', 100);
    expect(calls.slice(2)).toEqual(['weight:F01:1.0000', 'start:F02', 'weight:F02:0.6000', 'weight:F02:1.0000', 'start:F01', 'weight:F01:0.2500']);
  });

  it('setUtteranceEnd extends the hold of the live LLM lease', () => {
    const { s } = sink();
    const lane = new ExpressionLane(s);
    const lease = lane.request({ lane: 'expression', source: 'llm', generation: 0, ttlMs: 90_000,
      payload: { name: 'F02', weight: 0.6, utteranceEndAt: null } }, 0)!;
    lane.setUtteranceEnd(20_000);
    expect(lease.payload.utteranceEndAt).toBe(20_000);
    expect(expressionWeightAt({ issuedAt: 0, utteranceEndAt: lease.payload.utteranceEndAt, weight: 0.6 }, 23_000)).toBe(0.6);
  });

  it('enforces §5.1: llm refused under touch, behaviour refused under llm/touch, newer llm wins', () => {
    const { s } = sink();
    const lane = new ExpressionLane(s);
    const log: string[] = [];
    const req = (source: 'touch' | 'llm' | 'behaviour' | 'sim', tag: string, at: number) => lane.request({
      lane: 'expression', source, generation: 0, ttlMs: 5_000,
      payload: { name: 'F01', weight: 0.3, utteranceEndAt: null }, onResult: (r) => log.push(`${tag}:${r}`) }, at);
    expect(req('llm', 'llm1', 0)).not.toBeNull();
    expect(req('behaviour', 'beh', 10)).toBeNull();
    expect(req('llm', 'llm2', 20)).not.toBeNull();
    expect(req('touch', 'touch', 30)).not.toBeNull();
    expect(req('llm', 'llm3', 40)).toBeNull();
    expect(req('sim', 'sim', 50)).toBeNull();
    expect(log).toEqual(['beh:preempted', 'llm1:preempted', 'llm3:preempted', 'sim:preempted']);
  });
});
