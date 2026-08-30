import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEEPSEEK_MODEL } from './deepseek.ts';
import {
  EXTRACT_ALIAS_MAX,
  EXTRACT_EVERY_N_USER_TURNS,
  EXTRACT_MAX_FACTS,
  EXTRACT_MAX_TOKENS,
  EXTRACT_MODEL,
  EXTRACT_SYSTEM,
  EXTRACT_VALUE_MAX,
  ExtractResponseSchema,
  ExtractedFactSchema,
  extractUserMessage,
  parseExtractResponse,
} from './extract-prompt.ts';

describe('§8.5 constants', () => {
  it('pins every number R3-10 and research §7 name', () => {
    expect(EXTRACT_EVERY_N_USER_TURNS).toBe(6);
    expect(EXTRACT_MAX_TOKENS).toBe(400);
    expect(EXTRACT_MAX_FACTS).toBe(3);
    expect(EXTRACT_VALUE_MAX).toBe(120);
    expect(EXTRACT_ALIAS_MAX).toBe(24);
  });

  it('EXTRACT_MODEL is the model the shipped client already speaks (ChatRequest carries none)', () => {
    expect(EXTRACT_MODEL).toBe('deepseek-v4-flash');
    // §8.5 names a per-call model, but ChatRequest is { messages, maxTokens? } — the model is fixed
    // when the client is constructed (deepseek.ts:341). The two agree, so nothing is lost; if
    // DEEPSEEK_MODEL ever moves off flash this assertion fails and the gap becomes visible.
    expect(EXTRACT_MODEL).toBe(DEEPSEEK_MODEL);
  });
});

describe('§8.5 EXTRACT_SYSTEM is BYTE-STABLE (an edit is a cache reset needing an Amendment)', () => {
  it('is exactly the 538-character, 12-line prompt the contract writes', () => {
    expect(EXTRACT_SYSTEM.length).toBe(538);
    expect(EXTRACT_SYSTEM.split('\n')).toHaveLength(12);
    expect(createHash('sha256').update(EXTRACT_SYSTEM, 'utf8').digest('hex')).toBe(
      'a6a4f67147652f5eb7bb10c20ce8e7ae73412c28f847028c8afb549521d40b05',
    );
  });

  it('carries the three structural rules research §7 derives from the mem0 audit', () => {
    expect(EXTRACT_SYSTEM.startsWith('你在读一段用户说过的话')).toBe(true);
    expect(EXTRACT_SYSTEM).toContain('不要看角色的回复'); // rule 1: user turns only
    expect(EXTRACT_SYSTEM).toContain('{"facts":[]}'); // "nothing worth keeping" is legal
    expect(EXTRACT_SYSTEM).toContain('不超过四十个字');
    expect(EXTRACT_SYSTEM.endsWith('不要记一次性的闲聊。')).toBe(true); // rule 3: no imperatives
    expect(EXTRACT_SYSTEM).not.toContain('小春'); // R3-19: no persona name
  });
});

describe('§8.5 ExtractedFactSchema / ExtractResponseSchema', () => {
  const good = {
    key: 'job_interview',
    value: '主人下周三要去杭州面试',
    alias: ['面试', '工作'],
    confidence: 0.9,
  };

  it('accepts a well-formed fact', () => {
    expect(ExtractedFactSchema.safeParse(good).success).toBe(true);
  });

  it.each([
    ['upper-case key', { ...good, key: 'Job' }],
    ['key starting with a digit', { ...good, key: '1job' }],
    ['one-character key', { ...good, key: 'j' }],
    ['41-character key', { ...good, key: `a${'b'.repeat(40)}` }],
    ['empty value', { ...good, value: '' }],
    ['over-long value', { ...good, value: '猫'.repeat(121) }],
    ['nine aliases', { ...good, alias: Array.from({ length: 9 }, (_, i) => `a${i}`) }],
    ['over-long alias', { ...good, alias: ['猫'.repeat(25)] }],
    ['confidence above 1', { ...good, confidence: 1.1 }],
    ['confidence below 0', { ...good, confidence: -0.1 }],
  ])('rejects a %s', (_label, bad) => {
    expect(ExtractedFactSchema.safeParse(bad).success).toBe(false);
  });

  it('allows zero aliases and caps the response at EXTRACT_MAX_FACTS', () => {
    expect(ExtractedFactSchema.safeParse({ ...good, alias: [] }).success).toBe(true);
    expect(ExtractResponseSchema.safeParse({ facts: [] }).success).toBe(true);
    expect(ExtractResponseSchema.safeParse({ facts: [good, good, good] }).success).toBe(true);
    expect(ExtractResponseSchema.safeParse({ facts: [good, good, good, good] }).success).toBe(false);
  });
});

describe('§8.5 extractUserMessage — the user’s new messages, one per line, and nothing else', () => {
  it('joins the turns with newlines, verbatim', () => {
    expect(extractUserMessage(['我下周三要去面试', '有点紧张'])).toBe('我下周三要去面试\n有点紧张');
  });

  it('drops blank turns and trims each line', () => {
    expect(extractUserMessage([' 在吗 ', '', '   ', '猫叫芝麻'])).toBe('在吗\n猫叫芝麻');
  });

  it('is the ONLY input — no persona, no 【你记得】 block, no assistant turn can reach it', () => {
    // Structural, not advisory (research §7): the signature takes one array of user strings.
    expect(extractUserMessage([])).toBe('');
    expect(extractUserMessage.length).toBe(1);
  });
});

describe('§8.5 parseExtractResponse — truncated JSON means EXTRACT NOTHING', () => {
  const body =
    '{"facts":[{"key":"job_interview","value":"主人下周三要去杭州面试","alias":["面试"],"confidence":0.9}]}';

  it('parses a well-formed response', () => {
    const out = parseExtractResponse(body);
    expect(out.ok).toBe(true);
    expect(out.ok && out.facts).toHaveLength(1);
    expect(out.ok && out.facts[0].key).toBe('job_interview');
  });

  it('tolerates a fenced or prefixed response by taking the outermost JSON object', () => {
    expect(parseExtractResponse(`\`\`\`json\n${body}\n\`\`\``).ok).toBe(true);
    expect(parseExtractResponse(`好的：${body}`).ok).toBe(true);
  });

  it('returns { ok: false } for truncation, garbage and an empty body — never a partial parse', () => {
    // mem0#5428: hitting max_tokens mid-JSON silently drops every fact. Zero is the only safe answer.
    for (const raw of [
      '{"facts":[{"key":"job_interview","value":"主人下周三要去杭州面试","alias":["面',
      '{"facts":',
      'I could not find any facts.',
      '',
      '   ',
    ]) {
      const out = parseExtractResponse(raw);
      expect(out.ok).toBe(false);
      expect(out.ok === false && out.reason.length).toBeGreaterThan(0);
    }
  });

  it('returns { ok: false } when the shape parses as JSON but fails the schema', () => {
    expect(
      parseExtractResponse('{"facts":[{"key":"Job","value":"x","alias":[],"confidence":0.9}]}').ok,
    ).toBe(false);
    expect(parseExtractResponse('{"facts":"none"}').ok).toBe(false);
    expect(parseExtractResponse('[]').ok).toBe(false);
  });

  it('accepts an explicit empty harvest', () => {
    const out = parseExtractResponse('{"facts":[]}');
    expect(out.ok).toBe(true);
    expect(out.ok && out.facts).toEqual([]);
  });
});
