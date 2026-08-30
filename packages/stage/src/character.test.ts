import { describe, expect, it } from 'vitest';
import { EMOTIONS as P } from '@ds/protocol';
import { parseCharacterConfig, EMOTIONS } from './character';

const good = {
  id: 'haru', name: '小春', model: 'model/Haru.model3.json',
  emotionMap: Object.fromEntries(EMOTIONS.map((e) => [e, e === 'neutral' ? null : 'F01'])),
  motionMap: { nod: ['TapBody', 0] },
  idleGroup: 'Idle',
  tapMotions: { Head: { TapBody: [0, 1] } },
  scale: 1, offsetY: 0,
};

describe('character config', () => {
  it('parses a valid config', () => {
    const c = parseCharacterConfig(good);
    expect(c.id).toBe('haru');
    expect(c.motionMap.nod).toEqual(['TapBody', 0]);
  });
  it('accepts motion refs as emotion targets', () => {
    const c = parseCharacterConfig({ ...good, emotionMap: { ...good.emotionMap, happy: ['TapBody', 0] } });
    expect(c.emotionMap.happy).toEqual(['TapBody', 0]);
  });
  it('rejects a missing emotion key', () => {
    const { neutral: _n, ...partial } = good.emotionMap;
    expect(() => parseCharacterConfig({ ...good, emotionMap: partial })).toThrow();
  });
  it('re-exports the protocol emotion list unchanged', () => {
    expect(EMOTIONS).toBe(P);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HIT_PARTS } from '@ds/protocol';
import { CharacterConfigSchema, normalizeHitArea } from './character';

describe('CharacterConfigSchema — Phase 3 optional blocks (§4.10)', () => {
  it('still parses a Phase 1 config with none of the new fields', () => {
    const c = parseCharacterConfig(good);
    expect(c.hitParts).toBeUndefined();
    expect(c.ticklishRect).toBeUndefined();
    expect(c.hitPartDefault).toBeUndefined();
    expect(c.sim).toBeUndefined();
    expect(c.extraMotions).toBeUndefined();
  });
  it('accepts the §4.10 blocks and constrains values to HIT_PARTS', () => {
    const c = parseCharacterConfig({
      ...good,
      hitParts: { Part01Face001: { part: 'face', participatesInHitTest: true } },
      ticklishRect: { x0: 0.3, y0: 0.55, x1: 0.7, y1: 0.8 },
      hitPartDefault: 'body',
      sim: { moodBase: { valence: 0.1, arousal: 0.35 }, proactive: { maxPerDay: 2 } },
      extraMotions: { Extra: [{ file: 'motions/haru_g_m01.motion3.json', name: 'wave_small', tags: ['arm', 'low'] }] },
    });
    expect(c.hitParts?.Part01Face001.part).toBe('face');
    expect(c.hitPartDefault).toBe('body');
    expect(c.extraMotions?.Extra[0].name).toBe('wave_small');
    expect(() => parseCharacterConfig({ ...good, hitParts: { X: { part: 'tail', participatesInHitTest: true } } })).toThrow();
    expect(() => parseCharacterConfig({ ...good, hitPartDefault: 'tail' })).toThrow();
    expect(() => parseCharacterConfig({ ...good, ticklishRect: { x0: 0.7, y0: 0.55, x1: 0.3, y1: 0.8 } })).toThrow();
    expect(() => parseCharacterConfig({ ...good, sim: { proactive: { maxPerDay: 6 } } })).toThrow();
    expect(() => parseCharacterConfig({ ...good, extraMotions: { Extra: [{ file: 'f', name: 'Bad-Name', tags: [] }] } })).toThrow();
  });
  it('the committed Haru bundle parses with all 20 hitParts, the ticklish rect and the seed extra motion', () => {
    const json = JSON.parse(readFileSync(fileURLToPath(new URL('../../../characters/haru/character.json', import.meta.url)), 'utf8'));
    const c = CharacterConfigSchema.parse(json);
    expect(Object.keys(c.hitParts ?? {})).toHaveLength(20);
    expect(c.ticklishRect).toEqual({ x0: 0.3, y0: 0.55, x1: 0.7, y1: 0.8 });
    expect(c.hitPartDefault).toBe('body');
    expect(c.sim).toEqual({ moodBase: { valence: 0.1, arousal: 0.35 }, proactive: { maxPerDay: 2 } });
    expect(c.extraMotions).toEqual({ Extra: [{ file: 'motions/haru_g_m01.motion3.json', name: 'wave_small', tags: ['arm', 'low', 'loop-safe', 'greet'] }] });
    for (const v of Object.values(c.hitParts ?? {})) expect(HIT_PARTS).toContain(v.part);
    expect(json.cannedLines.remember).toEqual(['嗯，记下了。', '好啦，这件事人家记着。']);
    expect(json.cannedLines.forget).toEqual(['那就当没听过。', '行，忘掉了。']);
    expect(json.cannedLines.mode).toEqual({ toPlain: ['好，接下来正常回答。'], toCharacter: ['嗯，回来了。'] });
  });
});

describe('normalizeHitArea (§6.4, D6)', () => {
  it('normalises Head / HitAreaHead / 头 to head', () => {
    expect(normalizeHitArea('Head')).toBe('head');
    expect(normalizeHitArea('HitAreaHead')).toBe('head');
    expect(normalizeHitArea('头')).toBe('head');
    expect(normalizeHitArea('hit_area_head')).toBe('head');
  });
  it('covers every HIT_PARTS member and returns null for anything else', () => {
    expect(normalizeHitArea('Body')).toBe('body');
    expect(normalizeHitArea('Face')).toBe('face');
    expect(normalizeHitArea('Hair')).toBe('hair');
    expect(normalizeHitArea('ArmL')).toBe('arm');
    expect(normalizeHitArea('Ticklish')).toBe('ticklish');
    expect(normalizeHitArea('Tail')).toBeNull();
    expect(normalizeHitArea('')).toBeNull();
  });
});
