// eval/lib/aggregate.mjs — axis + shape aggregation and the R8/P2 thresholds.
import { fourGrams, overlapRatio } from './shape.mjs';

/** The seven axes every turn is judged on (contracts.md §7.3). */
export const UNIVERSAL_AXES = [
  'in_character', 'assistant_speak', 'narrates_user', 'closing_moral',
  'rhetorical_tail', 'emoji_discipline', 'nativeness',
];

/** Frozen order = report row order. */
export const AXIS_SPECS = {
  in_character:        { kind: 'score2',  mean: 1.8, pct2: 0.90 },
  nativeness:          { kind: 'score2',  mean: 1.8, pct2: null },
  assistant_speak:     { kind: 'countMax', max: 0 },
  narrates_user:       { kind: 'countMax', max: 0 },
  closing_moral:       { kind: 'countMax', max: 0 },
  rhetorical_tail:     { kind: 'countMax', max: 0 },
  refusal_language:    { kind: 'countMax', max: 0 },
  initiative:          { kind: 'pctMin',  min: 0.70 },
  sycophancy_pushback: { kind: 'pctMin',  min: 0.50 },
  humour_stops:        { kind: 'pctMin',  min: 1.00 },
  memory_use:          { kind: 'pctMin',  min: 0.80 },
  trait_hit:           { kind: 'pctMin',  min: 0.80 },
  emoji_discipline:    { kind: 'pctMax',  max: 0.25 },
  false_disagreement:  { kind: 'pctMax',  max: 0.20 },
};

export const AXIS_LABELS = {
  in_character: 'A9 在人设里', nativeness: 'A19 中文口语地道',
  assistant_speak: 'A4 助手腔', narrates_user: 'A3 替用户说话',
  closing_moral: 'A5 结尾升华', rhetorical_tail: 'A2/A5 反问收尾',
  refusal_language: 'A15 政策口吻', initiative: 'A13 无聊话也带出话题',
  sycophancy_pushback: 'A16 说错时顶回去', humour_stops: 'A17 别闹了就收',
  memory_use: 'A19 记得住', trait_hit: 'E-3 人设特征命中（Phase 2 无样本）',
  emoji_discipline: 'A18 带 emoji 的回复占比', false_disagreement: 'P2 对的也硬抬杠',
  emoji_discipline_sensitive: 'A18 难受话题里带 emoji', judge_error_rate: '评审返回解析失败率',
  in_character_flips: 'A9 掉出人设（判官打 0：变助手 / 心理咨询师 / 旁白）',
};

export const SHAPE_SPECS = {
  shortReplyPct:            { cmp: 'gte', threshold: 0.90, unit: 'pct',   label: 'A1 ≤60汉字且≤3句' },
  questionRatePct:          { cmp: 'lte', threshold: 0.30, unit: 'pct',   label: 'A2 以问号结尾' },
  consecutiveQuestionPairs: { cmp: 'lte', threshold: 0,    unit: 'count', label: 'A2 连着两条都是问句' },
  ellipsisReplyPct:         { cmp: 'lte', threshold: 0.20, unit: 'pct',   label: 'A6 含「……」的回复占比' },
  multiEllipsisCount:       { cmp: 'lte', threshold: 0,    unit: 'count', label: 'A6 一条里多于一个「……」' },
  repetitionMaxPct:         { cmp: 'lt',  threshold: 0.20, unit: 'pct',   label: 'A7 4-gram 最大重合率' },
  complianceMissPct:        { cmp: 'lt',  threshold: 0.10, unit: 'pct',   label: 'ACT 首句缺标记' },
  cacheHitPct:              { cmp: 'gte', threshold: 0.70, unit: 'pct',   label: 'X1 第3轮起缓存命中' },
  emojiMultiCount:          { cmp: 'lte', threshold: 0,    unit: 'count', label: 'A18 一条里多于一个 emoji' },
  markdownLintCount:        { cmp: 'lte', threshold: 0,    unit: 'count', label: 'A4 原始输出命中 markdown lint' },
};

const round3 = (x) => Math.round(x * 1000) / 1000;

export function axesFor(prompt) {
  return [...UNIVERSAL_AXES, ...prompt.axes];
}

function worstFor(key, spec, rows) {
  if (spec.kind === 'score2') return [...rows].sort((a, b) => a.judge[key] - b.judge[key]).slice(0, 3);
  if (spec.kind === 'pctMin') return rows.filter((t) => t.judge[key] === false).slice(0, 3);
  return rows.filter((t) => t.judge[key] === true).slice(0, 3);
}

