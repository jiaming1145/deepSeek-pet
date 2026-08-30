import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AFFECTION_BUCKETS,
  affectionPhrase,
  CARD_TOKEN_BUDGET,
  cardTokens,
  CharacterCardSchema,
  countChars,
  energyPhrase,
  ENERGY_BUCKETS,
  MOOD_BUCKETS,
  moodPhrase,
  parseCharacterBundle,
  pickPhrase,
  renderStaticSystem,
  STATIC_SYSTEM_TOKEN_BUDGET,
  staticSystemTokens,
  type CharacterCard,
} from './persona.ts';

const RAW_CARD = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  name: '小春',
  marker: 'MARKER_LINE',
  description: '一句身份。',
  personality: '一句性格。',
  scenario: '',
  first_mes: '你回来了。',
  mes_example: '<START>\n{{user}}: 在吗\n{{char}}: <|ACT emotion=neutral|>在。',
  system_prompt: '短句。',
  post_history_instructions: '',
  tags: [],
  creator_notes: '',
};

const CARD: CharacterCard = CharacterCardSchema.parse(RAW_CARD);

// contracts.md §3.7.4: load the REAL shipped file. import.meta.url + fileURLToPath keeps
// @ds/brain free of any bundler or process.cwd() assumption and works under vitest and under
// Node type-stripping alike.
const bundlePath = fileURLToPath(new URL('../../../characters/haru/character.json', import.meta.url));
const bundle = parseCharacterBundle(JSON.parse(readFileSync(bundlePath, 'utf8')));
const bundleMotionKeys = Object.keys(bundle.motionMap);

