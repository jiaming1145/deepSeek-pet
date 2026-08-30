#!/usr/bin/env node
// eval/run.mjs — Phase 2 eval harness (contracts.md §7).
// Offline: node run.mjs --dry     Online: DEEPSEEK_API_KEY=... node run.mjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEEPSEEK_BASE_URL, DeepSeekClient,
  parseCharacterBundle, renderStaticSystem, cardTokens, staticSystemTokens,
} from '@ds/brain';
import { parseArgs } from './lib/args.mjs';
import { loadFixture, validateFixture } from './lib/fixture.mjs';
import { RecordedClient } from './lib/recorded.mjs';
import { runTurn, pool } from './lib/turn.mjs';
import { aggregate, axesFor } from './lib/aggregate.mjs';
import { loadJudge, buildJudgeSystem, buildJudgeUser, judgeTurn } from './lib/judge.mjs';
import { writeReports, stampFrom } from './lib/report.mjs';
import { runAblation, renderAblationMarkdown } from './lib/ablation.mjs';

const HERE = new URL('./', import.meta.url);
const DEFAULT_FIXTURE = fileURLToPath(new URL('fixtures/prompts.zh.json', HERE));
const DEFAULT_CHARACTER = fileURLToPath(new URL('../characters/haru/character.json', HERE));
const DEFAULT_OUT = fileURLToPath(new URL('out/', HERE));
const JUDGE_PATH = fileURLToPath(new URL('judge.md', HERE));
const RECORDED_REPLIES = fileURLToPath(new URL('recorded/replies.zh.json', HERE));
const RECORDED_JUDGEMENTS = fileURLToPath(new URL('recorded/judgements.json', HERE));

const NO_KEY_MESSAGE = 'DEEPSEEK_API_KEY 没设置。加 --dry 跑离线检查，或者设置环境变量后重跑。';

