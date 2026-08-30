import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFixture, R8_COUNTS } from './fixture.mjs';

function fixtureWith(extraPrompts = [], extraMix = {}) {
  const prompts = [];
  for (const [cat, n] of Object.entries(R8_COUNTS)) {
    for (let i = 0; i < n; i++) prompts.push({ id: `${cat}-${i}`, category: cat, text: '嗯', axes: [] });
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
