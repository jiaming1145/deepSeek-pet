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
