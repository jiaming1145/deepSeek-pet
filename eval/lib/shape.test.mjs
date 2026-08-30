import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countHanzi, splitSentences, endsWithQuestion, emojiCount, ellipsisCount,
  fourGrams, overlapRatio, shapeOf,
} from './shape.mjs';

test('countHanzi counts only Han characters', () => {
  assert.equal(countHanzi('你好，world 123'), 2);
});

test('splitSentences keeps the terminator with its sentence', () => {
  assert.deepEqual(splitSentences('好。那人家说件事。'), ['好。', '那人家说件事。']);
});

test('a trailing 「……」 is not a sentence terminator', () => {
  assert.equal(splitSentences('本鲸等着……').length, 1);
});

test('endsWithQuestion is true only at the very end', () => {
  assert.equal(endsWithQuestion('主人说呢？'), true);
  assert.equal(endsWithQuestion('主人说呢？人家在。'), false);
});

test('emojiCount counts a ZWJ cluster once', () => {
  assert.equal(emojiCount('好耶👨‍👩‍👧'), 1);
});

test('ellipsisCount counts 「……」 occurrences', () => {
  assert.equal(ellipsisCount('嗯……好……'), 2);
});

test('overlapRatio is intersection over the first set', () => {
  assert.equal(overlapRatio(fourGrams('abcdefgh'), fourGrams('abcdxxxx')), 1 / 5);
});

test('shapeOf reports every field the report needs', () => {
  assert.deepEqual(shapeOf('好。人家在这儿……'), {
    hanzi: 6, sentences: 2, endsWithQuestion: false, emojiCount: 0, ellipsisCount: 1,
  });
});
