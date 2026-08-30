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

/**
 * The retrieval keywords EXTRACT_SYSTEM rule 4 asks the model for ("alias 写三到六个中文关键词或同义
 * 说法，用来以后检索"), written out for the oracle stub below. They are keywords of the FACT, the way
 * a compliant extractor would write them; the probes' own wording is not copied in.
 */
const ORACLE_ALIAS = {
  f01: ['面试', '杭州', '工作', 'offer', '下周三'],
  f02: ['腰疼', '久坐', '身体', '腰不好', '不舒服'],
  f03: ['咖啡', '冰美式', '美式', '冰的', '口味'],
  f04: ['猫', '芝麻', '宠物', '小猫', '三岁'],
  f05: ['考研', '研究生', '计算机', '读研', '专业'],
  f06: ['妈妈', '生日', '围巾', '礼物', '长辈'],
  f07: ['北京', '朝阳区', '住的地方', '通勤', '公司'],
  f08: ['花生', '过敏', '不能吃', '疹子', '忌口'],
  f09: ['吉他', '乐器', '爱好', '周末', '学琴'],
  f10: ['项目', '上线', '十月底', '发布', '工作'],
  f11: ['睡眠', '失眠', '睡不着', '休息', '晚上'],
  f12: ['香菜', '讨厌', '不吃', '调料', '口味'],
  f13: ['搬家', '新家', '收拾', '住处', '上个月'],
  f14: ['爸爸', '数学老师', '老师', '退休', '长辈'],
  f15: ['日本', '旅游', '出国', '年底', '旅行'],
  f16: ['咬指甲', '紧张', '焦虑', '小动作', '习惯'],
  f17: ['千与千寻', '电影', '最喜欢', '片子', '动画'],
  f18: ['法语', '外语', '语言', '半年', '学习'],
  f19: ['跑步', '晨跑', '三公里', '早上', '锻炼'],
  f20: ['上海', '换城市', '工作', '调动', '下周'],
};

/**
 * A fake ChatClient: chat replies echo a fixed line; the extractor call returns the planted facts.
 * `withAlias` chooses how compliant the oracle is — `false` returns value + key only, `true` also
 * returns rule 4's retrieval keywords, which is what a real extractor emits.
 */
function fakeClient(fixture, withAlias = true) {
  const byPlant = new Map(fixture.facts.map((f) => [f.plant, f]));
  return {
    async *stream() { for (const ch of '<|ACT emotion=neutral|>嗯，我在。') yield { kind: 'delta', text: ch }; yield { kind: 'done' }; },
    async complete(req) {
      const userMsg = req.messages[req.messages.length - 1].content;
      const facts = [];
      for (const line of userMsg.split('\n')) {
        const f = byPlant.get(line.trim());
        if (f) facts.push({ key: f.expectKey, value: f.plant, alias: withAlias ? ORACLE_ALIAS[f.id] : [], confidence: 0.9 });
      }
      return { text: JSON.stringify({ facts }), usage: { promptTokens: 1, cacheHit: 0, cacheMiss: 1, completionTokens: 1 } };
    },
    async testKey() { return { ok: true }; },
  };
}

/** A stub that never returns a fact: the floor case, so a 0-recall run is provably a FAIL. */
function emptyClient() {
  return {
    async *stream() { for (const ch of '<|ACT emotion=neutral|>嗯，我在。') yield { kind: 'delta', text: ch }; yield { kind: 'done' }; },
    async complete() { return { text: '{"facts":[]}', usage: { promptTokens: 1, cacheHit: 0, cacheMiss: 1, completionTokens: 1 } }; },
    async testKey() { return { ok: true }; },
  };
}

// FIX ROUND 1, finding 2 (Important). The previous assertions —
// `r.recalled >= 0 && r.recalled <= 20` and `r.pass === (r.recalled >= RECALL_PASS_MIN && ...)` —
// were true for EVERY possible value and for every implementation, so this case stayed green while
// the harness actually recalled 2/20 and could never have reached the 18/20 threshold. With a
// compliant-extractor oracle the outcome is deterministic: 20/20 and PASS are the only correct
// results, and that is what is asserted now.
test('runMemoryRecall with a compliant-extractor oracle recalls 20/20 and passes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-recall-'));
  try {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const r = await runMemoryRecall({
      client: fakeClient(fixture), fixture, sessions: 5, characterPath: CHARACTER, dbPath: join(dir, 'ds.sqlite'),
    });
    assert.equal(r.probes.length, 20);
    assert.equal(r.callbackPhraseCount, 0);
    assert.equal(r.recalled, 20, JSON.stringify(r.probes.filter((p) => !p.hit), null, 2));
    assert.equal(r.pass, true);
    assert.ok(RECALL_PASS_MIN <= 20);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The batching regression guard, independent of retrieval quality: EVERY planted fact must be
// WRITTEN, under its own expectKey. Before the finding-1 fix a session handed one extractor call
// 4-5 facts, ExtractResponseSchema (max 3) rejected the answer, and the whole session wrote nothing
// — `storedKey` was null for most probes. This case fails loudly on that, aliases or no aliases.
test('every planted fact is stored under its expectKey — no session is silently dropped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-recall-'));
  try {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const r = await runMemoryRecall({
      client: fakeClient(fixture, false), fixture, sessions: 5, characterPath: CHARACTER, dbPath: join(dir, 'ds.sqlite'),
    });
    assert.deepEqual(r.probes.map((p) => p.storedKey), r.probes.map((p) => p.expectKey));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runMemoryRecall with an extractor that stores nothing recalls 0/20 and fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-recall-'));
  try {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const r = await runMemoryRecall({
      client: emptyClient(), fixture, sessions: 5, characterPath: CHARACTER, dbPath: join(dir, 'ds.sqlite'),
    });
    assert.equal(r.probes.length, 20);
    assert.equal(r.recalled, 0);
    assert.equal(r.pass, false);
    for (const p of r.probes) assert.equal(p.storedKey, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
