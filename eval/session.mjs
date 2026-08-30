// Phase 2 session probe: one continuous 20-turn conversation against the real DeepSeek API.
//
// It measures the two bars that only a *session* can prove, and that eval/run.mjs cannot:
//   R4 - the first sentence closes <= 1200 ms p50 after the request is dispatched
//   X1 - prompt_cache_hit_tokens / prompt_tokens >= 70 % from turn 3 on
//
// It drives StreamParser directly instead of TurnRunner on purpose: contracts.md 3.11.2 holds
// sentence k until sentence k+1 closes, so TurnRunner's `sentence` event would time the SECOND
// sentence. That lookahead cost is recorded separately as firstEmitMs, with no threshold.
//
//   node session.mjs [--dry] [--turns 20] [--fixture <p>] [--character <p>] [--out <dir>]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DeepSeekClient,
  StreamParser,
  assemblePrompt,
  parseCharacterBundle,
  renderStaticSystem,
  sanitizeForDisplay,
} from '@ds/brain';
import { cacheHitRatio, percentile, renderSessionMarkdown } from '../scripts/phase2-stats.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && typeof argv[i + 1] === 'string' ? argv[i + 1] : fallback;
};

const DRY = flag('dry');
const TURNS = Number(opt('turns', '20'));
const FIXTURE = resolve(REPO, opt('fixture', 'eval/fixtures/prompts.zh.json'));
const CHARACTER = resolve(REPO, opt('character', 'characters/haru/character.json'));
const OUT_DIR = resolve(REPO, opt('out', 'eval/out'));

const apiKey = process.env.DEEPSEEK_API_KEY ?? '';
if (!DRY && apiKey.length < 8) {
  console.error('DEEPSEEK_API_KEY 没设置。加 --dry 跑离线检查，或者设置环境变量后重跑。');
  process.exit(2);
}

const bundle = parseCharacterBundle(JSON.parse(readFileSync(CHARACTER, 'utf8')));
const staticSystem = renderStaticSystem(bundle.card, Object.keys(bundle.motionMap));

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const prompts = fixture.prompts.slice(0, TURNS);
if (prompts.length < TURNS) {
  console.error(`fixture has ${fixture.prompts.length} prompts, need ${TURNS}`);
  process.exit(2);
}

function makeFakeClient() {
  let turn = 0;
  return {
    async *stream() {
      turn += 1;
      const text = '<|ACT emotion=neutral|>嗯，我在。今天有点困，你说吧。';
      for (const ch of text) yield { kind: 'delta', text: ch };
      const promptTokens = 600 + turn * 40;
      const cacheHit = turn <= 2 ? 0 : Math.floor((promptTokens * 0.8) / 64) * 64;
      yield { kind: 'usage', usage: { promptTokens, cacheHit, cacheMiss: promptTokens - cacheHit, completionTokens: 24 } };
      yield { kind: 'done' };
    },
  };
}

const client = DRY ? makeFakeClient() : new DeepSeekClient({ apiKey });

const hm = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const wd = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' });
const stateNow = () => {
  const d = new Date();
  return { localTime: hm.format(d), weekday: wd.format(d), mood: 0.1, energy: 70, affection: 50, sinceLastChat: '刚刚' };
};

const startedAt = new Date().toISOString();
/** @type {{role:'user'|'assistant', content:string}[]} */
const history = [];
const turns = [];

for (let i = 0; i < prompts.length; i++) {
  const prompt = prompts[i];
  const messages = assemblePrompt({
    staticSystem,
    postHistoryInstructions: bundle.card.post_history_instructions,
    summary: '',
    facts: [],
    history,
    state: stateNow(),
    userText: prompt.text,
  });

  const parser = new StreamParser(`session-${i + 1}`);
  const ac = new AbortController();
  const t0 = Date.now();
  let ttftMs = null;
  let firstSentenceMs = null;
  let firstEmitMs = null;
  let usage = null;
  let closed = 0;
  const shown = [];

  const take = (events) => {
    for (const ev of events) {
      closed += 1;
      if (closed === 1) firstSentenceMs = Date.now() - t0;
      if (closed === 2 && firstEmitMs === null) firstEmitMs = Date.now() - t0;
      shown.push(sanitizeForDisplay(ev.text));
    }
  };

  for await (const chunk of client.stream({ messages }, ac.signal)) {
    if (chunk.kind === 'delta') {
      if (ttftMs === null) ttftMs = Date.now() - t0;
      take(parser.push(chunk.text));
    } else if (chunk.kind === 'usage') {
      usage = chunk.usage;
    }
  }
  take(parser.flush());

  const totalMs = Date.now() - t0;
  if (firstEmitMs === null) firstEmitMs = totalMs; // a one-sentence reply is emitted at stream end
  const reply = shown.join('');
  history.push({ role: 'user', content: prompt.text }, { role: 'assistant', content: reply });

  turns.push({
    turn: i + 1,
    promptId: prompt.id,
    userText: prompt.text,
    reply,
    promptTokens: usage?.promptTokens ?? 0,
    cacheHit: usage?.cacheHit ?? 0,
    cacheMiss: usage?.cacheMiss ?? 0,
    completionTokens: usage?.completionTokens ?? 0,
    ttftMs,
    firstSentenceMs,
    firstEmitMs,
    totalMs,
    sentences: closed,
    complianceMiss: parser.complianceMiss,
  });

  console.log(`turn ${i + 1}/${prompts.length}  first-sentence ${firstSentenceMs} ms  cache ${usage?.cacheHit ?? 0}/${usage?.promptTokens ?? 0}  ${reply.slice(0, 20)}`);
}

const firstSentences = turns.map((t) => t.firstSentenceMs).filter((v) => typeof v === 'number');
const report = {
  version: 1,
  dry: DRY,
  startedAt,
  model: DRY ? 'fake' : 'deepseek-v4-flash',
  turns,
  summary: {
    firstSentenceP50: percentile(firstSentences, 50),
    firstSentenceP90: percentile(firstSentences, 90),
    ttftP50: percentile(turns.map((t) => t.ttftMs ?? t.totalMs), 50),
    firstEmitP50: percentile(turns.map((t) => t.firstEmitMs), 50),
    cacheHitFrom3: cacheHitRatio(turns, 3),
  },
};
report.pass = report.summary.firstSentenceP50 <= 1200 && report.summary.cacheHitFrom3 >= 0.7;

const now = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}`;
mkdirSync(OUT_DIR, { recursive: true });
const jsonPath = join(OUT_DIR, `session-${stamp}.json`);
const mdPath = join(OUT_DIR, `session-${stamp}.md`);
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(mdPath, renderSessionMarkdown(report), 'utf8');

console.log(`session: ${turns.length} turns, first-sentence p50 = ${report.summary.firstSentenceP50} ms (bar 1200), cache-hit from turn 3 = ${(report.summary.cacheHitFrom3 * 100).toFixed(1)} % (bar 70)`);
console.log(`wrote ${jsonPath}`);
console.log(`wrote ${mdPath}`);

process.exit(DRY ? 0 : report.pass ? 0 : 1);
