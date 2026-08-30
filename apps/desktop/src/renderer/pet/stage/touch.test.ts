import { describe, expect, it } from 'vitest';
import { HIT_PARTS, type Payload } from '@ds/protocol';
import {
  ANNOYED_REACTION, ANNOY_COOLDOWN_MS, BURST_RING_SLOTS, BurstDetector, TAP_BURST_COUNT, TAP_BURST_WINDOW_MS,
  TAP_SLOP_DIP, TOUCH_REACTIONS, TouchReactor, touchReaction,
} from './touch';
import * as metrics from '../../shared/lane-metrics';
import type { TouchReaction } from './arbiter';

describe('touch constants are re-exports of lane-metrics (§5.13)', () => {
  it('re-declares nothing', () => {
    expect(TAP_BURST_COUNT).toBe(metrics.TAP_BURST_COUNT);
    expect(TAP_BURST_WINDOW_MS).toBe(metrics.TAP_BURST_WINDOW_MS);
    expect(ANNOY_COOLDOWN_MS).toBe(metrics.ANNOY_COOLDOWN_MS);
    expect(TAP_SLOP_DIP).toBe(metrics.TAP_SLOP_DIP);
    expect([TAP_BURST_COUNT, TAP_BURST_WINDOW_MS, ANNOY_COOLDOWN_MS, TAP_SLOP_DIP]).toEqual([7, 1000, 4000, 4]);
    expect(BURST_RING_SLOTS).toBe(8);
  });
});

describe('BurstDetector — 8-slot ring buffer (§5.11)', () => {
  it('triggers on the 7th tap inside 1 s and not on 7 taps spread over more', () => {
    const d = new BurstDetector();
    for (let i = 0; i < 6; i++) expect(d.push(i * 100)).toEqual({ burst: i + 1, triggered: false });
    expect(d.push(600)).toEqual({ burst: 7, triggered: true });
    const e = new BurstDetector();
    for (let i = 0; i < 6; i++) e.push(i * 200);
    expect(e.push(1200)).toEqual({ burst: 5, triggered: false });   // 1200-1000=200 exclusive window
  });

  it('wraps the ring: the 9th tap is judged against the 3rd', () => {
    const d = new BurstDetector();
    for (let i = 0; i < 8; i++) d.push(i * 300);
    expect(d.push(2400)).toEqual({ burst: 4, triggered: false });
    expect(d.push(2401)).toEqual({ burst: 5, triggered: false });
  });
});

describe('per-part reaction table (§5.11)', () => {
  it('covers every HIT_PART with the bound §4.9 resources, scaled by touchVariantIntensity', () => {
    expect(Object.keys(TOUCH_REACTIONS).sort()).toEqual([...HIT_PARTS].sort());
    expect(touchReaction('head', 0.65)).toEqual({ motion: ['TapBody', 0], expression: { name: 'F02', weight: 0.55 * 0.65 }, gaze: 'cursorLock', overlay: 'headTilt' });
    expect(touchReaction('face', 1)).toEqual({ motion: ['TapBody', 1], expression: { name: 'F07', weight: 0.60 }, gaze: 'down', overlay: 'blush' });
    expect(touchReaction('hair', 1)).toEqual({ motion: ['TapBody', 3], expression: { name: 'F01', weight: 0.45 }, gaze: 'cursorLock', overlay: 'headTiltHold' });
    expect(touchReaction('body', 1)).toEqual({ motion: ['TapBody', 2], expression: { name: 'F01', weight: 0.40 }, gaze: 'follow', overlay: 'none' });
    expect(touchReaction('arm', 1)).toEqual({ motion: ['TapBody', 3], expression: { name: 'F06', weight: 0.40 }, gaze: 'cursorLock', overlay: 'leanRight' });
    expect(touchReaction('ticklish', 1)).toEqual({ motion: ['TapBody', 0], expression: { name: 'F02', weight: 0.65 }, gaze: 'away', overlay: 'leanLeft' });
    expect(ANNOYED_REACTION).toEqual({ motion: ['TapBody', 1], expression: { name: 'F03', weight: 0.70 }, gaze: 'away', overlay: 'headTilt' });
  });
});

function harness(intensity = 0.65) {
  const reactions: TouchReaction[] = [];
  const sent: Payload<'arb:touch'>[] = [];
  const legacy: string[] = [];
  const sfx: string[] = [];
  const reactor = new TouchReactor({
    arbiter: { touch: (r) => { reactions.push(r); } },
    send: (p) => { sent.push(p); },
    legacyTap: (pressId) => { legacy.push(`avatar:tap#${pressId}`); },
    sfx: { play: (name) => { sfx.push(name); } },
    intensity: () => intensity,
  });
  return { reactor, reactions, sent, legacy, sfx };
}

describe('TouchReactor (§5.11, §2.9, §5.12)', () => {
  it('answers every accepted tap at L = 0 with the scaled variant; never skips one (R3-13)', () => {
    const h = harness(0.5);
    for (let i = 0; i < 5; i++) h.reactor.tap(i, 'head', 200, i * 2000);
    expect(h.reactions).toHaveLength(5);
    expect(h.reactions[0].expression.weight).toBeCloseTo(0.55 * 0.5, 6);
    expect(h.sent.map((s) => s.burst)).toEqual([1, 1, 1, 1, 1]);
    expect(h.sfx).toEqual(['tap', 'tap', 'tap', 'tap', 'tap']);
  });

  it('sends avatar:tap before arb:touch for one gesture and carries the GPU alpha', () => {
    const order: string[] = [];
    const reactor = new TouchReactor({
      arbiter: { touch: () => {} },
      send: (p) => { order.push(`arb:touch:${p.alpha}`); },
      legacyTap: () => { order.push('avatar:tap'); },
      sfx: null,
      intensity: () => 1,
    });
    reactor.tap(3, 'body', 137, 0);
    expect(order).toEqual(['avatar:tap', 'arb:touch:137']);
  });

  it('seven taps in one second: the 7th plays the UNSCALED annoyed reaction, arms the cooldown, sends annoyed:true', () => {
    const h = harness(0.5);
    for (let i = 0; i < 7; i++) h.reactor.tap(i, 'ticklish', 255, i * 120);
    expect(h.reactions).toHaveLength(7);
    expect(h.reactions[6]).toEqual(ANNOYED_REACTION);
    expect(h.sent[6]).toEqual({ pressId: 6, part: 'ticklish', alpha: 255, burst: 7, annoyed: true });
    expect(h.sfx.at(-1)).toBe('annoyed');
    // Inside the cooldown: arb:touch still goes out, no reaction, no sfx.
    h.reactor.tap(7, 'head', 255, 720 + 1000);
    expect(h.reactions).toHaveLength(7);
    expect(h.sent).toHaveLength(8);
    expect(h.sent[7]).toMatchObject({ pressId: 7, part: 'head', annoyed: false });
    expect(h.sfx).toHaveLength(7);
    // After ANNOY_COOLDOWN_MS from the trigger the normal reactions resume.
    h.reactor.tap(8, 'head', 255, 720 + ANNOY_COOLDOWN_MS);
    expect(h.reactions).toHaveLength(8);
    expect(h.reactions[7].gaze).toBe('cursorLock');
  });
});
