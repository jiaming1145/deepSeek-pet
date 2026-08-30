import { describe, expect, it } from 'vitest';
import {
  BehaviorSchema, BehaviorPackSchema, GAZE_PATTERNS, LOCOMOTIONS, MOTION_LABEL_TARGET, MotionLabelSchema,
  MotionRefSchema, OVERLAY_PARAMETERS, OVERLAY_PRESETS, parseBehaviorPack,
} from './schema.ts';

const minimal = { id: 'idle_breathe', weight: 1, minMs: 8000, maxMs: 16000 };
const twelve = (): unknown[] => Array.from({ length: 12 }, (_, i) => ({ ...minimal, id: `b_${i}` }));

describe('closed vocabularies (§4.1)', () => {
  it('pins the presets, gaze patterns and locomotions', () => {
    expect([...OVERLAY_PRESETS]).toEqual(['none', 'headTilt', 'headTiltHold', 'headDroop', 'leanLeft', 'leanRight', 'lookUp', 'blush']);
    expect([...GAZE_PATTERNS]).toEqual(['follow', 'wander', 'cursorLock', 'away', 'down', 'up', 'edge', 'none']);
    expect([...LOCOMOTIONS]).toEqual(['stroll', 'hop']);
    expect(Object.keys(OVERLAY_PARAMETERS)).toEqual([...OVERLAY_PRESETS]);
    expect(OVERLAY_PARAMETERS.none).toEqual([]);
    expect(OVERLAY_PARAMETERS.headDroop).toEqual(['ParamAngleY', 'ParamBodyAngleZ']);
    expect(OVERLAY_PARAMETERS.blush).toEqual(['ParamTere']);
  });
  it('MotionRefSchema is [group, non-negative int]', () => {
    expect(MotionRefSchema.safeParse(['Idle', 0]).success).toBe(true);
    expect(MotionRefSchema.safeParse(['Idle', -1]).success).toBe(false);
    expect(MotionRefSchema.safeParse(['', 0]).success).toBe(false);
    expect(MotionRefSchema.safeParse(['Idle', 1.5]).success).toBe(false);
  });
});

describe('BehaviorSchema', () => {
  it('applies the §4.1 defaults', () => {
    expect(BehaviorSchema.parse(minimal)).toEqual({
      ...minimal, cooldownMs: 0, minLiveliness: 0, motion: null, expression: null, expressionWeight: 0.55,
      gaze: 'follow', overlay: 'none', locomotion: null, tags: [],
    });
  });
  it('enforces every range', () => {
    const bad: Record<string, unknown>[] = [
      { id: 'A' }, { id: 'x' }, { id: 'a'.repeat(49) }, { id: 'has-dash' },
      { weight: 0.05 }, { weight: 5.1 },
      { minMs: 4999 }, { maxMs: 20001 }, { minMs: 9000, maxMs: 8000 }, { minMs: 5000.5 },
      { cooldownMs: 600_001 }, { cooldownMs: -1 },
      { minLiveliness: 1.1 }, { expressionWeight: 1.01 },
      { gaze: 'stare' }, { overlay: 'wink' }, { locomotion: 'fly' }, { tags: ['loud'] },
      { expression: '' }, { when: { fact: 'nope', eq: 1 } },
    ];
    for (const patch of bad) expect(BehaviorSchema.safeParse({ ...minimal, ...patch }).success, JSON.stringify(patch)).toBe(false);
    expect(BehaviorSchema.safeParse({ ...minimal, minMs: 20000, maxMs: 20000, cooldownMs: 600_000, weight: 5 }).success).toBe(true);
  });
});

describe('BehaviorPackSchema / parseBehaviorPack', () => {
  it('needs version 1, a kebab id and >= 12 unique behaviours', () => {
    expect(parseBehaviorPack({ version: 1, character: 'haru', behaviors: twelve() }).behaviors).toHaveLength(12);
    expect(BehaviorPackSchema.safeParse({ version: 2, character: 'haru', behaviors: twelve() }).success).toBe(false);
    expect(BehaviorPackSchema.safeParse({ version: 1, character: 'Haru', behaviors: twelve() }).success).toBe(false);
    expect(BehaviorPackSchema.safeParse({ version: 1, character: 'haru', behaviors: twelve().slice(0, 11) }).success).toBe(false);
    const dup = twelve(); (dup[11] as { id: string }).id = 'b_0';
    const r = BehaviorPackSchema.safeParse({ version: 1, character: 'haru', behaviors: dup });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('behaviour ids must be unique');
  });
  it('throws a zod error with the offending path', () => {
    const bad = twelve(); (bad[3] as { maxMs: number }).maxMs = 99;
    expect(() => parseBehaviorPack({ version: 1, character: 'haru', behaviors: bad })).toThrow(/behaviors.*3.*maxMs|maxMs/);
  });
});

describe('MotionLabelSchema (§4.11.3)', () => {
  it('target is 10 and the shape accepts registered and rejected rows', () => {
    expect(MOTION_LABEL_TARGET).toBe(10);
    expect(MotionLabelSchema.safeParse({ file: 'motions/haru_g_m01.motion3.json', registered: true, name: 'wave_small',
      poseFamily: 'gesture', energy: 'low', loopSafe: true, bodyParts: ['arm'] }).success).toBe(true);
    expect(MotionLabelSchema.safeParse({ file: 'motions/haru_g_m02.motion3.json', registered: false, reason: 'near-duplicate of Idle[0]' }).success).toBe(true);
    expect(MotionLabelSchema.safeParse({ file: 'x', registered: true, name: 'Wave' }).success).toBe(false);
    expect(MotionLabelSchema.safeParse({ file: 'x', registered: false, reason: 'r'.repeat(201) }).success).toBe(false);
  });
});
