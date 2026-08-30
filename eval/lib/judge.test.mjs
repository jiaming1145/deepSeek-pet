import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadJudge, buildJudgeSystem, buildJudgeUser, renderExchange, extractJson, validateJudgement } from './judge.mjs';

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

test('the shipped rubric is version 1 and has a body', () => {
  const j = loadJudge(fileURLToPath(new URL('../judge.md', import.meta.url)));
  assert.equal(j.version, 1);
  assert.ok(j.body.includes('false_disagreement'));
  assert.ok(!j.body.startsWith('---'));
});
