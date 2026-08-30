import { parseCharacterBundle } from '@ds/brain';
import { describe, expect, it } from 'vitest';
import { personaName } from './persona-name';

describe('personaName (R3-19, §1.7)', () => {
  it('reads card.name and nothing else', () => {
    const bundle = parseCharacterBundle({
      card: { spec: 'chara_card_v3', spec_version: '3.0', name: '测试名', description: 'd', personality: 'p', first_mes: '你好。' },
      cannedLines: { offline: ['a'], empty: ['b'] },
    });
    expect(personaName(bundle)).toBe('测试名');
  });
});
