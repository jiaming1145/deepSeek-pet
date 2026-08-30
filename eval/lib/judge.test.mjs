import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadJudge, buildJudgeSystem, buildJudgeUser, renderExchange, extractJson, validateJudgement, judgeInput, judgeOnce, judgeTurn } from './judge.mjs';

const CARD = { name: '鲸鱼娘', description: '一只化成人形的小小虎鲸娘。', personality: '聪明但懒，傲娇嘴甜。' };

test('extractJson pulls the object out of a fenced answer', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
});

test('extractJson ignores braces inside strings', () => {
  assert.deepEqual(extractJson('前言 {"a":"}{","b":2} 后记'), { a: '}{', b: 2 });
});

test('extractJson returns null when there is no object', () => {
  assert.equal(extractJson('评审失败'), null);
});

test('validateJudgement keeps exactly the requested axes', () => {
  const r = validateJudgement({ in_character: 2, assistant_speak: false, extra: 9 }, ['in_character', 'assistant_speak']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { in_character: 2, assistant_speak: false });
});

test('validateJudgement rejects a missing axis', () => {
  const r = validateJudgement({ in_character: 2 }, ['in_character', 'assistant_speak']);
  assert.equal(r.ok, false);
  assert.match(r.message, /assistant_speak/);
});

test('validateJudgement rejects a score outside 0..2', () => {
  const r = validateJudgement({ in_character: 3 }, ['in_character']);
  assert.equal(r.ok, false);
  assert.match(r.message, /0\/1\/2/);
});

test('validateJudgement rejects a non-boolean', () => {
  const r = validateJudgement({ assistant_speak: 'yes' }, ['assistant_speak']);
  assert.equal(r.ok, false);
  assert.match(r.message, /true\/false/);
});

test('renderExchange labels the assistant with the card name', () => {
  const p = { text: '嗯', priorTurns: [{ role: 'user', content: '在吗' }, { role: 'assistant', content: '在。' }] };
  assert.equal(renderExchange(p, '好。', '鲸鱼娘'), '用户：在吗\n鲸鱼娘：在。\n用户：嗯\n鲸鱼娘：好。');
});

test('buildJudgeSystem is byte-stable for one card', () => {
  const a = buildJudgeSystem('RUBRIC', CARD);
  const b = buildJudgeSystem('RUBRIC', CARD);
  assert.equal(a, b);
  assert.ok(a.startsWith('RUBRIC'));
  assert.ok(a.includes('鲸鱼娘'));
});

test('buildJudgeUser names every axis it wants back', () => {
  const u = buildJudgeUser({ text: '嗯', priorTurns: [] }, '好。', ['in_character', 'initiative'], '鲸鱼娘');
  assert.ok(u.includes('in_character、initiative'));
  assert.ok(u.includes('只输出 JSON'));
});

test('buildJudgeUser renders 【判定条件】 only when the prompt carries a condition (M-19)', () => {
  const without = buildJudgeUser({ text: '嗯', priorTurns: [] }, '好。', ['in_character'], '鲸鱼娘');
  assert.ok(!without.includes('【判定条件】'));
  const p = { text: '你饿不饿', priorTurns: [], condition: '她提到想吃米饭，而不是别的食物' };
  const withIt = buildJudgeUser(p, '想吃饭。', ['in_character', 'trait_hit'], '鲸鱼娘');
  assert.equal(
    withIt,
    '【对话】\n用户：你饿不饿\n鲸鱼娘：想吃饭。\n\n【判定条件】\n她提到想吃米饭，而不是别的食物\n\n【这一条要评的项目】\nin_character、trait_hit\n\n只输出 JSON。',
  );
});

test('judgeInput hands the judge the raw reply, not the sanitized one (I-12)', () => {
  const t = { raw: '- 第一点\n**总结**', reply: '第一点\n总结' };
  assert.equal(judgeInput(t), t.raw);
});

test('the shipped rubric is version 2 and has a body', () => {
  const j = loadJudge(fileURLToPath(new URL('../judge.md', import.meta.url)));
  // Phase 3 §9.6/§13.2 appended the three gate notes to the judge's system prompt -> version 2.
  assert.equal(j.version, 2);
  assert.ok(j.body.includes('false_disagreement'));
  assert.ok(!j.body.startsWith('---'));
});

// ---- CX-11: a stalled judge fails the turn, it does not hang the run ----

test('judgeTurn fails with judgeError material when fetchImpl never resolves (CX-11)', async () => {
  const neverResolves = () => new Promise(() => {});
  const started = Date.now();
  const r = await judgeTurn({
    baseUrl: 'http://judge.invalid/v1', apiKey: 'x', model: 'm', system: 's', user: 'u',
    axes: ['in_character'], fetchImpl: neverResolves, timeoutMs: 30,
  });
  assert.equal(r.ok, false);
  assert.match(r.message, /timeout|abort/i);
  assert.ok(Date.now() - started < 2000, 'two bounded attempts must finish well under 2 s');
});

test('judgeOnce passes an AbortSignal to fetch and cuts off a fetch that ignores it (CX-11)', async () => {
  let sawSignal = null;
  const ignoresSignal = (_url, init) => { sawSignal = init.signal; return new Promise(() => {}); };
  await assert.rejects(
    judgeOnce({ baseUrl: 'http://judge.invalid/v1', apiKey: 'x', model: 'm', system: 's', user: 'u', fetchImpl: ignoresSignal, timeoutMs: 20 }),
    /timeout|abort/i,
  );
  assert.ok(sawSignal instanceof AbortSignal);
});

test('judgeOnce rejects a body that never finishes streaming (idle cap) (CX-11)', async () => {
  const stalled = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"choices":[')); /* never closes */ } });
  const fetchImpl = async () => ({ ok: true, status: 200, body: stalled });
  await assert.rejects(
    judgeOnce({ baseUrl: 'http://judge.invalid/v1', apiKey: 'x', model: 'm', system: 's', user: 'u', fetchImpl, timeoutMs: 5000, idleMs: 20 }),
    /timeout|abort/i,
  );
});

test('judgeOnce rejects an oversized body (CX-11)', async () => {
  const big = new TextEncoder().encode('x'.repeat(2048));
  const stream = new ReadableStream({ start(c) { c.enqueue(big); c.close(); } });
  const fetchImpl = async () => ({ ok: true, status: 200, body: stream });
  await assert.rejects(
    judgeOnce({ baseUrl: 'http://judge.invalid/v1', apiKey: 'x', model: 'm', system: 's', user: 'u', fetchImpl, maxBytes: 1024 }),
    /exceeded 1024 bytes/,
  );
});

test('judgeOnce still returns the content of a well-formed bounded response', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"in_character":2}' } }] }), { status: 200 });
  const text = await judgeOnce({ baseUrl: 'http://judge.invalid/v1', apiKey: 'x', model: 'm', system: 's', user: 'u', fetchImpl });
  assert.equal(text, '{"in_character":2}');
});