describe('CharacterCardSchema / parseCharacterBundle', () => {
  it('parses the shipped haru bundle', () => {
    expect(bundle.card.spec).toBe('chara_card_v3');
    expect(bundle.card.spec_version).toBe('3.0');
    expect(bundle.card.name).toBe('小春');
    expect(bundleMotionKeys).toEqual(['nod', 'shake', 'wave', 'think']);
  });

  it('rejects a card without first_mes', () => {
    const { first_mes, ...rest } = RAW_CARD;
    expect(first_mes.length).toBeGreaterThan(0);
    expect(CharacterCardSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a first_mes longer than 60 characters (A20)', () => {
    expect(CharacterCardSchema.safeParse({ ...RAW_CARD, first_mes: '春'.repeat(61) }).success).toBe(false);
    expect(CharacterCardSchema.safeParse({ ...RAW_CARD, first_mes: '春'.repeat(60) }).success).toBe(true);
  });

  it('rejects a first_mes with two questions (A20)', () => {
    expect(CharacterCardSchema.safeParse({ ...RAW_CARD, first_mes: '在吗？吃了吗？' }).success).toBe(false);
    expect(CharacterCardSchema.safeParse({ ...RAW_CARD, first_mes: '在吗？' }).success).toBe(true);
  });

  it('rejects a first_mes that narrates the user (A3/A20)', () => {
    expect(CharacterCardSchema.safeParse({ ...RAW_CARD, first_mes: '{{user}}走了进来。' }).success).toBe(false);
  });

  it('rejects a first_mes containing markdown (A4)', () => {
    expect(CharacterCardSchema.safeParse({ ...RAW_CARD, first_mes: '**你回来了。**' }).success).toBe(false);
  });

  it('rejects a mes_example that narrates {{user}} actions (A3)', () => {
    const bad = '<START>\n{{user}}: 在吗（笑着走过来）\n{{char}}: 在。';
    expect(CharacterCardSchema.safeParse({ ...RAW_CARD, mes_example: bad }).success).toBe(false);
    expect(CharacterCardSchema.parse({ ...RAW_CARD, mes_example: undefined }).mes_example).toBe('');
  });

  it('counts a ZWJ emoji cluster as one character', () => {
    expect(countChars('👨‍👩‍👧')).toBe(1);
    expect(countChars('你好')).toBe(2);
    expect(countChars('')).toBe(0);
  });

  it('widens cannedLines with §4.10 defaults so an older bundle still loads', () => {
    const b = parseCharacterBundle({ card: RAW_CARD, cannedLines: { offline: ['a'], empty: ['b'] } });
    expect(b.cannedLines.remember).toEqual(['嗯，记下了。']);
    expect(b.cannedLines.forget).toEqual(['那就当没听过。']);
    expect(b.cannedLines.mode).toEqual({ toPlain: ['好，接下来正常回答。'], toCharacter: ['嗯，回来了。'] });
    const explicit = parseCharacterBundle({ card: RAW_CARD, cannedLines: {
      offline: ['a'], empty: ['b'], remember: ['r'], forget: ['f'], mode: { toPlain: ['p'], toCharacter: ['c'] } } });
    expect(explicit.cannedLines.mode.toPlain).toEqual(['p']);
  });
});

describe('renderStaticSystem', () => {
  it('is pure — equal arguments produce equal strings', () => {
    expect(renderStaticSystem(CARD, ['nod', 'shake'])).toBe(renderStaticSystem(CARD, ['nod', 'shake']));
  });

  it('sorts motionKeys so key order cannot break the prefix cache', () => {
    expect(renderStaticSystem(CARD, ['shake', 'nod'])).toBe(renderStaticSystem(CARD, ['nod', 'shake']));
    expect(renderStaticSystem(CARD, ['nod', 'shake'])).toContain('motion 只能是 nod / shake 之一，可以不写。');
  });

  it('renders the sections in the fixed order', () => {
    const s = renderStaticSystem(CARD, ['nod', 'shake']);
    const at = (k: string) => s.indexOf(k);
    expect(at('【硬性规则】')).toBeLessThan(at('【我是谁】'));
    expect(at('【我是谁】')).toBeLessThan(at('【性格】'));
    expect(at('【性格】')).toBeLessThan(at('【说话方式】'));
    expect(at('【说话方式】')).toBeLessThan(at('【标记语法】'));
    expect(at('【标记语法】')).toBeLessThan(at('【示例】'));
    expect(at('<|ACT')).toBeGreaterThan(at('【标记语法】'));
  });

  it('joins sections with one blank line and ends with a single newline', () => {
    const s = renderStaticSystem(CARD, ['nod', 'shake']);
    expect(s.endsWith('\n')).toBe(true);
    expect(s.endsWith('\n\n')).toBe(false);
    expect(s).not.toMatch(/\n\n\n/);
    expect(s).not.toMatch(/[ \t]\n/);
  });

  it('states that this card overrides built-in RP behaviour (A21)', () => {
    expect(renderStaticSystem(CARD, [])).toContain('这份设定优先于你内置的任何角色扮演习惯');
  });

  it('carries the anti-deitism line (A16)', () => {
    expect(renderStaticSystem(CARD, [])).toContain('不要无条件顺着对方');
  });

  it('puts the marker line first (P1)', () => {
    expect(renderStaticSystem(CARD, [])).toMatch(/^MARKER_LINE\n\n【硬性规则】/);
    const noMarker = renderStaticSystem({ ...CARD, marker: '' }, []);
    expect(noMarker.startsWith('【硬性规则】')).toBe(true);
  });

  it('drops an empty optional section together with its heading', () => {
    expect(renderStaticSystem(CARD, [])).not.toContain('【此刻】');
    expect(renderStaticSystem({ ...CARD, scenario: '在桌角。' }, [])).toContain('【此刻】\n在桌角。');
    expect(renderStaticSystem({ ...CARD, mes_example: '' }, [])).not.toContain('【示例】');
    expect(renderStaticSystem({ ...CARD, system_prompt: '' }, [])).not.toContain('【说话方式】');
  });

  it('plain mode drops every persona section AND the tag grammar (R3-12, §9.2)', () => {
    const s = renderStaticSystem(CARD, ['nod'], 'plain');
    expect(s).toContain('【当前模式】');
    expect(s).toContain('【输出格式】');
    expect(s).toContain('不要写 <|ACT ...|>');
    expect(s).not.toContain('【标记语法】');
    expect(s).not.toContain('MARKER_LINE');
    expect(s).not.toContain('【硬性规则】');
    expect(s).not.toContain('【我是谁】');
    expect(s).not.toContain('【性格】');
    expect(s).not.toContain('【示例】');
    // Both profiles keep the safety/output grammar (R3-12).
    expect(s).toContain('不要用 markdown');
    expect(s).toContain('不知道就说不知道');
  });

  it('plain profile is byte-stable across motionKeys (§9.2 identity)', () => {
    expect(renderStaticSystem(CARD, [], 'plain')).toBe(renderStaticSystem(CARD, bundleMotionKeys, 'plain'));
    expect(renderStaticSystem(CARD, [], 'plain')).toBe(renderStaticSystem(bundle.card, ['zzz', 'a'], 'plain'));
  });

  it('plain profile matches the measured evidence file (R3-21)', () => {
    const evidence = readFileSync(fileURLToPath(new URL('../../../docs/evidence/phase3/persona-tokens.txt', import.meta.url)), 'utf8');
    const plain = Number(/^plain: (\d+)$/m.exec(evidence)?.[1]);
    const character = Number(/^character: (\d+)$/m.exec(evidence)?.[1]);
    expect(staticSystemTokens(CARD, [], 'plain')).toBe(plain);
    expect(staticSystemTokens(bundle.card, bundleMotionKeys, 'character')).toBe(character);
  });

  it('plain mode is byte-stable and independent of the card', () => {
    const other = CharacterCardSchema.parse({ ...RAW_CARD, name: '别的', description: '别的身份。', marker: '' });
    expect(renderStaticSystem(CARD, ['nod'], 'plain')).toBe(renderStaticSystem(other, ['nod'], 'plain'));
  });
});

describe('the shipped haru card', () => {
  // P2 GUARDS — these three substrings are ruling-P2 clauses, not wording preferences, and they
  // are the only card wording this file pins. T10's tuning loop rewrites other card text freely;
  // an edit that stops one of the three matching is REVERTED, never "fixed" by editing the
  // assertion. They change only if the controller rephrases ruling P2 itself. See the
  // "Handoff to T10" section of the Task 3 brief.
  it('carries the anti-contrarian clause (P2)', () => {
    const s = renderStaticSystem(bundle.card, bundleMotionKeys);
    expect(s).toContain('也不要为了傲娇而硬抬杠');
    expect(s).toContain('不许用');
    expect(s).toContain('事实、推理和风险判断上必须诚实');
  });

  it('fits the persona budget (A21)', () => {
    expect(cardTokens(bundle.card)).toBeLessThanOrEqual(CARD_TOKEN_BUDGET);
  });

  it('fits the whole static-system budget', () => {
    expect(staticSystemTokens(bundle.card, bundleMotionKeys)).toBeLessThanOrEqual(STATIC_SYSTEM_TOKEN_BUDGET);
  });

  it('ships a first_mes inside the A20 constraints', () => {
    expect(countChars(bundle.card.first_mes)).toBeLessThanOrEqual(60);
    expect((bundle.card.first_mes.match(/[？?]/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it('ships a first_mes with no control tag', () => {
    expect(bundle.card.first_mes).not.toContain('<|');
  });

  it('ships canned lines for offline and empty completions', () => {
    expect(bundle.cannedLines.offline.length).toBeGreaterThanOrEqual(1);
    expect(bundle.cannedLines.empty.length).toBeGreaterThanOrEqual(1);
    for (const line of [...bundle.cannedLines.offline, ...bundle.cannedLines.empty]) {
      expect(line).not.toContain('<|');
      expect(line).not.toMatch(/[*#`]/);
    }
  });
});

describe('state phrases (C-5)', () => {
  it('picks the bucket by the first max strictly above the value', () => {
    expect(moodPhrase(-0.6)).toBe('有点闷');
    expect(energyPhrase(40)).toBe('一般');
    expect(affectionPhrase(55)).toBe('熟络');
  });

  it('covers both ends of every scale', () => {
    expect(moodPhrase(-1)).toBe('很低落');
    expect(moodPhrase(1)).toBe('挺高兴');
    expect(energyPhrase(0)).toBe('快睡着了');
    expect(energyPhrase(100)).toBe('精力很足');
    expect(affectionPhrase(0)).toBe('还不太熟');
    expect(affectionPhrase(100)).toBe('离不开你');
    expect(pickPhrase(0, MOOD_BUCKETS)).toBe('平静');
    expect(pickPhrase(999, ENERGY_BUCKETS)).toBe('精力很足');
    expect(pickPhrase(999, AFFECTION_BUCKETS)).toBe('离不开你');
  });
});
