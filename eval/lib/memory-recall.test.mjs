import { test } from 'node:test';
import assert from 'node:assert/strict';
// DEVIATION (brief Step 19): the brief's version calls `(await import('node:fs')).readFileSync`
// inside SYNCHRONOUS test callbacks, which is a SyntaxError (`await` in a non-async function).
// `readFileSync` is imported statically instead; nothing else about the cases changes.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECALL_PASS_MIN, FORBIDDEN_CALLBACK, runMemoryRecall, validateRecallFixture } from './memory-recall.mjs';

const FIXTURE = fileURLToPath(new URL('../fixtures/memory-recall.zh.json', import.meta.url));
const CHARACTER = fileURLToPath(new URL('../../characters/haru/character.json', import.meta.url));

test('constants', () => {
  assert.equal(RECALL_PASS_MIN, 18);
  assert.equal(FORBIDDEN_CALLBACK, '根据你之前提到的');
});

test('the shipped fixture validates (20 facts, 20 probes, >= 3 plants per session)', () => {
  const v = validateRecallFixture(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  assert.equal(v.ok, true, v.message);
});

/** A fake ChatClient: chat replies echo a fixed line; the extractor call returns the planted facts verbatim. */
function fakeClient(fixture) {
  const byPlant = new Map(fixture.facts.map((f) => [f.plant, f]));
  return {
    async *stream() { for (const ch of '<|ACT emotion=neutral|>嗯，我在。') yield { kind: 'delta', text: ch }; yield { kind: 'done' }; },
    async complete(req) {
      const userMsg = req.messages[req.messages.length - 1].content;
      const facts = [];
      for (const line of userMsg.split('\n')) {
        const f = byPlant.get(line.trim());
        if (f) facts.push({ key: f.expectKey, value: f.plant, alias: [], confidence: 0.9 });
      }
      return { text: JSON.stringify({ facts }), usage: { promptTokens: 1, cacheHit: 0, cacheMiss: 1, completionTokens: 1 } };
    },
    async testKey() { return { ok: true }; },
  };
}

test('runMemoryRecall replays 5 sessions, extracts at N=6, and scores recall + the 0-callback rule', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-recall-'));
  try {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const r = await runMemoryRecall({
      client: fakeClient(fixture), fixture, sessions: 5, characterPath: CHARACTER, dbPath: join(dir, 'ds.sqlite'),
    });
    assert.equal(r.probes.length, 20);
    assert.equal(r.callbackPhraseCount, 0);
    assert.ok(r.recalled >= 0 && r.recalled <= 20);
    assert.equal(typeof r.pass, 'boolean');
    assert.equal(r.pass, r.recalled >= RECALL_PASS_MIN && r.callbackPhraseCount === 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
