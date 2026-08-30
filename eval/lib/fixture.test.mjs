import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFixture, R8_COUNTS, CATEGORY_AXES, OPTIONAL_AXES } from './fixture.mjs';
import { UNIVERSAL_AXES } from './aggregate.mjs';

function fixtureWith(extraPrompts = [], extraMix = {}) {
  const prompts = [];
  for (const [cat, n] of Object.entries(R8_COUNTS)) {
    for (let i = 0; i < n; i++) {
      // Each R8 category carries the axis its gate reads (CX-12); humour only on half (A17 别闹了 turns).
      const axes = Object.entries(CATEGORY_AXES[cat]).filter(([, need]) => need === 'all' || i % 2 === 0).map(([a]) => a);
      prompts.push({ id: `${cat}-${i}`, category: cat, text: '嗯', axes });
    }
  }
  return { version: 1, mix: { ...R8_COUNTS, ...extraMix }, prompts: [...prompts, ...extraPrompts] };
}

test('the R8 skeleton alone validates', () => {
  assert.equal(validateFixture(fixtureWith()).ok, true);
});

test('a trait prompt may carry a string condition (M-19)', () => {
  const fx = fixtureWith([{ id: 'trait-0', category: 'trait', text: '饿不饿', axes: ['trait_hit'], condition: '提到米饭' }], { trait: 1 });
  assert.equal(validateFixture(fx).ok, true);
});

test('a non-string condition is rejected', () => {
  const fx = fixtureWith([{ id: 'trait-0', category: 'trait', text: '饿不饿', axes: ['trait_hit'], condition: 3 }], { trait: 1 });
  const v = validateFixture(fx);
  assert.equal(v.ok, false);
  assert.match(v.message, /condition/);
});

test('an empty condition is rejected — the rubric answers false without one', () => {
  const fx = fixtureWith([{ id: 'trait-0', category: 'trait', text: '饿不饿', axes: ['trait_hit'], condition: '' }], { trait: 1 });
  assert.equal(validateFixture(fx).ok, false);
});

test('a trait_hit prompt without a condition is rejected', () => {
  const fx = fixtureWith([{ id: 'trait-0', category: 'trait', text: '饿不饿', axes: ['trait_hit'] }], { trait: 1 });
  const v = validateFixture(fx);
  assert.equal(v.ok, false);
  assert.match(v.message, /判定条件|condition/);
});

// ---- CX-12: axis names and category coverage ----

test('an unknown / misspelled axis is rejected, naming the prompt and the axis', () => {
  const fx = fixtureWith([{ id: 'valid-0', category: 'valid', text: '嗯', axes: ['false_disagreemnt'] }], { valid: 1 });
  const v = validateFixture(fx);
  assert.equal(v.ok, false);
  assert.match(v.message, /valid-0/);
  assert.match(v.message, /false_disagreemnt/);
});

test('a duplicate axis within one prompt is rejected', () => {
  const fx = fixtureWith([{ id: 'valid-0', category: 'valid', text: '嗯', axes: ['false_disagreement', 'false_disagreement'] }], { valid: 1 });
  const v = validateFixture(fx);
  assert.equal(v.ok, false);
  assert.match(v.message, /重复/);
});

test('re-listing a universal axis is rejected (it would be judged twice)', () => {
  const fx = fixtureWith([{ id: 'valid-0', category: 'valid', text: '嗯', axes: ['in_character'] }], { valid: 1 });
  const v = validateFixture(fx);
  assert.equal(v.ok, false);
  assert.match(v.message, /in_character/);
});

test('every optional axis is a real AXIS_SPECS key and no universal axis is optional', () => {
  assert.ok(OPTIONAL_AXES.length > 0);
  for (const a of OPTIONAL_AXES) assert.ok(!UNIVERSAL_AXES.includes(a), a);
  for (const needs of Object.values(CATEGORY_AXES)) for (const a of Object.keys(needs)) assert.ok(OPTIONAL_AXES.includes(a), a);
});

test('an "all" category prompt without its gate axis is rejected (bland without initiative)', () => {
  const fx = fixtureWith();
  fx.prompts.find((p) => p.id === 'bland-3').axes = [];
  const v = validateFixture(fx);
  assert.equal(v.ok, false);
  assert.match(v.message, /bland-3/);
  assert.match(v.message, /initiative/);
});

test('a "some" category with no prompt carrying its axis is rejected (humour without any humour_stops)', () => {
  const fx = fixtureWith();
  for (const p of fx.prompts) if (p.category === 'humour') p.axes = [];
  const v = validateFixture(fx);
  assert.equal(v.ok, false);
  assert.match(v.message, /humour_stops/);
});

test('half the humour prompts carrying humour_stops is fine (A17 judges 别闹了 turns only)', () => {
  const fx = fixtureWith();
  assert.equal(fx.prompts.filter((p) => p.category === 'humour' && p.axes.includes('humour_stops')).length, 3);
  assert.equal(validateFixture(fx).ok, true);
});
