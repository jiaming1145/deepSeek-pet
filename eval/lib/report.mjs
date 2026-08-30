// eval/lib/report.mjs — the two report files (contracts.md §7.4).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_TOKEN_BUDGET, STATIC_SYSTEM_TOKEN_BUDGET } from '@ds/brain';
import { AXIS_LABELS } from './aggregate.mjs';

export function stampFrom(iso) {
  return `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}

const pct = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
const verdict = (row) => (row.skipped ? 'SKIP' : row.pass ? 'PASS' : 'FAIL');

function axisValue(row) {
  if (row.skipped) return '—';
  if (row.kind === 'score2') return `mean ${row.mean.toFixed(2)} · 2占比 ${pct(row.pct2)}`;
  if (row.kind === 'countMax') return `${row.count} 次`;
  return pct(row.pct);
}

function axisThreshold(row) {
  if (row.kind === 'score2') {
    return row.thresholdPct2 === null || row.thresholdPct2 === undefined
      ? `mean ≥ ${row.thresholdMean ?? row.threshold}`
      : `mean ≥ ${row.thresholdMean} 且 2占比 ≥ ${pct(row.thresholdPct2)}`;
  }
  if (row.kind === 'countMax') return `≤ ${row.threshold}`;
  if (row.kind === 'pctMin') return `≥ ${pct(row.threshold)}`;
  return `≤ ${pct(row.threshold)}`;
}

function shapeValue(row) {
  if (row.value === null || row.value === undefined) return '—';
  return row.unit === 'count' ? String(row.value) : pct(row.value);
}

function shapeThreshold(row) {
  const sign = row.cmp === 'gte' ? '≥' : row.cmp === 'lte' ? '≤' : '<';
  return `${sign} ${row.unit === 'count' ? row.threshold : pct(row.threshold)}`;
}

export function renderMarkdown(report) {
  const c = report.config;
  const L = [];
  L.push(`# Phase 2 eval — ${report.startedAt}`);
  L.push('');
  if (c.dry) {
    L.push('> **DRY RUN — 回复来自 `eval/recorded/replies.zh.json`，不是模型输出。这些数字只证明流水线和指标代码是对的，不能说明模型好坏。**');
    L.push('');
  }
  L.push(`总判定：**${report.pass ? 'PASS' : 'FAIL'}**`);
  L.push('');
  L.push('## 配置');
  L.push('');
  L.push('| 项 | 值 |');
  L.push('|---|---|');
  L.push(`| model | \`${c.model}\` |`);
  L.push(`| judge | ${c.noJudge ? '（跳过）' : `\`${c.judge}\``} |`);
  L.push(`| judge.md version | ${c.judgeVersion} |`);
  L.push(`| runs × prompts | ${c.runs} × ${report.informational.prompts} = ${report.informational.turns} 轮 |`);
  L.push(`| fixture | \`${c.fixture}\` |`);
  L.push(`| character | \`${c.character}\` |`);
  L.push(`| 卡片 token | ${c.cardTokens} / ${CARD_TOKEN_BUDGET} |`);
  L.push(`| 静态系统块 token | ${c.staticSystemTokens} / ${STATIC_SYSTEM_TOKEN_BUDGET} |`);
  L.push(`| dry / shuffled / concurrency / seed | ${c.dry} / ${c.shuffled} / ${c.concurrency} / ${c.seed} |`);
  L.push('');
  L.push('## 评审轴（judge）');
  L.push('');
  L.push('| 轴 | n | 实测 | 门槛 | 结果 |');
  L.push('|---|---|---|---|---|');
  for (const [key, row] of Object.entries(report.axes)) {
    L.push(`| \`${key}\` | ${row.n} | ${axisValue(row)} | ${axisThreshold(row)} | ${verdict(row)} |`);
  }
  L.push('');
  L.push('## 形状指标（本地计算）');
  L.push('');
  L.push('| 指标 | 实测 | 门槛 | 结果 |');
  L.push('|---|---|---|---|');
  for (const [key, row] of Object.entries(report.shapeGates)) {
    L.push(`| \`${key}\` | ${shapeValue(row)} | ${shapeThreshold(row)} | ${verdict(row)} |`);
  }
  L.push('');
  L.push('## 只上报、不设门槛');
  L.push('');
  L.push('| 项 | 值 |');
  L.push('|---|---|');
  for (const [k, v] of Object.entries(report.informational)) {
    L.push(`| \`${k}\` | ${typeof v === 'object' && v !== null ? JSON.stringify(v) : v} |`);
  }
  L.push('');
  const failing = Object.entries(report.worst);
  if (failing.length) {
    L.push('## 没过的轴，各挑三条最差的');
    L.push('');
    for (const [key, rows] of failing) {
      L.push(`### \`${key}\` — ${AXIS_LABELS[key] ?? key}`);
      L.push('');
      for (const r of rows) L.push(`- \`${r.promptId}\` run ${r.run}：${r.reply}`);
      L.push('');
    }
  }
  L.push('## 诚实声明（R8）');
  L.push('');
  L.push('- A8（3 个人格盲评归属）不在 Phase 2 范围内：现在只有一个人格，已挪到 Phase 3。');
  L.push('- A3/A4/A5/A9/A10/A15/A16 在这个样本量上是**方向性**结论，不是附录里 200/500 轮的分母；全分母跑在 Phase 4 的 nightly（X12）。');
  L.push('- 调参循环上限 3 轮；第三轮之后的数字原样上报。');
  L.push('- 本工具测的是模型的**原始**输出：不 strip，也不 regenerate。线上应用还会再过一遍 TurnRunner 的 lint，所以实际观感只会更好。');
  L.push('');
  return L.join('\n');
}

export function writeReports(outDir, report) {
  mkdirSync(outDir, { recursive: true });
  const stamp = stampFrom(report.startedAt);
  const jsonPath = join(outDir, `${stamp}.json`);
  const mdPath = join(outDir, `${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, renderMarkdown(report), 'utf8');
  return { jsonPath, mdPath };
}
