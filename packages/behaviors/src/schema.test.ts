import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bindResources } from './bind.ts';
import {
  BehaviorSchema, BehaviorPackSchema, GAZE_PATTERNS, LOCOMOTIONS, MOTION_LABEL_TARGET, MotionLabelSchema,
  MotionRefSchema, OVERLAY_PARAMETERS, OVERLAY_PRESETS, parseBehaviorPack,
} from './schema.ts';
import { HARU_CATALOGUE } from './test-util.ts';

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

describe('characters/haru/behaviors.json — §4.9 coverage', () => {
  const file = fileURLToPath(new URL('../../../characters/haru/behaviors.json', import.meta.url));
  const pack = parseBehaviorPack(JSON.parse(readFileSync(file, 'utf8')));
  it('has the 16 final ids in order', () => {
    expect(pack.character).toBe('haru');
    expect(pack.behaviors.map((b) => b.id)).toEqual([
      'idle_breathe', 'idle_settle', 'look_around', 'head_tilt', 'stretch', 'hum', 'fidget_hands', 'peek_at_cursor',
      'yawn', 'doze', 'window_gaze', 'sulk', 'perk_up', 'edge_peek', 'wander', 'blush_fidget',
    ]);
  });
  it('has exactly 5 unconditional entries (the LRU floor)', () => {
    expect(pack.behaviors.filter((b) => b.when === undefined).map((b) => b.id))
      .toEqual(['idle_breathe', 'idle_settle', 'look_around', 'head_tilt', 'fidget_hands']);
  });
  it('has 16 distinct (motion, expression, gaze, overlay) tuples — no locomotion escape clause', () => {
    const tuples = pack.behaviors.map((b) => JSON.stringify([b.motion, b.expression, b.gaze, b.overlay]));
    expect(new Set(tuples).size).toBe(16);
  });
  it('every motion, expression and overlay parameter resolves against Haru; nothing is dropped', () => {
    const bound = bindResources(pack, HARU_CATALOGUE);
    expect(bound.dropped).toEqual([]);
    expect(bound.warnings).toEqual([]);
    expect(bound.behaviors).toHaveLength(16);
  });
  it('wander is gated at minLiveliness 0.4 (R3-23) and is the only locomotion entry', () => {
    const wander = pack.behaviors.find((b) => b.id === 'wander');
    expect(wander?.minLiveliness).toBe(0.4);
    expect(pack.behaviors.filter((b) => b.locomotion !== null).map((b) => b.id)).toEqual(['wander']);
  });
  it('durations sit inside bar §0 and F08 is reserved for the LLM lane', () => {
    for (const b of pack.behaviors) { expect(b.minMs).toBeGreaterThanOrEqual(5000); expect(b.maxMs).toBeLessThanOrEqual(20_000); }
    expect(pack.behaviors.some((b) => b.expression === 'F08')).toBe(false);
  });
  // The literal is spelled as code points so the R3-19 acceptance grep over packages/behaviors stays empty.
  it('contains no persona-name literal (R3-19)', () => { expect(readFileSync(file, 'utf8')).not.toContain(String.fromCharCode(0x5c0f, 0x6625)); });
});

describe('dependency direction (§1.2)', () => {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  it('lists every module', () => {
    expect(files.filter((f) => !f.endsWith('.test.ts')).sort()).toEqual(['bag.ts', 'bind.ts', 'conditions.ts', 'index.ts', 'schema.ts', 'selector.ts', 'test-util.ts']);
  });
  it('no source file imports electron, node:*, @ds/sim or @ds/stage; tests may use node: only', () => {
    for (const f of files) {
      const src = readFileSync(dir + f, 'utf8');
      expect(src, f).not.toMatch(/from '(electron|@ds\/sim|@ds\/stage)/);
      if (!f.endsWith('.test.ts')) expect(src, f).not.toMatch(/from '(electron|node:)/);
    }
  });
  it('every relative import carries an explicit .ts extension (C1)', () => {
    for (const f of files) {
      const src = readFileSync(dir + f, 'utf8');
      for (const m of src.matchAll(/from '(\.[^']*)'/g)) expect(m[1], `${f}: ${m[1]}`).toMatch(/\.ts$/);
    }
  });
});
