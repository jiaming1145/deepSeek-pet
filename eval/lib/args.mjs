// eval/lib/args.mjs — CLI parsing for run.mjs (contracts.md §7.1).
import { dirname, join } from 'node:path';
import { DEEPSEEK_MODEL, DEEPSEEK_JUDGE_MODEL } from '@ds/brain';

export const USAGE = `node eval/run.mjs [options]

  --dry                 用录好的回复离线跑，不联网、不需要 key
  --ablation            跑 P5/E-1 的四路人格消融实验（需要 DEEPSEEK_API_KEY）
  --fixture <path>      默认 eval/fixtures/prompts.zh.json
  --character <path>    默认 characters/haru/character.json
  --runs <n>            默认 3
  --limit <n>           只跑前 n 条（冒烟用）
  --model <id>          默认 ${DEEPSEEK_MODEL}
  --judge <id>          默认 ${DEEPSEEK_JUDGE_MODEL}
  --no-judge            只算 lint 和形状指标，跳过评审
  --concurrency <n>     默认 4
  --out <dir>           默认 eval/out
  --seed <n>            默认 1
  --persona <id>        eval/personas/<id>.json 的角色卡，默认 haru（§9.6）
  --suite <name>        memory-recall（§8.11）或 persona-bleed（§9.6 A8）；不带则跑标准 fixture
  --sessions <n>        memory-recall 的会话数，默认 5

退出码：0 = 所有生效的门槛都过了，1 = 有门槛没过（报告照样写），2 = 用法或配置错误。`;

const INT_FLAGS = new Set(['--runs', '--limit', '--concurrency', '--seed', '--sessions']);
const STR_FLAGS = new Set(['--fixture', '--character', '--model', '--judge', '--out', '--persona', '--suite']);

export function parseArgs(argv) {
  const opts = {
    dry: false, ablation: false, fixture: null, character: null, runs: 3, limit: null,
    model: DEEPSEEK_MODEL, judge: DEEPSEEK_JUDGE_MODEL, noJudge: false,
    concurrency: 4, out: null, seed: 1,
    persona: 'haru', suite: null, sessions: 5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') { opts.dry = true; continue; }
    if (a === '--ablation') { opts.ablation = true; continue; }
    if (a === '--no-judge') { opts.noJudge = true; continue; }
    if (a === '--help' || a === '-h') return { ok: false, message: USAGE };
    if (INT_FLAGS.has(a) || STR_FLAGS.has(a)) {
      const v = argv[i + 1];
      i++;
      if (v === undefined) return { ok: false, message: `${a} 后面缺参数\n\n${USAGE}` };
      if (INT_FLAGS.has(a)) {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) return { ok: false, message: `${a} 必须是正整数，收到 ${v}\n\n${USAGE}` };
        if (a === '--runs') opts.runs = n;
        else if (a === '--limit') opts.limit = n;
        else if (a === '--concurrency') opts.concurrency = n;
        else if (a === '--sessions') opts.sessions = n;
        else opts.seed = n;
      } else if (a === '--fixture') opts.fixture = v;
      else if (a === '--character') opts.character = v;
      else if (a === '--model') opts.model = v;
      else if (a === '--judge') opts.judge = v;
      else if (a === '--persona') opts.persona = v;
      else if (a === '--suite') {
        if (v !== 'memory-recall' && v !== 'persona-bleed') return { ok: false, message: `--suite 只能是 memory-recall 或 persona-bleed，收到 ${v}\n\n${USAGE}` };
        opts.suite = v;
      }
      else opts.out = v;
      continue;
    }
    return { ok: false, message: `未知参数 ${a}\n\n${USAGE}` };
  }
  return { ok: true, opts };
}

/**
 * FIX ROUND 1, finding 3. `--out` is a DIRECTORY for every suite, but `--suite memory-recall` also
 * accepts a single `.json` FILE — the brief's own Step-20 invocation is `--out out/memory-recall.json`.
 * Resolving both uses from the same string is what crashed the run: `mkdirSync(opts.out)` created a
 * DIRECTORY literally named `memory-recall.json`, and the report write then threw
 * `EISDIR: illegal operation on a directory` — after the entire paid run had completed, with the
 * results only in memory.
 *
 * @param {string|null} out       the raw --out value
 * @param {string} defaultDir     the fallback directory (eval/out)
 * @param {string} fileName       the file name to use when --out is a directory
 * @returns {{dir: string, path: string}} `dir` is the directory to create and to put scratch files
 *   (the recall sqlite) in; `path` is the report file to write. `dir` always contains `path`.
 */
export function resolveOutTarget(out, defaultDir, fileName) {
  if (out !== null && out !== undefined && out.endsWith('.json')) return { dir: dirname(out), path: out };
  const dir = out ?? defaultDir;
  return { dir, path: join(dir, fileName) };
}
