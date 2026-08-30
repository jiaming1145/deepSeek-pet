import { describe, expect, it } from 'vitest';
import { PROACTIVE_INSTRUCTION_TAIL, proactivePrompt, type ProactiveTemplate } from './proactive-prompt.ts';

const cb: ProactiveTemplate = { id: 'callback_01', bucket: 'callback', instruction: '问一句进展。', audited: true };
const tx: ProactiveTemplate = { id: 'world_01', bucket: 'world', text: '窗外的云走得挺快。', audited: true };

describe('proactivePrompt (§3.10.7)', () => {
  it('the tail is byte-stable', () => {
    expect(PROACTIVE_INSTRUCTION_TAIL).toBe('只说一句话，不超过三十个字。不要提对方多久没理你，不要催，不要问“你还在吗”。');
  });
  it('renders 【主动】{instruction} then the tail, facts on a 【你记得】 line', () => {
    expect(proactivePrompt(cb, ['主人在准备考研'])).toBe(
      '【主动】问一句进展。\n【你记得】主人在准备考研\n只说一句话，不超过三十个字。不要提对方多久没理你，不要催，不要问“你还在吗”。',
    );
    expect(proactivePrompt(cb, [])).toBe('【主动】问一句进展。\n只说一句话，不超过三十个字。不要提对方多久没理你，不要催，不要问“你还在吗”。');
  });
  it('joins several facts with ；, at most 5', () => {
    const s = proactivePrompt(cb, ['a', 'b', 'c', 'd', 'e', 'f']);
    expect(s).toContain('【你记得】a；b；c；d；e\n');
    expect(s).not.toContain('f');
  });
  it('a text template is never a prompt — it throws so the zero-token path cannot be bypassed', () => {
    expect(() => proactivePrompt(tx, [])).toThrow('text template');
  });
});
