import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, axesFor, UNIVERSAL_AXES } from './aggregate.mjs';

const JUDGE_OK = {
  in_character: 2, assistant_speak: false, narrates_user: false, closing_moral: false,
  rhetorical_tail: false, emoji_discipline: false, nativeness: 2,
};

function turn(over = {}) {
  return {
    promptId: 'x', category: 'bland', run: 0, indexInRun: 0, sensitive: false,
    axes: [...UNIVERSAL_AXES], raw: '好。', reply: '好。',
    lint: { severity: 'none', violations: [] }, usage: null, ttftMs: 10, totalMs: 20,
    complianceMiss: false, estimatedPromptTokens: 100,
    shape: { hanzi: 1, sentences: 1, endsWithQuestion: false, emojiCount: 0, ellipsisCount: 0 },
    judge: { ...JUDGE_OK }, judgeError: false, ...over,
  };
}

test('axesFor appends the fixture axes to the universal ones', () => {
  assert.deepEqual(axesFor({ axes: ['initiative'] }), [...UNIVERSAL_AXES, 'initiative']);
});

test('a clean set of turns passes every evaluated gate', () => {
  const r = aggregate([turn(), turn({ indexInRun: 1 })], { noJudge: false });
  assert.equal(r.pass, true);
  assert.equal(r.axes.in_character.mean, 2);
  assert.equal(r.axes.in_character.pct2, 1);
  assert.equal(r.shape.cacheHitPct, null);
  assert.equal(r.shapeGates.cacheHitPct.skipped, true);
});

test('one assistant_speak hit fails the run and lands in worst', () => {
  const bad = turn({ promptId: 'bad', judge: { ...JUDGE_OK, assistant_speak: true } });
  const r = aggregate([turn(), bad], { noJudge: false });
  assert.equal(r.axes.assistant_speak.count, 1);
  assert.equal(r.axes.assistant_speak.pass, false);
  assert.equal(r.pass, false);
  assert.equal(r.worst.assistant_speak[0].promptId, 'bad');
});

test('initiative below 70 per cent fails', () => {
  const rows = [true, false, false].map((v, i) =>
    turn({ indexInRun: i, axes: [...UNIVERSAL_AXES, 'initiative'], judge: { ...JUDGE_OK, initiative: v } }));
  const r = aggregate(rows, { noJudge: false });
  assert.equal(r.axes.initiative.pct, 0.333);
  assert.equal(r.axes.initiative.pass, false);
});

test('an emoji on a sensitive turn fails the sensitive half of A18', () => {
  const s = turn({ sensitive: true, judge: { ...JUDGE_OK, emoji_discipline: true } });
  const r = aggregate([s], { noJudge: false });
  assert.equal(r.axes.emoji_discipline_sensitive.count, 1);
  assert.equal(r.axes.emoji_discipline_sensitive.pass, false);
});

test('false_disagreement above 20 per cent fails P2', () => {
  const rows = [true, false, false, false].map((v, i) =>
    turn({ indexInRun: i, category: 'valid', axes: [...UNIVERSAL_AXES, 'false_disagreement'],
      judge: { ...JUDGE_OK, false_disagreement: v } }));
  const r = aggregate(rows, { noJudge: false });
  assert.equal(r.axes.false_disagreement.pct, 0.25);
  assert.equal(r.axes.false_disagreement.pass, false);
});

test('two adjacent question replies in one run fail A2', () => {
  const q = { hanzi: 1, sentences: 1, endsWithQuestion: true, emojiCount: 0, ellipsisCount: 0 };
  const r = aggregate([turn({ indexInRun: 0, shape: q }), turn({ indexInRun: 1, shape: q })], { noJudge: false });
  assert.equal(r.shape.consecutiveQuestionPairs, 1);
  assert.equal(r.shapeGates.consecutiveQuestionPairs.pass, false);
});

test('cache-hit is measured only from the third turn of a run', () => {
  const cold = { promptTokens: 1000, cacheHit: 0, cacheMiss: 1000, completionTokens: 30 };
  const warm = { promptTokens: 1000, cacheHit: 900, cacheMiss: 100, completionTokens: 30 };
  const r = aggregate([
    turn({ indexInRun: 0, usage: cold }), turn({ indexInRun: 1, usage: cold }), turn({ indexInRun: 2, usage: warm }),
  ], { noJudge: false });
  assert.equal(r.shape.cacheHitPct, 0.9);
  assert.equal(r.shapeGates.cacheHitPct.pass, true);
});

