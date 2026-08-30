/**
 * B-12 (contracts §12.7): "the §0.3 control corpus + 我腰疼, 咖啡, 医院 | 腰疼 and 咖啡 retrieve
 * through the alias column; 医院 returns nothing; the unigram fallback fires only when pass 1
 * returns < 3". Data only — the runner is `fts-paraphrase.test.ts` beside it.
 *
 * B-12 tests the MECHANISM, never A11's threshold (R3-32). It is deliberately NOT the recall
 * fixture: `eval/fixtures/memory-recall.zh.json` is the 20-fact suite, blocked on account balance.
 */
export interface PlantedFact {
  key: string;
  value: string;
  alias: string[];
  confidence: number;
  /** ms since epoch; the fixture's clock is 2026-08-30T12:00:00+08:00 minus the offset below. */
  agedHours: number;
}

/** The three-row control corpus §0.3 records real bm25 scores for. */
export const B12_CORPUS: readonly PlantedFact[] = [
  {
    key: 'job_interview',
    value: '主人下周三要去杭州面试',
    alias: ['面试', '工作', 'offer'],
    confidence: 0.9,
    agedHours: 0,
  },
  {
    key: 'health_back',
    value: '主人最近腰不太好，久坐会痛',
    alias: ['腰疼', '健康', '久坐'],
    confidence: 0.9,
    agedHours: 0,
  },
  {
    key: 'drink_coffee',
    value: '主人喜欢喝冰美式',
    alias: ['咖啡', '冰美式', '饮料'],
    confidence: 0.9,
    agedHours: 0,
  },
];

export interface B12Probe {
  ask: string;
  /** The `facts.key` the probe must retrieve, or null when nothing may come back. */
  expectKey: string | null;
  /** Which column carried the hit — 'value' or 'alias'. Documentation for the reviewer. */
  via: 'value' | 'alias' | null;
  /** True when pass 1 returns < FACT_FALLBACK_MIN_HITS and the unigram pass must therefore run. */
  expectFallback: boolean;
}

export const B12_PROBES: readonly B12Probe[] = [
  { ask: '面试', expectKey: 'job_interview', via: 'value', expectFallback: true },
  { ask: '腰疼', expectKey: 'health_back', via: 'alias', expectFallback: true },
  { ask: '咖啡', expectKey: 'drink_coffee', via: 'alias', expectFallback: true },
  { ask: '我腰疼', expectKey: 'health_back', via: 'alias', expectFallback: true },
  { ask: '医院', expectKey: null, via: null, expectFallback: true },
];

/** The wall clock every B-12 assertion runs at (recency factor 0.995^0 = 1). */
export const B12_NOW = Date.parse('2026-08-30T04:00:00.000Z');
