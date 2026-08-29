import { describe, expect, it } from 'vitest';
import {
  Channels,
  EMOTIONS,
  EmotionSchema,
  ErrorCodeSchema,
  HistoryRowSchema,
  LintResultSchema,
  LintRuleSchema,
  LintSeveritySchema,
  MAIN_TO_RENDERER,
  MessageKindSchema,
  RoleSchema,
  SentenceEventSchema,
  SideSchema,
  TurnStateSchema,
  UsageSchema,
  isEmotion,
  parseEvent,
} from './index.ts';

describe('protocol', () => {
  it('accepts a valid gaze:cursor event', () => {
    const r = parseEvent(Channels.gazeCursor, { x: 10, y: -3.5 });
    expect(r).toEqual({ ok: true, data: { x: 10, y: -3.5 } });
  });

  it('rejects an unknown channel', () => {
    const r = parseEvent('nope' as never, {});
    expect(r.ok).toBe(false);
  });

  it('rejects a malformed payload', () => {
    const r = parseEvent(Channels.avatarHover, { inside: 'yes' });
    expect(r.ok).toBe(false);
  });

  it('carries debug:toggle main→renderer with an empty payload', () => {
    expect(MAIN_TO_RENDERER).toContain(Channels.debugToggle);
    expect(parseEvent(Channels.debugToggle, {})).toEqual({ ok: true, data: {} });
  });
});

describe('numeric bounds', () => {
  it('accepts an ordinary avatar:drag delta', () => {
    expect(parseEvent(Channels.avatarDrag, { dx: -12, dy: 7.5 })).toEqual({ ok: true, data: { dx: -12, dy: 7.5 } });
  });

  it.each([
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['NaN', Number.NaN],
    ['MAX_VALUE', Number.MAX_VALUE],
    ['over-bound', 4097],
    ['under-bound', -4097],
  ])('rejects avatar:drag dx = %s', (_label, value) => {
    expect(parseEvent(Channels.avatarDrag, { dx: value, dy: 0 }).ok).toBe(false);
    expect(parseEvent(Channels.avatarDrag, { dx: 0, dy: value }).ok).toBe(false);
  });

  it('accepts avatar:drag exactly at the bound', () => {
    expect(parseEvent(Channels.avatarDrag, { dx: 4096, dy: -4096 }).ok).toBe(true);
  });

  it.each([
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('rejects non-finite gaze:cursor coordinates (%s)', (_label, value) => {
    expect(parseEvent(Channels.gazeCursor, { x: value, y: 0 }).ok).toBe(false);
    expect(parseEvent(Channels.gazeCursor, { x: 0, y: value }).ok).toBe(false);
  });

  it('keeps gaze:cursor unbounded in range — window-local coords go far outside the window', () => {
    expect(parseEvent(Channels.gazeCursor, { x: -8000, y: 12000 }).ok).toBe(true);
  });
});

describe('emotion vocabulary', () => {
  it('lists the nine control-grammar emotions in order', () => {
    expect(EMOTIONS).toEqual([
      'happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'neutral',
    ]);
  });

  it('accepts every listed emotion and rejects one that is not listed', () => {
    for (const e of EMOTIONS) expect(EmotionSchema.safeParse(e).success).toBe(true);
    expect(EmotionSchema.safeParse('joy').success).toBe(false);
  });

  it('narrows with isEmotion only for listed values', () => {
    expect(isEmotion('curious')).toBe(true);
    expect(isEmotion('joy')).toBe(false);
    expect(isEmotion('')).toBe(false);
  });
});

describe('brain-shared shapes', () => {
  it('parses a minimal sentence event and rejects an unlisted emotion', () => {
    expect(SentenceEventSchema.safeParse({ turnId: 't1', seq: 0, text: '你好', emotion: 'happy' })).toEqual({
      success: true,
      data: { turnId: 't1', seq: 0, text: '你好', emotion: 'happy' },
    });
    expect(SentenceEventSchema.safeParse({ turnId: 't1', seq: 0, text: '你好', emotion: 'joy' }).success).toBe(false);
  });

  it('pins every §2.2 vocabulary and record shape', () => {
    expect(TurnStateSchema.options).toEqual(['idle', 'thinking', 'speaking']);
    expect(ErrorCodeSchema.options).toEqual([
      'auth', 'balance', 'rate', 'server', 'network', 'timeout', 'empty', 'no-key',
    ]);
    expect(LintSeveritySchema.options).toEqual(['none', 'strip', 'regenerate']);
    expect(LintRuleSchema.options).toHaveLength(15);
    expect(MessageKindSchema.options).toEqual(['chat', 'proactive', 'system']);
    expect(RoleSchema.options).toEqual(['user', 'assistant']);
    expect(SideSchema.options).toEqual(['top', 'right', 'bottom', 'left']);

    expect(UsageSchema.safeParse({ promptTokens: 812, cacheHit: 768, cacheMiss: 44, completionTokens: 57 }).success).toBe(true);
    expect(UsageSchema.safeParse({ promptTokens: 1.5, cacheHit: 0, cacheMiss: 0, completionTokens: 0 }).success).toBe(false);

    expect(LintResultSchema.safeParse({ violations: [{ rule: 'repetition', detail: 'same opener' }], severity: 'regenerate' }).success).toBe(true);
    expect(LintResultSchema.safeParse({ violations: [{ rule: 'nope', detail: 'x' }], severity: 'none' }).success).toBe(false);

    expect(HistoryRowSchema.safeParse({ id: 1, ts: 1756400000000, role: 'assistant', content: '嗯', turnId: null, kind: 'chat', interrupted: false }).success).toBe(true);
    expect(HistoryRowSchema.safeParse({ id: 0, ts: 1756400000000, role: 'assistant', content: '嗯', turnId: null, kind: 'chat', interrupted: false }).success).toBe(false);
  });
});
