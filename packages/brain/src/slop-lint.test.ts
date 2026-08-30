import { describe, expect, it } from 'vitest';
import { LintRuleSchema } from '@ds/protocol';
import {
  RULE_SEVERITY,
  isSensitive,
  lintReply,
  lintSentence,
  lintTail,
  type LintContext,
  type LintRule,
} from './slop-lint.ts';

const ctx = (recent: string[] = [], sensitiveTurn = false): LintContext => ({ recent, sensitiveTurn });
const rules = (reply: string, c: LintContext): LintRule[] => lintReply(reply, c).violations.map((v) => v.rule);

describe('RULE_SEVERITY', () => {
  it('has exactly one severity per declared rule', () => {
    expect(Object.keys(RULE_SEVERITY).sort()).toEqual([...LintRuleSchema.options].sort());
  });

  it('lets regenerate win over strip', () => {
    expect(lintReply('她嘴角勾起🙂🙂', ctx()).severity).toBe('regenerate');
  });
});

describe('isSensitive', () => {
  it('flags a turn about a sensitive topic', () => {
    expect(isSensitive('我最近有点抑郁')).toBe(true);
    expect(isSensitive('我奶奶住院了')).toBe(true);
  });

  it('leaves an ordinary turn alone', () => {
    expect(isSensitive('今天天气不错')).toBe(false);
  });
});

describe('lint scopes', () => {
  it('lintSentence runs only the sentence-scope rules', () => {
    expect(lintSentence('嗯……好吧……', ctx()).violations).toEqual([]);
  });

  it('lintTail runs only the tail-scope rules', () => {
    expect(lintTail('作为AI，我很乐意帮您。', ctx()).violations).toEqual([]);
  });

  it('collapses duplicate rule/detail pairs in lintReply', () => {
    const r = lintReply('以下是一些想法。以下是另一些。', ctx());
    expect(r.violations.filter((v) => v.rule === 'assistant-leak')).toHaveLength(1);
  });
});

describe('assistant-leak (A4)', () => {
  it('flags assistant-speak as regenerate', () => {
    const r = lintReply('作为AI，我很乐意帮您。有什么可以帮您的吗？', ctx());
    expect(r.severity).toBe('regenerate');
    expect(r.violations.map((v) => v.rule)).toContain('assistant-leak');
  });

  it('leaves a plain refusal alone', () => {
    expect(rules('我也不知道，你问倒我了。', ctx())).not.toContain('assistant-leak');
  });
});

describe('narrates-user (A3)', () => {
  it('flags narrating the user', () => {
    expect(rules('你笑了笑，说：好啊。', ctx())).toContain('narrates-user');
  });

  it('allows the character to narrate herself', () => {
    expect(rules('我笑了一下，没说话。', ctx())).not.toContain('narrates-user');
  });
});

describe('markdown (A4)', () => {
  it('flags inline markdown and list markers', () => {
    expect(rules('**今天**不错。', ctx())).toContain('markdown');
    expect(rules('- 今天不错。', ctx())).toContain('markdown');
  });

  it('leaves plain prose alone', () => {
    expect(rules('今天不错。', ctx())).not.toContain('markdown');
    // Bare characters in prose are not markdown syntax.
    expect(rules('我在学 C#，第 #1 个练习是 5*3。', ctx())).not.toContain('markdown');
    expect(rules('用 `npm test` 跑一下。', ctx())).toContain('markdown');
  });
});

describe('webnovel (A6)', () => {
  it('flags a webnovel beat as regenerate', () => {
    expect(lintReply('她嘴角勾起，什么也没说。', ctx()).severity).toBe('regenerate');
  });

  it('leaves an ordinary description alone', () => {
    expect(rules('她笑了一下，什么也没说。', ctx())).not.toContain('webnovel');
  });
});

describe('rhetorical (A2)', () => {
  it('flags a rhetorical template', () => {
    expect(rules('难道你不觉得吗？', ctx())).toContain('rhetorical');
  });

  it('leaves a plain statement alone', () => {
    expect(rules('我觉得挺好的。', ctx())).not.toContain('rhetorical');
  });
});

describe('emoji (A18)', () => {
  it('allows exactly one emoji', () => {
    expect(lintReply('回来啦🙂', ctx()).severity).toBe('none');
  });

  it('flags two emoji as strip', () => {
    expect(lintReply('回来啦🙂🙂', ctx()).severity).toBe('strip');
  });

  it('flags one emoji together with a 颜文字', () => {
    expect(rules('回来啦🙂(^ω^)', ctx())).toContain('emoji');
  });

  it('allows a bare 颜文字 when no emoji is present', () => {
    expect(rules('回来啦(^ω^)', ctx())).not.toContain('emoji');
  });
});

