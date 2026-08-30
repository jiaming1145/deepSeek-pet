import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseCharacterBundle, renderStaticSystem,
  cardTokens, CARD_TOKEN_BUDGET, staticSystemTokens, STATIC_SYSTEM_TOKEN_BUDGET,
} from '@ds/brain';
import { loadFixture, validateFixture } from './fixture.mjs';
import { RecordedClient } from './recorded.mjs';
import { runTurn } from './turn.mjs';
import { aggregate, axesFor } from './aggregate.mjs';

const fixturePath = fileURLToPath(new URL('../fixtures/prompts.zh.json', import.meta.url));
const repliesPath = fileURLToPath(new URL('../recorded/replies.zh.json', import.meta.url));
const judgementsPath = fileURLToPath(new URL('../recorded/judgements.json', import.meta.url));
const characterPath = fileURLToPath(new URL('../../characters/haru/character.json', import.meta.url));

const fixture = loadFixture(fixturePath);
const recorded = JSON.parse(readFileSync(repliesPath, 'utf8'));
const judgements = JSON.parse(readFileSync(judgementsPath, 'utf8'));
const bundle = parseCharacterBundle(JSON.parse(readFileSync(characterPath, 'utf8')));
const motionKeys = Object.keys(bundle.motionMap);
const staticSystem = renderStaticSystem(bundle.card, motionKeys);

function recordedJudgement(prompt) {
  const merged = { ...judgements.default, ...(judgements.overrides[prompt.id] ?? {}) };
  const out = {};
  for (const key of axesFor(prompt)) if (merged[key] !== undefined) out[key] = merged[key];
  return out;
}

async function runAll() {
  const ctx = {
    dry: true,
    client: new RecordedClient({ replies: recorded.replies, seed: 1 }),
    staticSystem,
    postHistoryInstructions: bundle.card.post_history_instructions,
    recent: [],
  };
  const turns = [];
  for (const [i, prompt] of fixture.prompts.entries()) {
    const t = await runTurn({ prompt, runIndex: 0, indexInRun: i, ctx });
    t.judge = recordedJudgement(prompt);
    turns.push(t);
  }
  return turns;
}

test('the shipped fixture satisfies R8 and its own mix', () => {
  const v = validateFixture(fixture);
  assert.equal(v.ok, true, v.message);
  assert.equal(fixture.prompts.length, 46);
});

test('the shipped card and the whole static block each fit their own budget', () => {
  // §3.7.4: cardTokens takes ONE argument (persona sections, cap 700); the whole rendered block
  // is staticSystemTokens(card, motionKeys, mode?) (cap 1100). Do not pass motionKeys to cardTokens.
  const card = cardTokens(bundle.card);
  const whole = staticSystemTokens(bundle.card, motionKeys);
  assert.ok(card <= CARD_TOKEN_BUDGET, `cardTokens=${card} > ${CARD_TOKEN_BUDGET}`);
  assert.ok(whole <= STATIC_SYSTEM_TOKEN_BUDGET, `staticSystemTokens=${whole} > ${STATIC_SYSTEM_TOKEN_BUDGET}`);
});

test('every prompt has a recorded reply that opens with an ACT tag', () => {
  for (const p of fixture.prompts) {
    const raw = recorded.replies[p.id];
    assert.equal(typeof raw, 'string', `${p.id} 缺录制回复`);
    assert.ok(raw.startsWith('<|ACT '), `${p.id} 没有以 ACT 标记开头`);
  }
});

test('every category axis has a recorded judgement', () => {
  for (const p of fixture.prompts) {
    const j = recordedJudgement(p);
    for (const key of axesFor(p)) assert.notEqual(j[key], undefined, `${p.id} 的 ${key} 没有录制判定`);
  }
});

test('the recorded corpus passes every local gate', async () => {
  const turns = await runAll();
  const r = aggregate(turns, { noJudge: true });
  assert.equal(r.pass, true, JSON.stringify(r.shapeGates, null, 2));
  assert.equal(r.informational.lintRegenerate, 0, JSON.stringify(r.informational.lintRuleCounts));
});

test('the recorded corpus passes every judge gate too', async () => {
  const turns = await runAll();
  const r = aggregate(turns, { noJudge: false });
  assert.equal(r.pass, true, JSON.stringify(r.axes, null, 2));
});

test('no recorded reply trips the ACT-compliance check', async () => {
  const turns = await runAll();
  assert.equal(turns.filter((t) => t.complianceMiss).length, 0);
});
