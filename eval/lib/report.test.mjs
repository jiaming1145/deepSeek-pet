import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stampFrom, renderMarkdown, writeReports } from './report.mjs';

const REPORT = {
  version: 1,
  startedAt: '2026-08-29T14:03:11.000Z',
  config: {
    model: 'deepseek-v4-flash', judge: 'deepseek-v4-pro', runs: 3, fixture: 'f.json',
    character: 'c.json', judgeVersion: 1, cardTokens: 673, staticSystemTokens: 994, dry: true, limit: null,
    concurrency: 4, seed: 1, shuffled: false, noJudge: false,
  },
  turns: [],
  axes: {
    in_character: { kind: 'score2', n: 2, mean: 2, pct2: 1, thresholdMean: 1.8, thresholdPct2: 0.9, threshold: 0.9, skipped: false, pass: true },
    assistant_speak: { kind: 'countMax', n: 2, count: 1, threshold: 0, skipped: false, pass: false },
    trait_hit: { kind: 'pctMin', n: 0, skipped: true, pass: true, threshold: 0.8 },
  },
  shape: { shortReplyPct: 1, cacheHitPct: null },
  shapeGates: {
    shortReplyPct: { value: 1, cmp: 'gte', threshold: 0.9, unit: 'pct', label: 'A1 ≤60汉字且≤3句', skipped: false, pass: true },
    cacheHitPct: { value: null, cmp: 'gte', threshold: 0.7, unit: 'pct', label: 'X1 第3轮起缓存命中', skipped: true, pass: true },
  },
  informational: { prompts: 46, turns: 2, lintNone: 2, lintStrip: 0, lintRegenerate: 0, lintRuleCounts: {}, judgeErrors: 0, emojiJudgeDisagreements: 0, openerRepeatCount: 0, affectRateCount: 0, meanHanzi: 20, medianTtftMs: null, meanTotalMs: 12, meanEstimatedPromptTokens: 800 },
  worst: { assistant_speak: [{ promptId: 'adversarial-01', run: 0, reply: '作为一个AI助手，我……' }] },
  pass: false,
};

test('stampFrom turns an ISO timestamp into the report stamp', () => {
  assert.equal(stampFrom('2026-08-29T14:03:11.000Z'), '2026-08-29-1403');
});

test('renderMarkdown marks a dry run, every gate, and the worst replies', () => {
  const md = renderMarkdown(REPORT);
  assert.ok(md.includes('DRY RUN'));
  assert.ok(md.includes('总判定：**FAIL**'));
  assert.ok(md.includes('| 卡片 token | 673 / 700 |'));
  assert.ok(md.includes('| 静态系统块 token | 994 / 1100 |'));
  assert.ok(md.includes('| `in_character` | 2 | mean 2.00 · 2占比 100.0% | mean ≥ 1.8 且 2占比 ≥ 90.0% | PASS |'));
  assert.ok(md.includes('| `assistant_speak` | 2 | 1 次 | ≤ 0 | FAIL |'));
  assert.ok(md.includes('| `trait_hit` | 0 | — | ≥ 80.0% | SKIP |'));
  assert.ok(md.includes('| `cacheHitPct` | — | ≥ 70.0% | SKIP |'));
  assert.ok(md.includes('作为一个AI助手，我……'));
  assert.ok(md.includes('A8（3 个人格盲评归属）不在 Phase 2 范围内'));
});

test('writeReports writes both files under the stamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-eval-'));
  const { jsonPath, mdPath } = writeReports(dir, REPORT);
  assert.ok(jsonPath.endsWith('2026-08-29-1403.json'));
  assert.ok(mdPath.endsWith('2026-08-29-1403.md'));
  assert.equal(JSON.parse(readFileSync(jsonPath, 'utf8')).pass, false);
  assert.ok(readFileSync(mdPath, 'utf8').includes('总判定'));
});
