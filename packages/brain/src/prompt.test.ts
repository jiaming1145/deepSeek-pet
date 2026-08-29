import * as brain from './index.ts';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './types.ts';
import {
  assemblePrompt,
  estimateTokens,
  LINT_NUDGE,
  MAX_FACTS,
  planTrim,
  type AssembleInput,
  type StatePreamble,
} from './prompt.ts';

const STATE: StatePreamble = {
  localTime: '21:14',
  weekday: '周三',
  mood: 0.3,
  energy: 45,
  affection: 60,
  sinceLastChat: '3小时',
};

const HISTORY: ChatMessage[] = [
  { role: 'user', content: '今天面试完了' },
  { role: 'assistant', content: '怎么样，还顺利吗？' },
];

const base = (patch: Partial<AssembleInput> = {}): AssembleInput => ({
  staticSystem: 'SYS',
  postHistoryInstructions: '保持说话方式。',
  summary: '主人昨天面试完了。',
  facts: [],
  history: HISTORY,
  state: STATE,
  userText: '在吗',
  ...patch,
});

const last = (msgs: ChatMessage[]): ChatMessage => msgs[msgs.length - 1];

describe('module graph', () => {
  it('resolves the deliberate persona.ts <-> prompt.ts cycle through the barrel', () => {
    expect(brain.estimateTokens('你好世界')).toBe(3);
    expect(brain.moodPhrase(0.3)).toBe('平静偏好');
    expect(brain.cardTokens).toBeTypeOf('function');
    expect(brain.assemblePrompt(base())).toHaveLength(4);
  });
});

describe('estimateTokens (R10.8)', () => {
  it('counts CJK at 1.5 characters per token', () => {
    expect(estimateTokens('你好世界')).toBe(3);
  });

  it('counts latin words at 1.3 tokens each', () => {
    expect(estimateTokens('hello world')).toBe(3);
  });

  it('returns 0 for the empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('assemblePrompt (C-2)', () => {
  it('puts the static system first and the user text last', () => {
    const msgs = assemblePrompt(base());
    expect(msgs[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(msgs).toHaveLength(4);
    expect(last(msgs).role).toBe('user');
    expect(last(msgs).content.endsWith('在吗')).toBe(true);
    expect(last(msgs).content.split('\n')[0]).toBe(
      '【状态】本地时间 周三 21:14｜心情 平静偏好｜精力 一般｜好感 熟络｜距离上次聊天 3小时',
    );
  });

  it('keeps messages[0..n] byte-identical when only state and userText change (X1)', () => {
    const a = assemblePrompt(base());
    const b = assemblePrompt(
      base({
        state: { localTime: '02:00', weekday: '周日', mood: -0.9, energy: 10, affection: 5, sinceLastChat: '刚刚' },
        userText: '睡了',
      }),
    );
    expect(JSON.stringify(a.slice(0, -1))).toBe(JSON.stringify(b.slice(0, -1)));
  });

  it('mentions 本地时间 exactly once', () => {
    const msgs = assemblePrompt(base());
    expect(JSON.stringify(msgs).match(/本地时间/g) ?? []).toHaveLength(1);
    expect(last(msgs).content).toContain('本地时间');
  });

  it('never writes a raw stat number (C-5)', () => {
    const msgs = assemblePrompt(base());
    expect(JSON.stringify(msgs)).not.toMatch(/好感\s*\d/);
    expect(JSON.stringify(msgs)).not.toMatch(/精力\s*\d/);
    expect(JSON.stringify(msgs)).not.toMatch(/心情\s*-?\d/);
  });

  it('omits 【最近发生过什么】 when the summary is empty', () => {
    expect(last(assemblePrompt(base())).content).toContain('【最近发生过什么】主人昨天面试完了。');
    expect(last(assemblePrompt(base({ summary: '' }))).content).not.toContain('【最近发生过什么】');
  });

  it('omits 【你记得】 when there are no facts', () => {
    expect(last(assemblePrompt(base())).content).not.toContain('【你记得】');
    expect(last(assemblePrompt(base({ facts: ['他养了一只猫'] }))).content).toContain('【你记得】他养了一只猫');
  });

  it('truncates facts to MAX_FACTS', () => {
    const facts = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'];
    const content = last(assemblePrompt(base({ facts }))).content;
    expect(content).toContain('【你记得】f1；f2；f3；f4；f5');
    expect(content).not.toContain('f6');
    expect(MAX_FACTS).toBe(5);
  });

  it('omits 【记住】 when postHistoryInstructions is empty', () => {
    expect(last(assemblePrompt(base())).content).toContain('【记住】保持说话方式。');
    expect(last(assemblePrompt(base({ postHistoryInstructions: '' }))).content).not.toContain('【记住】');
    expect(last(assemblePrompt(base({ postHistoryInstructions: undefined }))).content).not.toContain('【记住】');
  });

  it('appends the nudge as the last line of the last message (R10.6)', () => {
    const msgs = assemblePrompt(base({ nudge: LINT_NUDGE }));
    expect(last(msgs).content.endsWith(LINT_NUDGE)).toBe(true);
    expect(last(msgs).content.split('\n').pop()).toBe(LINT_NUDGE);
    expect(JSON.stringify(msgs.slice(0, -1))).not.toContain('助手腔');
  });

  it('mentions the nudge nowhere when it is absent', () => {
    expect(JSON.stringify(assemblePrompt(base()))).not.toContain('助手腔');
  });

  it('passes history through verbatim', () => {
    const msgs = assemblePrompt(base());
    expect(msgs.slice(1, -1)).toEqual(HISTORY);
  });
});

describe('planTrim', () => {
  it('returns the whole history untouched when it fits', () => {
    const history: ChatMessage[] = [{ role: 'user', content: '你好' }];
    const plan = planTrim(history);
    expect(plan.keep).toBe(history);
    expect(plan.drop).toHaveLength(0);
    expect(plan.droppedTokens).toBe(0);
  });

  it('drops at least dropTokens and never splits a user/assistant pair', () => {
    const body = '字'.repeat(900);
    expect(estimateTokens(body)).toBe(600);
    const history: ChatMessage[] = [];
    for (let t = 0; t < 30; t++) {
      history.push({ role: 'user', content: body });
      history.push({ role: 'assistant', content: body });
    }
    const plan = planTrim(history);
    expect(plan.droppedTokens).toBe(8400);
    expect(plan.droppedTokens).toBeGreaterThanOrEqual(8000);
    expect(plan.drop).toHaveLength(14);
    expect(plan.keep).toHaveLength(46);
    expect(plan.keep[0].role).toBe('user');
    expect(plan.drop.length + plan.keep.length).toBe(history.length);
  });
});
