import { describe, expect, it } from 'vitest';
import { LandingSchema } from '@ds/protocol';
import * as M from './lane-metrics';

describe('lane-metrics — the one home (§5.13)', () => {
  it('§5.5 motion timing', () => {
    expect([M.MOTION_FADE_TOUCH_S, M.MOTION_FADE_LLM_S, M.MOTION_FADE_IDLE_S]).toEqual([0.12, 0.25, 1.0]);
    expect([M.MOTION_MIN_PLAY_MS, M.MOTION_GROUP_COOLDOWN_MS, M.TOUCH_PREEMPT_MAX_MS, M.TOUCH_EXPR_MS]).toEqual([800, 1_500, 250, 1_400]);
  });
  it('§5.11 touch', () => {
    expect([M.TAP_BURST_COUNT, M.TAP_BURST_WINDOW_MS, M.ANNOY_COOLDOWN_MS, M.TAP_SLOP_DIP]).toEqual([7, 1_000, 4_000, 4]);
  });
  it('§7.4 drag spring/damper', () => {
    expect([M.DRAG_STIFFNESS, M.DRAG_DAMPING_RATIO, M.DRAG_MASS, M.DRAG_MAX_LAG_DIP]).toEqual([180, 0.85, 1, 24]);
    expect(M.DRAG_DAMPING).toBeCloseTo(22.808, 3);
  });
  it('§7.5 fling / gravity / bounce / landing', () => {
    expect([M.FLING_SAMPLES, M.FLING_EMA_ALPHA, M.FLING_VELOCITY_CAP, M.GRAVITY_DIP_S2]).toEqual([4, 0.5, 2400, 1800]);
    expect([M.BOUNCE_RESTITUTION, M.BOUNCE_DECAY, M.REST_SPEED_DIP_S]).toEqual([0.35, 0.8, 40]);
    expect([M.AIR_DRAG_X, M.AIR_DRAG_Y, M.LANDING_MIN_IMPULSE]).toEqual([1.28, 0.35, 120]);
  });
  it('§7.6 walkTo', () => {
    expect([M.WALK_SPEED_DIP_S, M.WALK_MIN_DISTANCE_DIP, M.WALK_MAX_MS, M.WALK_COOLDOWN_MS]).toEqual([120, 48, 12_000, 5_000]);
  });
  it('FLING_VELOCITY_CAP === 2400 and is exactly LandingSchema.impulse max (§2.4)', () => {
    expect(M.FLING_VELOCITY_CAP).toBe(2400);
    const ok = { generation: 0, tsMain: 0, impulse: M.FLING_VELOCITY_CAP, edge: 'floor' as const };
    expect(LandingSchema.parse(ok).impulse).toBe(2400);
    expect(LandingSchema.safeParse({ ...ok, impulse: M.FLING_VELOCITY_CAP + 1 }).success).toBe(false);
  });
  it('exports exactly the 30 named constants (nothing else lives here)', () => {
    expect(Object.keys(M).sort()).toEqual([
      'AIR_DRAG_X', 'AIR_DRAG_Y', 'ANNOY_COOLDOWN_MS', 'BOUNCE_DECAY', 'BOUNCE_RESTITUTION',
      'DRAG_DAMPING', 'DRAG_DAMPING_RATIO', 'DRAG_MASS', 'DRAG_MAX_LAG_DIP', 'DRAG_STIFFNESS',
      'FLING_EMA_ALPHA', 'FLING_SAMPLES', 'FLING_VELOCITY_CAP', 'GRAVITY_DIP_S2', 'LANDING_MIN_IMPULSE',
      'MOTION_FADE_IDLE_S', 'MOTION_FADE_LLM_S', 'MOTION_FADE_TOUCH_S', 'MOTION_GROUP_COOLDOWN_MS', 'MOTION_MIN_PLAY_MS',
      'REST_SPEED_DIP_S', 'TAP_BURST_COUNT', 'TAP_BURST_WINDOW_MS', 'TAP_SLOP_DIP', 'TOUCH_EXPR_MS', 'TOUCH_PREEMPT_MAX_MS',
      'WALK_COOLDOWN_MS', 'WALK_MAX_MS', 'WALK_MIN_DISTANCE_DIP', 'WALK_SPEED_DIP_S',
    ].sort());
  });
});
