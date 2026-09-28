import { describe, expect, it } from 'vitest';
import type { WindowMotion } from '@ds/protocol';
import { RichInteractionController, TAIL_SEGMENT_COUNT } from './interaction-rig';

const motion = (phase: WindowMotion['phase'], lagX = 0, lagY = 0): WindowMotion => ({
  generation: 1,
  tsMain: 0,
  phase,
  vx: 0,
  vy: 0,
  lagX,
  lagY,
  contact: { x: 0.7, y: -0.1 },
});

const advance = (c: RichInteractionController, seconds: number) => {
  let frame = c.tick(0);
  for (let t = 0; t < seconds - 1e-9; t += 0.05) frame = c.tick(Math.min(0.05, seconds - t));
  return frame;
};

describe('RichInteractionController', () => {
  it('runs a six-link deterministic tail constraint while the tail is grabbed', () => {
    const c = new RichInteractionController();
    c.beginGrab('tail', 0.8, -0.1);
    c.onWindowMotion(motion('drag', 110, -25));
    const frame = advance(c, 0.5);
    expect(frame.grabbedPart).toBe('tail');
    expect(frame.parameters.ParamTailGrab).toBe(1);
    expect(frame.parameters.ParamTailStretch).toBeGreaterThan(0.2);
    expect(frame.tailAngles).toHaveLength(TAIL_SEGMENT_COUNT);
    expect(frame.tailAngles[0]).toBeGreaterThan(0.25);
    for (const angle of frame.tailAngles) expect(Number.isFinite(angle)).toBe(true);
  });

  it('preserves release momentum, then settles without leaving the legal range', () => {
    const c = new RichInteractionController();
    c.beginGrab('tail', 0.7, 0);
    c.onWindowMotion(motion('drag', 120, 0));
    advance(c, 0.35);
    c.release();
    c.onWindowMotion(motion('rest'));
    const early = advance(c, 0.1);
    const late = advance(c, 4);
    expect(early.parameters.ParamTailGrab).toBeUndefined();
    expect(Math.abs(early.tailAngles[0])).toBeGreaterThan(0.05);
    for (const angle of late.tailAngles) expect(angle).toBeGreaterThanOrEqual(-1);
    for (const angle of late.tailAngles) expect(angle).toBeLessThanOrEqual(1);
  });

  it('turns a walking window episode into alternating planted feet and counter-swinging limbs', () => {
    const c = new RichInteractionController();
    c.onWindowMotion(motion('walk'));
    const a = advance(c, 0.1);
    const b = advance(c, 0.15);
    expect(a.parameters.ParamLegStrideL).toBeCloseTo(-(a.parameters.ParamLegStrideR ?? 0), 5);
    expect(a.parameters.ParamArmSwingL).toBeCloseTo(-(a.parameters.ParamArmSwingR ?? 0), 5);
    expect((a.parameters.ParamFootPlantL ?? 0) + (a.parameters.ParamFootPlantR ?? 0)).toBe(1);
    expect(b.parameters.ParamLegStrideL).not.toBe(a.parameters.ParamLegStrideL);
  });

  it('authors eating as reach, bite, chew, cheek, swallow, and prop phases', () => {
    const c = new RichInteractionController();
    c.startAction('eat');
    const reach = advance(c, 0.9);
    expect(reach.parameters.ParamPropFood).toBeGreaterThan(0.9);
    expect(reach.parameters.ParamArmReachR).toBeGreaterThan(0.8);
    const bite = advance(c, 0.5);
    expect(bite.parameters.ParamMouthOpenY).toBeGreaterThan(0);
    const chew = advance(c, 0.9);
    expect(chew.parameters.ParamCheekPuff).toBeGreaterThan(0.2);
    expect(chew.parameters.ParamChew).toBeGreaterThanOrEqual(0);
    const swallow = advance(c, 1.1);
    expect(swallow.parameters.ParamSwallow).toBeGreaterThanOrEqual(0);
  });

  it('eases emotional micro-signals rather than snapping the face', () => {
    const c = new RichInteractionController();
    c.setEmotion('happy');
    const first = c.tick(0.01);
    const settled = advance(c, 1);
    expect(first.parameters.ParamEyeLSmile).toBeGreaterThan(0);
    expect(first.parameters.ParamEyeLSmile).toBeLessThan(settled.parameters.ParamEyeLSmile ?? 0);
    expect(settled.parameters.ParamCheekRaiseL).toBeGreaterThan(0.5);
    expect(settled.parameters.ParamMouthSmile).toBeGreaterThan(0.7);
    c.setEmotion('angry');
    const angry = advance(c, 1);
    expect(angry.parameters.ParamAnger).toBeGreaterThan(0.7);
    expect(angry.parameters.ParamNoseScrunch).toBeGreaterThan(0.25);
    expect(angry.parameters.ParamBrowDownR).toBeGreaterThan(0.7);
  });

  it('clamps hostile frame deltas and never emits NaN', () => {
    const c = new RichInteractionController();
    c.beginGrab('tail', Number.POSITIVE_INFINITY, Number.NaN);
    c.onWindowMotion(motion('drag', 1e9, -1e9));
    const frame = c.tick(Number.POSITIVE_INFINITY);
    for (const value of Object.values(frame.parameters)) expect(Number.isFinite(value)).toBe(true);
    for (const angle of frame.tailAngles) expect(Number.isFinite(angle)).toBe(true);
  });
});
