// Pure statistics for the Phase 2 session probe (eval/session.mjs) and the Phase 2 evidence sheet.
// Lives in scripts/ rather than eval/ because contracts.md 1.5 keeps `eval` out of the vitest
// projects list, while `scripts` is already a project (scripts/vitest.config.mjs).

/**
 * Nearest-rank percentile. `p` is 0-100.
 * @param {number[]} values
 * @param {number} p
 * @returns {number}
 */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) throw new Error('percentile: empty sample');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/**
 * prompt_cache_hit_tokens / prompt_tokens summed over every turn numbered `fromTurn` or later (X1).
 * @param {{turn:number, promptTokens:number, cacheHit:number}[]} turns
 * @param {number} [fromTurn]
 * @returns {number}
 */
export function cacheHitRatio(turns, fromTurn = 3) {
  let hit = 0;
  let total = 0;
  for (const t of turns) {
    if (t.turn < fromTurn) continue;
    hit += t.cacheHit;
    total += t.promptTokens;
  }
  return total === 0 ? 0 : hit / total;
}

/**
 * @param {number} value
 * @param {number} threshold
 * @param {'max'|'min'} dir
 * @returns {boolean}
 */
export function verdict(value, threshold, dir) {
  return dir === 'max' ? value <= threshold : value >= threshold;
}

/**
 * One-page markdown summary of a session report.
 * @param {{startedAt:string, model:string, dry:boolean, summary:object, turns:object[]}} report
 * @returns {string}
 */
export function renderSessionMarkdown(report) {
  const s = report.summary;
  const pct = (v) => `${(v * 100).toFixed(1)} %`;
  const rows = [
    ['first-sentence close p50', `${s.firstSentenceP50} ms`, '<= 1200 ms', verdict(s.firstSentenceP50, 1200, 'max') ? 'PASS' : 'FAIL'],
    ['first-sentence close p90', `${s.firstSentenceP90} ms`, '(recorded)', '-'],
    ['first delta (TTFT) p50', `${s.ttftP50} ms`, '(recorded)', '-'],
    ['first emit after send p50', `${s.firstEmitP50} ms`, '(recorded)', '-'],
    ['prompt-cache hit, turns 3+', pct(s.cacheHitFrom3), '>= 70.0 %', verdict(s.cacheHitFrom3, 0.7, 'min') ? 'PASS' : 'FAIL'],
  ];
  return [
    `# Phase 2 session — ${report.turns.length} turns`,
    '',
    `- started: ${report.startedAt}`,
    `- model: ${report.model}`,
    `- dry: ${report.dry}`,
    '',
    '| metric | value | bar | verdict |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${r.join(' | ')} |`),
    '',
    'Notes',
    '',
    '- `first-sentence close` is measured on `StreamParser`: the moment the first sentence closes. This is the bar ruling R4 amended addendum L14 to.',
    '- `first emit after send` is when `TurnRunner` would hand sentence 0 to the bubble. contracts.md 3.11.2 holds sentence k until sentence k+1 closes, so the first painted grapheme follows the SECOND sentence. Recorded, not gated.',
    '- Cache hit is prompt_cache_hit_tokens / prompt_tokens summed over turns 3 and later (X1).',
    '',
    '| turn | prompt | first-sentence ms | ttft ms | total ms | prompt tokens | cache hit | sentences |',
    '|---|---|---|---|---|---|---|---|',
    ...report.turns.map((t) =>
      `| ${t.turn} | ${t.promptId} | ${t.firstSentenceMs ?? ''} | ${t.ttftMs ?? ''} | ${t.totalMs} | ${t.promptTokens} | ${t.cacheHit} | ${t.sentences} |`),
    '',
  ].join('\n');
}