test('--no-judge skips every judge axis and still gates shape', () => {
  const r = aggregate([turn()], { noJudge: true });
  assert.equal(r.axes.in_character.skipped, true);
  assert.equal(r.axes.judge_error_rate.skipped, true);
  assert.equal(r.shapeGates.shortReplyPct.skipped, false);
  assert.equal(r.pass, true);
});

test('an axis with no turns is skipped, not failed', () => {
  const r = aggregate([turn()], { noJudge: false });
  assert.equal(r.axes.trait_hit.skipped, true);
  assert.equal(r.axes.trait_hit.n, 0);
  assert.equal(r.axes.trait_hit.pass, true);
});

test('a judge error above 5 per cent fails', () => {
  const rows = [turn({ judgeError: true, judge: null }), ...Array.from({ length: 9 }, (_, i) => turn({ indexInRun: i + 1 }))];
  const r = aggregate(rows, { noJudge: false });
  assert.equal(r.axes.judge_error_rate.pct, 0.1);
  assert.equal(r.axes.judge_error_rate.pass, false);
});

test('A9: thirteen in_character=0 turns among 138 pass the mean/pct2 pair but fail the zero-flip row (I-13)', () => {
  const rows = [
    ...Array.from({ length: 125 }, (_, i) => turn({ indexInRun: i })),
    ...Array.from({ length: 13 }, (_, i) => turn({ indexInRun: 125 + i, promptId: `flip-${i}`, judge: { ...JUDGE_OK, in_character: 0 } })),
  ];
  const r = aggregate(rows, { noJudge: false });
  assert.equal(r.axes.in_character.pass, true, 'mean 1.812 / pct2 0.906 still clear the pair');
  assert.equal(r.axes.in_character_flips.kind, 'countMax');
  assert.equal(r.axes.in_character_flips.n, 138);
  assert.equal(r.axes.in_character_flips.count, 13);
  assert.equal(r.axes.in_character_flips.threshold, 0);
  assert.equal(r.axes.in_character_flips.pass, false);
  assert.equal(r.pass, false);
  assert.equal(r.worst.in_character_flips.length, 3);
  assert.equal(r.worst.in_character_flips[0].promptId, 'flip-0');
});

test('A9: a single in_character=0 turn fails the zero-flip row', () => {
  const r = aggregate([turn(), turn({ indexInRun: 1, judge: { ...JUDGE_OK, in_character: 0 } })], { noJudge: false });
  assert.equal(r.axes.in_character_flips.count, 1);
  assert.equal(r.axes.in_character_flips.pass, false);
});

test('A9: the zero-flip row is skipped under --no-judge and when nothing was judged', () => {
  assert.equal(aggregate([turn()], { noJudge: true }).axes.in_character_flips.skipped, true);
  assert.equal(aggregate([turn({ judge: null, judgeError: true })], { noJudge: false }).axes.in_character_flips.skipped, true);
});

test('A18: a reply with two emoji fails the per-reply gate (M-20)', () => {
  const two = { hanzi: 5, sentences: 1, endsWithQuestion: false, emojiCount: 2, ellipsisCount: 0 };
  const one = { hanzi: 5, sentences: 1, endsWithQuestion: false, emojiCount: 1, ellipsisCount: 0 };
  const ok = aggregate([turn({ shape: one })], { noJudge: false });
  assert.equal(ok.shape.emojiMultiCount, 0);
  assert.equal(ok.shapeGates.emojiMultiCount.pass, true);
  const bad = aggregate([turn({ shape: one }), turn({ indexInRun: 1, shape: two })], { noJudge: false });
  assert.equal(bad.shape.emojiMultiCount, 1);
  assert.equal(bad.shapeGates.emojiMultiCount.threshold, 0);
  assert.equal(bad.shapeGates.emojiMultiCount.pass, false);
  assert.equal(bad.pass, false);
});

test('A4: a markdown lint hit on the raw output fails the markdownLintCount gate (I-12)', () => {
  const md = turn({ lint: { severity: 'strip', violations: [{ rule: 'markdown', reason: 'x' }] } });
  const r = aggregate([turn(), md], { noJudge: false });
  assert.equal(r.informational.lintRuleCounts.markdown, 1);
  assert.equal(r.shape.markdownLintCount, 1);
  assert.equal(r.shapeGates.markdownLintCount.pass, false);
  assert.equal(r.pass, false);
  const clean = aggregate([turn()], { noJudge: false });
  assert.equal(clean.shape.markdownLintCount, 0);
  assert.equal(clean.shapeGates.markdownLintCount.pass, true);
});
