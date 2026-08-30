import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecordedClient, runSeed, mulberry32 } from './recorded.mjs';
import { pool } from './turn.mjs';
import { runAblation } from './ablation.mjs';

const REPLIES = {
  a: '今天有点困，不过还能撑一会儿。你呢？',
  b: '米饭。别问，问就是米饭。',
  c: '尾鳍拍了拍水面，算是打招呼。',
};

async function chunkSizes(client, ids) {
  const out = [];
  for (const id of ids) {
    const sizes = [];
    for await (const ev of client.streamFor(id)) if (ev.kind === 'delta') sizes.push(ev.text.length);
    out.push(sizes);
  }
  return out;
}

/** Mirrors run.mjs: one client per run, runs in a pool with the given concurrency. */
async function chunkingUnder(concurrency, seed, runs) {
  const ids = Object.keys(REPLIES);
  return pool(Array.from({ length: runs }, (_, i) => i), concurrency, async (runIndex) => {
    const client = new RecordedClient({ replies: REPLIES, seed, runIndex });
    // Interleave with other runs: yield between prompts so a shared PRNG would be observed.
    const out = [];
    for (const id of ids) {
      await new Promise((r) => setImmediate(r));
      out.push((await chunkSizes(client, [id]))[0]);
    }
    return out;
  });
}

test('seed=1: concurrency 1 and 4 yield identical chunk boundaries for every run (CX-13)', async () => {
  const seq = await chunkingUnder(1, 1, 4);
  const par = await chunkingUnder(4, 1, 4);
  assert.deepEqual(par, seq);
  // and the chunks really cover the text
  for (const run of seq) for (const [i, sizes] of run.entries()) assert.equal(sizes.reduce((a, b) => a + b, 0), Object.values(REPLIES)[i].length);
});

test('different runs get different PRNG streams from the same global seed', () => {
  assert.notEqual(runSeed(1, 0), runSeed(1, 1));
  assert.notEqual(runSeed(1, 0), runSeed(2, 0));
  const a = mulberry32(runSeed(1, 0))();
  const b = mulberry32(runSeed(1, 1))();
  assert.notEqual(a, b);
});

test('the same (seed, runIndex) is byte-stable across constructions', async () => {
  const x = await chunkSizes(new RecordedClient({ replies: REPLIES, seed: 7, runIndex: 2 }), ['a', 'b', 'c']);
  const y = await chunkSizes(new RecordedClient({ replies: REPLIES, seed: 7, runIndex: 2 }), ['a', 'b', 'c']);
  assert.deepEqual(x, y);
});

test('runAblation surfaces a stalled arm as { ok:false } instead of hanging (CX-11)', async () => {
  const neverResolves = () => new Promise(() => {});
  const staticSystem = '【PERSONA_LOAD】 WHALE_GIRL\n\n中文展开。';
  const r = await runAblation({ apiKey: 'x', staticSystem, fetchImpl: neverResolves, timeoutMs: 30 });
  assert.equal(r.ok, false);
  assert.match(r.message, /^marker-only: /);
  assert.match(r.message, /timeout|abort/i);
});
