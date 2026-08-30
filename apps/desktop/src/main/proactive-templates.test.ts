import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROACTIVE_BUCKETS } from '@ds/protocol';
import { FACT_MERGE_JACCARD } from '@ds/memory';
import { describe, expect, it } from 'vitest';
import {
  A14_FORBIDDEN, NEAR_DUPLICATE_JACCARD, PROACTIVE_TEMPLATE_FLOOR, PROACTIVE_TEMPLATES,
  PROACTIVE_TEXT_MAX_CHARS, auditTemplate, nearDuplicate,
} from './proactive-templates';

const SEG = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const chars = (s: string) => [...SEG.segment(s)].length;

describe('PROACTIVE_TEMPLATES (§4.8, R3-29, R3-30)', () => {
  it('constants', () => {
    expect(PROACTIVE_TEMPLATE_FLOOR).toBe(15);
    expect(PROACTIVE_TEXT_MAX_CHARS).toBe(30);
    expect(NEAR_DUPLICATE_JACCARD).toBe(0.6);
    // §8.5 / Task 2 C-7: §4.8’s threshold and `facts.ts`’s merge threshold are the SAME number in
    // two packages that cannot import each other (`@ds/memory` must not reach into `apps/desktop`).
    // `apps/desktop` sees both, so the equality is asserted here (self-review fix, §5.13).
    expect(NEAR_DUPLICATE_JACCARD).toBe(FACT_MERGE_JACCARD);
    expect(A14_FORBIDDEN.map((r) => r.rule)).toEqual(['guilt-absence', 'guilt-duty', 'fomo', 'neediness', 'silence-count', 'question-nag']);
  });
  it('every template is audited and passes the A14 linter', () => {
    for (const t of PROACTIVE_TEMPLATES) {
      expect(t.audited, t.id).toBe(true);
      expect(auditTemplate(t), t.id).toEqual([]);
    }
  });
  it('holds >= 15 templates in each of the six buckets', () => {
    for (const b of PROACTIVE_BUCKETS) {
      expect(PROACTIVE_TEMPLATES.filter((t) => t.bucket === b).length, b).toBeGreaterThanOrEqual(PROACTIVE_TEMPLATE_FLOOR);
    }
  });
  it('ids are unique and match /^[a-z0-9_]{2,48}$/', () => {
    const ids = PROACTIVE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]{2,48}$/);
  });
  it('every text is <= 30 characters and every template has exactly one of text | instruction', () => {
    for (const t of PROACTIVE_TEMPLATES) {
      expect((t.text === undefined) !== (t.instruction === undefined), t.id).toBe(true);
      if (t.text !== undefined) expect(chars(t.text), t.id).toBeLessThanOrEqual(PROACTIVE_TEXT_MAX_CHARS);
    }
  });
  it('R3-29 invariant: an instruction template is callback-only', () => {
    expect(PROACTIVE_TEMPLATES.filter((t) => t.instruction !== undefined).every((t) => t.bucket === 'callback')).toBe(true);
    expect(PROACTIVE_TEMPLATES.filter((t) => t.bucket === 'world').every((t) => t.instruction === undefined)).toBe(true);
  });
  it('R3-19: no template names the persona; no control token or markdown', () => {
    const name = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../characters/haru/character.json', import.meta.url)), 'utf8')).card.name as string;
    for (const t of PROACTIVE_TEMPLATES) {
      const s = t.text ?? t.instruction ?? '';
      expect(s, t.id).not.toContain(name);
      expect(s, t.id).not.toContain('<|');
      expect(s, t.id).not.toMatch(/[*#`]/);
    }
  });
  it('no two texts are near-duplicates of each other (bigram Jaccard < 0.6)', () => {
    const texts = PROACTIVE_TEMPLATES.filter((t) => t.text !== undefined).map((t) => t.text as string);
    for (let i = 0; i < texts.length; i++) expect(nearDuplicate(texts[i], texts.slice(0, i)), texts[i]).toBe(false);
  });
});

describe('auditTemplate', () => {
  const t = (s: string) => ({ id: 'x1', bucket: 'world' as const, text: s, audited: true as const });
  it.each([
    // DEVIATION (brief Step 13 datum vs contract §4.8 constant): the brief wrote 「你都三天没理我了」,
    // but `silence-count` is pinned as /(\d+\s*(分钟|小时|天).{0,4}(没|未))/ in BOTH the brief's Step 14
    // code and contract §4.8 — `\d` is ASCII-only, so a Chinese numeral cannot fire it. The pinned
    // constant wins; the probe uses an ASCII digit so both rules fire as the case intends. The
    // Chinese-numeral gap is reported as a Concern, not patched into the contract's regex here.
    ['你都3天没理我了', ['guilt-absence', 'silence-count']],
    ['你还没跟我说今天的事', ['guilt-duty']],
    ['限时优惠，别错过', ['fomo']],
    ['求你再陪我一会儿', ['neediness']],
    ['在吗？你怎么不说话', ['question-nag']],
  ])('%s -> %j', (s, rules) => {
    expect(auditTemplate(t(s))).toEqual(rules);
  });
  it('a clean line returns []', () => {
    expect(auditTemplate(t('窗外的云走得挺快。'))).toEqual([]);
  });
});

describe('nearDuplicate', () => {
  it('rejects at Jaccard >= 0.6 and accepts below', () => {
    expect(nearDuplicate('主人回来啦，水杯要不要续上。', ['主人回来啦，水杯要不要续上'])).toBe(true);
    expect(nearDuplicate('窗外的云走得挺快。', ['本鲸今天浮力特别好。'])).toBe(false);
    expect(nearDuplicate('abc', [])).toBe(false);
  });
});
