import { describe, expect, it } from 'vitest';
import { sanitizeForDisplay } from './sanitize.ts';

describe('sanitizeForDisplay', () => {
  it('strips markdown emphasis and list markers', () => {
    expect(sanitizeForDisplay('**你好**\n- 第一\n- 第二')).toBe('你好\n第一\n第二');
  });

  it('removes bracketed stage directions', () => {
    expect(sanitizeForDisplay('[微笑]你好呀（旁白：她笑了）')).toBe('你好呀');
  });

  it('converts half-width punctuation inside CJK runs only', () => {
    expect(sanitizeForDisplay('你好,世界! Hello, world!')).toBe('你好，世界！ Hello, world!');
  });

  it('collapses long ellipses', () => {
    expect(sanitizeForDisplay('等等......')).toBe('等等……');
    expect(sanitizeForDisplay('等等。。。')).toBe('等等……');
  });

  it('drops an injected leading number', () => {
    expect(sanitizeForDisplay('12 今天不错')).toBe('今天不错');
  });

  it('keeps a ZWJ emoji cluster intact while converting the punctuation after it', () => {
    expect(sanitizeForDisplay('好耶👨‍👩‍👧,走')).toBe('好耶👨‍👩‍👧，走');
  });

  it('removes fenced code blocks and unwraps inline backticks', () => {
    expect(sanitizeForDisplay('看这个：```js\nconst a=1;\n```好了')).toBe('看这个：好了');
    expect(sanitizeForDisplay('用 `npm` 装')).toBe('用 npm 装');
  });

  it('removes heading markers and ordered-list markers', () => {
    expect(sanitizeForDisplay('# 标题\n内容')).toBe('标题\n内容');
    expect(sanitizeForDisplay('1. 第一\n2. 第二')).toBe('第一\n第二');
  });

  it('normalises carriage returns, trailing spaces and blank lines', () => {
    expect(sanitizeForDisplay('你好\r\n世界')).toBe('你好\n世界');
    expect(sanitizeForDisplay('一   \n二')).toBe('一\n二');
    expect(sanitizeForDisplay('一\n\n\n\n二')).toBe('一\n\n二');
  });

  it('keeps emoji, trims, and leaves a latin sentence alone', () => {
    expect(sanitizeForDisplay('好耶🙂🙂')).toBe('好耶🙂🙂');
    expect(sanitizeForDisplay('  你好  ')).toBe('你好');
    expect(sanitizeForDisplay('ok, fine.')).toBe('ok, fine.');
  });
});

describe('M-1 — the A23 leading-number strip is opt-out for later sentences', () => {
  it('keeps a leading number when the caller says this is not the first sentence', () => {
    expect(sanitizeForDisplay('2 加 2 等于 4。', { leadingNumber: false })).toBe('2 加 2 等于 4。');
    expect(sanitizeForDisplay('3 个小时吧。', { leadingNumber: false })).toBe('3 个小时吧。');
  });
  it('strips it by default (first sentence / whole-reply emptiness check)', () => {
    expect(sanitizeForDisplay('2 加 2 等于 4。')).toBe('加 2 等于 4。');
  });
});
