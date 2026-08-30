import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, resolveOutTarget, USAGE } from './args.mjs';

test('defaults match the contract CLI', () => {
  const r = parseArgs([]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.opts, {
    dry: false, ablation: false, fixture: null, character: null, runs: 3, limit: null,
    model: 'deepseek-v4-flash', judge: 'deepseek-v4-pro', noJudge: false,
    concurrency: 4, out: null, seed: 1,
    persona: 'haru', suite: null, sessions: 5,
  });
});

test('--persona, --suite and --sessions (Phase 3 §9.6 / §8.11)', () => {
  const r = parseArgs(['--persona', 'quiet', '--suite', 'memory-recall', '--sessions', '3']);
  assert.equal(r.opts.persona, 'quiet');
  assert.equal(r.opts.suite, 'memory-recall');
  assert.equal(r.opts.sessions, 3);
});

test('an unknown --suite is a usage error', () => {
  const r = parseArgs(['--suite', 'nope']);
  assert.equal(r.ok, false);
  assert.match(r.message, /--suite 只能是 memory-recall 或 persona-bleed/);
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

// FIX ROUND 1, finding 3 (Important). `--suite memory-recall --out out/memory-recall.json` used to
// treat the same string as BOTH the directory to create and the file to write: `mkdirSync` made a
// directory named `memory-recall.json`, then `writeFileSync` threw EISDIR — after the whole paid
// run had finished, losing the results. These cases pin the split and then perform run.mjs's own
// mkdir + write sequence, which is what actually threw.
test('resolveOutTarget splits the directory to create from the file to write', () => {
  assert.deepEqual(resolveOutTarget(null, '/def', 'r.json'), { dir: '/def', path: join('/def', 'r.json') });
  assert.deepEqual(resolveOutTarget('/some/dir', '/def', 'r.json'), { dir: '/some/dir', path: join('/some/dir', 'r.json') });
  const f = resolveOutTarget(join('out', 'memory-recall.json'), '/def', 'r.json');
  assert.equal(f.path, join('out', 'memory-recall.json'));
  assert.equal(f.dir, 'out');
  assert.notEqual(f.dir, f.path);
  assert.equal(resolveOutTarget('bare.json', '/def', 'r.json').dir, '.');
});

test('run.mjs mkdir-then-write succeeds for a --out file and for a --out directory', () => {
  const base = mkdtempSync(join(tmpdir(), 'ds-out-'));
  try {
    for (const out of [join(base, 'a', 'memory-recall.json'), join(base, 'b'), null]) {
      const { dir, path } = resolveOutTarget(out, join(base, 'def'), 'stamp-memory-recall.json');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, '{}', 'utf8');            // threw EISDIR before the fix
      writeFileSync(join(dir, 'memory-recall.sqlite'), '', 'utf8');
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
