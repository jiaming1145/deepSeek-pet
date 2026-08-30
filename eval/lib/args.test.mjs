import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, USAGE } from './args.mjs';

test('defaults match the contract CLI', () => {
  const r = parseArgs([]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.opts, {
    dry: false, ablation: false, fixture: null, character: null, runs: 3, limit: null,
    model: 'deepseek-v4-flash', judge: 'deepseek-v4-pro', noJudge: false,
    concurrency: 4, out: null, seed: 1,
  });
});

test('--dry, --ablation and --no-judge are flags', () => {
  const r = parseArgs(['--dry', '--no-judge', '--ablation']);
  assert.equal(r.opts.dry, true);
  assert.equal(r.opts.noJudge, true);
  assert.equal(r.opts.ablation, true);
});

test('value flags are read', () => {
  const r = parseArgs(['--runs', '1', '--limit', '4', '--out', 'tmp', '--model', 'x', '--seed', '7']);
  assert.equal(r.opts.runs, 1);
  assert.equal(r.opts.limit, 4);
  assert.equal(r.opts.out, 'tmp');
  assert.equal(r.opts.model, 'x');
  assert.equal(r.opts.seed, 7);
});

test('--runs 0 is a usage error', () => {
  const r = parseArgs(['--runs', '0']);
  assert.equal(r.ok, false);
  assert.match(r.message, /必须是正整数/);
});

test('a missing value is a usage error', () => {
  const r = parseArgs(['--runs']);
  assert.equal(r.ok, false);
  assert.match(r.message, /缺参数/);
});

test('an unknown flag is a usage error that prints the usage block', () => {
  const r = parseArgs(['--nope']);
  assert.equal(r.ok, false);
  assert.match(r.message, /未知参数 --nope/);
  assert.ok(r.message.includes(USAGE));
});