describe('emoji-sensitive (A18)', () => {
  it('flags any emoji on a sensitive turn as regenerate', () => {
    expect(lintReply('回来啦🙂', ctx([], true)).severity).toBe('regenerate');
  });

  it('flags a bare 颜文字 on a sensitive turn', () => {
    expect(rules('回来啦(^ω^)', ctx([], true))).toContain('emoji-sensitive');
  });

  it('does not fire on an ordinary turn', () => {
    expect(rules('回来啦🙂', ctx())).not.toContain('emoji-sensitive');
  });
});

describe('closing-moral (A5)', () => {
  it('flags a closing moral', () => {
    expect(rules('今天不错。总之，记住要开心。', ctx())).toContain('closing-moral');
  });

  it('leaves an ordinary last sentence alone', () => {
    expect(rules('今天不错。你先歇会儿。', ctx())).not.toContain('closing-moral');
  });
});

describe('question-streak (A2)', () => {
  it('flags a question streak using recent replies', () => {
    expect(rules('那你呢？', ctx(['今天怎么样？']))).toContain('question-streak');
  });

  it('allows a question after a statement', () => {
    expect(rules('那你呢？', ctx(['今天挺好的。']))).not.toContain('question-streak');
  });
});

describe('ellipsis (A6)', () => {
  it('flags two ellipses as strip', () => {
    expect(lintReply('嗯……好吧……', ctx()).severity).toBe('strip');
  });

  it('allows exactly one ellipsis in a reply', () => {
    expect(rules('嗯……我知道了。', ctx())).not.toContain('ellipsis');
  });
});

describe('ellipsis-rate (A6)', () => {
  it('flags the ellipsis rate across replies', () => {
    expect(rules('嗯……', ctx(['好……', '嗯。', '在。', '哦。']))).toContain('ellipsis-rate');
    // Cold start: one …… with no history is 1/6, not 1/1 — must not force a regeneration.
    expect(rules('嗯……', ctx([]))).not.toContain('ellipsis-rate');
  });

  it('allows one ellipsis in six replies', () => {
    expect(rules('嗯，知道了。', ctx(['好……', '嗯。', '在。', '哦。', '行。']))).not.toContain('ellipsis-rate');
  });
});

describe('affect-rate (A7)', () => {
  it('flags the affect-word rate', () => {
    expect(rules('抱抱你。', ctx(['心疼。']))).toContain('affect-rate');
  });

  it('allows an affect word after two plain replies', () => {
    expect(rules('抱抱你。', ctx(['今天下雨了。', '我在呢。']))).not.toContain('affect-rate');
  });
});

describe('opener-repeat (A7)', () => {
  it('flags an identical opener across recent replies', () => {
    expect(rules('今天真的好累啊。', ctx(['今天真的还行。']))).toContain('opener-repeat');
  });

  it('allows a different opener', () => {
    expect(rules('今天真的好累啊。', ctx(['昨天下了一整天雨。']))).not.toContain('opener-repeat');
  });
});

describe('repetition (A7)', () => {
  it('flags 4-gram repetition against recent replies', () => {
    expect(rules('今天天气真的很好呢', ctx(['今天天气真的很好呢', 'x', 'y']))).toContain('repetition');
  });

  it('allows an unrelated reply', () => {
    expect(rules('今天天气真的很好呢', ctx(['我去楼下买了瓶水回来']))).not.toContain('repetition');
  });
});

describe('emoji-rate (A18)', () => {
  it('flags emoji in consecutive replies', () => {
    expect(rules('回来啦🙂', ctx(['刚吃完饭😀']))).toContain('emoji-rate');
  });

  it('allows one emoji after plain replies', () => {
    expect(rules('回来啦🙂', ctx(['刚吃完饭。']))).not.toContain('emoji-rate');
  });
});

describe('a clean reply', () => {
  it('passes a clean casual reply', () => {
    expect(lintReply('回来啦。今天累不累？', ctx(['好。'])).severity).toBe('none');
  });
});

describe('M-2 — tag questions are ordinary speech, not rhetorical templates', () => {
  it.each(['主人今天又熬夜了对吧？', '这不是很好吗？', '你说是不是？'])('does not flag %s', (text) => {
    expect(lintSentence(text, { recent: [], sensitiveTurn: false }).violations.map((v) => v.rule)).not.toContain('rhetorical');
  });
  it('still flags 难道…吗 and 你觉得呢', () => {
    expect(lintSentence('难道不是吗？', { recent: [], sensitiveTurn: false }).violations.map((v) => v.rule)).toContain('rhetorical');
    expect(lintSentence('你觉得呢？', { recent: [], sensitiveTurn: false }).violations.map((v) => v.rule)).toContain('rhetorical');
  });
});

describe('M-4 — 被打 as a prefix is not a sensitive turn', () => {
  it.each(['我的电脑被打开了', '刚才被打断了', '文件被打印了', '我方案又被打回来了', '被打扰了'])('%s is not sensitive', (text) => {
    expect(isSensitive(text)).toBe(false);
  });
  it.each(['我昨天被打了', '他被打得很惨', '被打骂'])('%s is sensitive', (text) => {
    expect(isSensitive(text)).toBe(true);
  });
});