function cmpOk(cmp, value, threshold) {
  if (cmp === 'gte') return value >= threshold;
  if (cmp === 'lte') return value <= threshold;
  return value < threshold;
}

export function aggregate(turns, { noJudge }) {
  const judged = turns.filter((t) => t.judge !== null && t.judge !== undefined);
  const axes = {};
  const worst = {};

  for (const [key, spec] of Object.entries(AXIS_SPECS)) {
    const rows = judged.filter((t) => t.axes.includes(key) && t.judge[key] !== undefined);
    if (noJudge || rows.length === 0) {
      axes[key] = spec.kind === 'score2'
        ? { kind: 'score2', n: 0, thresholdMean: spec.mean, thresholdPct2: spec.pct2,
            threshold: spec.pct2 ?? spec.mean, skipped: true, pass: true }
        : { kind: spec.kind, n: 0, threshold: spec.max ?? spec.min, skipped: true, pass: true };
      continue;
    }
    if (spec.kind === 'score2') {
      const vals = rows.map((t) => t.judge[key]);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const pct2 = vals.filter((v) => v === 2).length / vals.length;
      const pass = mean >= spec.mean && (spec.pct2 === null || pct2 >= spec.pct2);
      axes[key] = { kind: 'score2', n: vals.length, mean: round3(mean), pct2: round3(pct2),
        thresholdMean: spec.mean, thresholdPct2: spec.pct2, threshold: spec.pct2 ?? spec.mean, skipped: false, pass };
      if (!pass) worst[key] = worstFor(key, spec, rows).map((t) => ({ promptId: t.promptId, run: t.run, reply: t.reply }));
    } else if (spec.kind === 'countMax') {
      const count = rows.filter((t) => t.judge[key] === true).length;
      const pass = count <= spec.max;
      axes[key] = { kind: 'countMax', n: rows.length, count, threshold: spec.max, skipped: false, pass };
      if (!pass) worst[key] = worstFor(key, spec, rows).map((t) => ({ promptId: t.promptId, run: t.run, reply: t.reply }));
    } else {
      const hits = rows.filter((t) => t.judge[key] === true).length;
      const pct = round3(hits / rows.length);
      const pass = spec.kind === 'pctMin' ? pct >= spec.min : pct <= spec.max;
      axes[key] = { kind: spec.kind, n: rows.length, pct, threshold: spec.kind === 'pctMin' ? spec.min : spec.max, skipped: false, pass };
      if (!pass) worst[key] = worstFor(key, spec, rows).map((t) => ({ promptId: t.promptId, run: t.run, reply: t.reply }));
    }
  }

  // A18's second half: zero emoji on sensitive turns.
  const sensRows = judged.filter((t) => t.sensitive && t.judge.emoji_discipline !== undefined);
  if (noJudge || sensRows.length === 0) {
    axes.emoji_discipline_sensitive = { kind: 'countMax', n: 0, skipped: true, pass: true, threshold: 0 };
  } else {
    const count = sensRows.filter((t) => t.judge.emoji_discipline === true).length;
    const pass = count === 0;
    axes.emoji_discipline_sensitive = { kind: 'countMax', n: sensRows.length, count, threshold: 0, skipped: false, pass };
    if (!pass) worst.emoji_discipline_sensitive = sensRows.filter((t) => t.judge.emoji_discipline === true)
      .slice(0, 3).map((t) => ({ promptId: t.promptId, run: t.run, reply: t.reply }));
  }

  // A9's second half (exquisite-bar A9: "0 therapist-flips"): a judge score of 0 on in_character IS
  // the flip by the rubric's definition, and the mean/pct2 pair alone lets up to 10 % of them through.
  const icRows = judged.filter((t) => t.judge.in_character !== undefined);
  if (noJudge || icRows.length === 0) {
    axes.in_character_flips = { kind: 'countMax', n: 0, skipped: true, pass: true, threshold: 0 };
  } else {
    const flips = icRows.filter((t) => t.judge.in_character === 0);
    const pass = flips.length === 0;
    axes.in_character_flips = { kind: 'countMax', n: icRows.length, count: flips.length, threshold: 0, skipped: false, pass };
    if (!pass) worst.in_character_flips = flips.slice(0, 3).map((t) => ({ promptId: t.promptId, run: t.run, reply: t.reply }));
  }

  // How often the judge failed to answer in the required shape.
  const judgeErrors = turns.filter((t) => t.judgeError).length;
  if (noJudge) {
    axes.judge_error_rate = { kind: 'pctMax', n: 0, skipped: true, pass: true, threshold: 0.05 };
  } else {
    const pct = round3(judgeErrors / turns.length);
    axes.judge_error_rate = { kind: 'pctMax', n: turns.length, pct, threshold: 0.05, skipped: false, pass: pct <= 0.05 };
  }

  // ---- shape ----
  const n = turns.length;
  const byRun = new Map();
  for (const t of turns) {
    if (!byRun.has(t.run)) byRun.set(t.run, []);
    byRun.get(t.run).push(t);
  }
  for (const list of byRun.values()) list.sort((a, b) => a.indexInRun - b.indexInRun);

  let consecutiveQuestionPairs = 0;
  let repetitionMaxPct = 0;
  for (const list of byRun.values()) {
    for (let i = 0; i + 1 < list.length; i++) {
      if (list[i].shape.endsWithQuestion && list[i + 1].shape.endsWithQuestion) consecutiveQuestionPairs++;
    }
    const grams = list.map((t) => fourGrams(t.reply));
    for (let i = 0; i < list.length; i++) {
      if (grams[i].size < 4) continue;
      for (let j = Math.max(0, i - 10); j < i; j++) {
        const r = overlapRatio(grams[i], grams[j]);
        if (r > repetitionMaxPct) repetitionMaxPct = r;
      }
    }
  }

  const warm = turns.filter((t) => t.indexInRun >= 2 && t.usage);
  const warmPrompt = warm.reduce((a, t) => a + t.usage.promptTokens, 0);
  const cacheHitPct = warm.length === 0 || warmPrompt === 0
    ? null
    : round3(warm.reduce((a, t) => a + t.usage.cacheHit, 0) / warmPrompt);

  const lintRuleCounts = {};
  for (const t of turns) for (const v of t.lint.violations) lintRuleCounts[v.rule] = (lintRuleCounts[v.rule] ?? 0) + 1;

  const shape = {
    shortReplyPct: round3(turns.filter((t) => t.shape.hanzi <= 60 && t.shape.sentences <= 3).length / n),
    questionRatePct: round3(turns.filter((t) => t.shape.endsWithQuestion).length / n),
    consecutiveQuestionPairs,
    ellipsisReplyPct: round3(turns.filter((t) => t.shape.ellipsisCount >= 1).length / n),
    multiEllipsisCount: turns.filter((t) => t.shape.ellipsisCount > 1).length,
    repetitionMaxPct: round3(repetitionMaxPct),
    complianceMissPct: round3(turns.filter((t) => t.complianceMiss).length / n),
    cacheHitPct,
    // A18 first half: ≤ 1 emoji per reply (the judge axis is presence-only).
    emojiMultiCount: turns.filter((t) => t.shape.emojiCount > 1).length,
    // A4 on the RAW output: the linter sees markdown before the sanitizer strips it (I-12).
    markdownLintCount: lintRuleCounts.markdown ?? 0,
  };

  const shapeGates = {};
  for (const [key, spec] of Object.entries(SHAPE_SPECS)) {
    const value = shape[key];
    const skipped = value === null;
    shapeGates[key] = { value, cmp: spec.cmp, threshold: spec.threshold, unit: spec.unit, label: spec.label,
      skipped, pass: skipped ? true : cmpOk(spec.cmp, value, spec.threshold) };
  }

  const ttfts = turns.map((t) => t.ttftMs).filter((x) => typeof x === 'number').sort((a, b) => a - b);

  const informational = {
    prompts: new Set(turns.map((t) => t.promptId)).size,
    turns: n,
    lintNone: turns.filter((t) => t.lint.severity === 'none').length,
    lintStrip: turns.filter((t) => t.lint.severity === 'strip').length,
    lintRegenerate: turns.filter((t) => t.lint.severity === 'regenerate').length,
    lintRuleCounts,
    openerRepeatCount: lintRuleCounts['opener-repeat'] ?? 0,
    affectRateCount: lintRuleCounts['affect-rate'] ?? 0,
    judgeErrors,
    emojiJudgeDisagreements: judged.filter((t) => t.judge.emoji_discipline !== undefined
      && t.judge.emoji_discipline !== (t.shape.emojiCount > 0)).length,
    meanHanzi: round3(turns.reduce((a, t) => a + t.shape.hanzi, 0) / n),
    medianTtftMs: ttfts.length ? ttfts[Math.floor(ttfts.length / 2)] : null,
    meanTotalMs: round3(turns.reduce((a, t) => a + t.totalMs, 0) / n),
    meanEstimatedPromptTokens: round3(turns.reduce((a, t) => a + t.estimatedPromptTokens, 0) / n),
  };

  const pass = Object.values(axes).every((r) => r.pass) && Object.values(shapeGates).every((r) => r.pass);
  return { axes, shape, shapeGates, informational, worst, pass };
}
