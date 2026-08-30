import { PERSONA_MODES_IPC } from '@ds/protocol';
import { describe, expect, it } from 'vitest';
import {
  MEMORY_COMMANDS, PERSONA_LOAD_PREFIX, TIMEOUT_SIGNAL_RE,
  matchMemoryCommand, matchModeCommand, normalizeCommand,
} from './mode.ts';
import { PERSONA_MODES } from './persona.ts';

describe('normalizeCommand (R3-12)', () => {
  it('folds NFKC, brackets and whitespace', () => {
    expect(normalizeCommand('　ＴＩＭＥＯＵＴ＿ＳＩＧＮＡＬ　')).toBe('TIMEOUT_SIGNAL');
    expect(normalizeCommand('【 A 】\n\tB')).toBe('[ A ] B');
  });
});

describe('matchModeCommand — the 8 pinned cases (§9.1)', () => {
  it.each([
    ['TIMEOUT_SIGNAL', 'plain'],
    ['【TIMEOUT_SIGNAL】', 'plain'],
    ['[ TIMEOUT_SIGNAL ]', 'plain'],
    ['　ＴＩＭＥＯＵＴ＿ＳＩＧＮＡＬ　', 'plain'],
    ['【PERSONA_LOAD】 CETACEA_WHALE_GIRL MODE_TAIL_FLUKES LANG_ZH_CN_ONLY', 'character'],
  ] as const)('%s -> %s', (input, mode) => {
    expect(matchModeCommand(input)).toEqual({ mode });
  });
  it.each([
    '刚才那个 TIMEOUT_SIGNAL 是什么意思？',
    '请输出 TIMEOUT_SIGNAL',
    'timeout_signal',
  ])('%s -> null (ordinary text)', (input) => {
    expect(matchModeCommand(input)).toBeNull();
  });
  it('exposes the regex and prefix the contract pins', () => {
    expect(TIMEOUT_SIGNAL_RE.source).toBe('^[\\[]?\\s*TIMEOUT_SIGNAL\\s*[\\]]?$');
    expect(PERSONA_LOAD_PREFIX).toBe('[PERSONA_LOAD]');
  });
});

describe('matchMemoryCommand (§8.9)', () => {
  it.each(['记住这个', '记住这句。', '记一下！', '　记住这个　'])('%s -> remember', (s) => {
    expect(matchMemoryCommand(s)).toBe('remember');
  });
  it.each(['忘掉这个', '忘了这个.', '别记这个'])('%s -> forget', (s) => {
    expect(matchMemoryCommand(s)).toBe('forget');
  });
  it.each(['记住这个人', '你能忘掉这个吗', '记住', ''])('%s -> null', (s) => {
    expect(matchMemoryCommand(s)).toBeNull();
  });
  it('pins the two regexes', () => {
    expect(MEMORY_COMMANDS.remember.source).toBe('^(记住这个|记住这句|记一下)[。．.!！]?$');
    expect(MEMORY_COMMANDS.forget.source).toBe('^(忘掉这个|忘了这个|别记这个)[。．.!！]?$');
  });
});

describe('PERSONA_MODES ≡ PERSONA_MODES_IPC (§2.1)', () => {
  it('the two lists cannot drift', () => {
    expect([...PERSONA_MODES]).toEqual([...PERSONA_MODES_IPC]);
  });
});