function fail(message, code) {
  console.error(message);
  process.exit(code);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) fail(parsed.message, 2);
  const opts = parsed.opts;

  const fixturePath = opts.fixture ?? DEFAULT_FIXTURE;
  const characterPath = opts.character ?? DEFAULT_CHARACTER;
  const outDir = opts.out ?? DEFAULT_OUT;

  let bundle;
  try {
    bundle = parseCharacterBundle(JSON.parse(readFileSync(characterPath, 'utf8')));
  } catch (err) {
    fail(`读不了角色文件 ${characterPath}\n${err.message}`, 2);
  }
  const motionKeys = Object.keys(bundle.motionMap);
  const staticSystem = renderStaticSystem(bundle.card, motionKeys);
  const startedAt = new Date().toISOString();

  // ---- P5 / E-1 ablation ----
  if (opts.ablation) {
    if (opts.dry) fail('--ablation 是一个联网实验，不能和 --dry 一起用。', 2);
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) fail(NO_KEY_MESSAGE, 2);
    const r = await runAblation({ apiKey, model: opts.model, baseUrl: DEEPSEEK_BASE_URL, staticSystem });
    if (!r.ok) fail(r.message, 1);
    const report = { version: 1, startedAt, ...r };
    mkdirSync(outDir, { recursive: true });
    const stamp = `${stampFrom(startedAt)}-ablation`;
    writeFileSync(join(outDir, `${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    writeFileSync(join(outDir, `${stamp}.md`), renderAblationMarkdown(report), 'utf8');
    console.log(`消融实验写到 ${join(outDir, `${stamp}.md`)}`);
    process.exit(0);
  }

  // ---- fixture ----
  let fixture;
  try {
    fixture = loadFixture(fixturePath);
  } catch (err) {
    fail(`读不了 fixture ${fixturePath}\n${err.message}`, 2);
  }
  if (opts.limit === null) {
    const v = validateFixture(fixture);
    if (!v.ok) fail(`fixture 不合格：${v.message}`, 2);
  }
  const prompts = opts.limit === null ? fixture.prompts : fixture.prompts.slice(0, opts.limit);
  if (prompts.length === 0) fail('没有可跑的 prompt。', 2);

  // ---- client ----
  let client;
  let recordedJudgements = null;
  if (opts.dry) {
    const recorded = JSON.parse(readFileSync(RECORDED_REPLIES, 'utf8'));
    client = new RecordedClient({ replies: recorded.replies, seed: opts.seed });
    for (const p of prompts) {
      if (!client.has(p.id)) fail(`--dry 缺 ${p.id} 的录制回复（eval/recorded/replies.zh.json）`, 2);
    }
    recordedJudgements = JSON.parse(readFileSync(RECORDED_JUDGEMENTS, 'utf8'));
  } else {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) fail(NO_KEY_MESSAGE, 2);
    client = new DeepSeekClient({ apiKey, model: opts.model, baseUrl: DEEPSEEK_BASE_URL });
  }

  // ---- model pass: runs in parallel, each run sequential so `recent` is well-defined ----
  const runIndices = Array.from({ length: opts.runs }, (_, i) => i);
  const perRun = await pool(runIndices, opts.concurrency, async (runIndex) => {
    const ctx = {
      dry: opts.dry,
      client,
      staticSystem,
      postHistoryInstructions: bundle.card.post_history_instructions,
      recent: [],
    };
    const out = [];
    for (const [i, prompt] of prompts.entries()) {
      out.push(await runTurn({ prompt, runIndex, indexInRun: i, ctx }));
      process.stderr.write(`\r跑到 run ${runIndex} · ${i + 1}/${prompts.length}   `);
    }
    return out;
  });
  process.stderr.write('\n');
  const turns = perRun.flat();
  const byId = new Map(prompts.map((p) => [p.id, p]));

  // ---- judge pass ----
  const judgeDoc = loadJudge(JUDGE_PATH);
  if (!opts.noJudge) {
    if (opts.dry) {
      for (const t of turns) {
        const prompt = byId.get(t.promptId);
        const merged = { ...recordedJudgements.default, ...(recordedJudgements.overrides[t.promptId] ?? {}) };
        const value = {};
        let missing = null;
        for (const key of axesFor(prompt)) {
          if (merged[key] === undefined) { missing = key; break; }
          value[key] = merged[key];
        }
        if (missing) { t.judge = null; t.judgeError = true; }
        else t.judge = value;
      }
    } else {
      const system = buildJudgeSystem(judgeDoc.body, bundle.card);
      const apiKey = process.env.DEEPSEEK_API_KEY;
      let done = 0;
      await pool(turns, opts.concurrency, async (t) => {
        const prompt = byId.get(t.promptId);
        const axes = axesFor(prompt);
        const user = buildJudgeUser(prompt, t.reply, axes, bundle.card.name);
        const r = await judgeTurn({ baseUrl: DEEPSEEK_BASE_URL, apiKey, model: opts.judge, system, user, axes });
        if (r.ok) t.judge = r.value;
        else { t.judge = null; t.judgeError = true; console.error(`\n评审失败 ${t.promptId} run ${t.run}：${r.message}`); }
        done++;
        process.stderr.write(`\r评审 ${done}/${turns.length}   `);
      });
      process.stderr.write('\n');
    }
  }

  // ---- aggregate + report ----
  const { axes, shape, shapeGates, informational, worst, pass } = aggregate(turns, { noJudge: opts.noJudge });
  const report = {
    version: 1,
    startedAt,
    config: {
      model: opts.model,
      judge: opts.judge,
      runs: opts.runs,
      fixture: fixturePath,
      character: characterPath,
      judgeVersion: judgeDoc.version,
      cardTokens: cardTokens(bundle.card),
      staticSystemTokens: staticSystemTokens(bundle.card, motionKeys),
      dry: opts.dry,
      limit: opts.limit,
      concurrency: opts.concurrency,
      seed: opts.seed,
      shuffled: false,
      noJudge: opts.noJudge,
    },
    turns,
    axes,
    shape,
    shapeGates,
    informational,
    worst,
    pass,
  };
  const { jsonPath, mdPath } = writeReports(outDir, report);

  for (const [key, row] of Object.entries(axes)) {
    if (!row.skipped && !row.pass) console.log(`FAIL  轴 ${key}`);
  }
  for (const [key, row] of Object.entries(shapeGates)) {
    if (!row.skipped && !row.pass) console.log(`FAIL  形状 ${key} = ${row.value}`);
  }
  console.log(`${report.informational.turns} 轮，总判定 ${pass ? 'PASS' : 'FAIL'}`);
  console.log(jsonPath);
  console.log(mdPath);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
