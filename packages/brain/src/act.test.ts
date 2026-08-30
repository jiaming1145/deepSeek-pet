import { describe, expect, it } from 'vitest';
import { LOOK_ANCHORS, SAY_MAX_GRAPHEMES, WALK_ANCHORS } from '@ds/protocol';
import { ACT_ATTRS, boundSay, parseLook, parseWalkTo } from './act.ts';

describe('parseLook (§2.6)', () => {
  it('accepts every LOOK_ANCHORS member as an anchor target', () => {
    for (const a of LOOK_ANCHORS) expect(parseLook(a)).toEqual({ kind: 'anchor', anchor: a });
  });
  it('accepts x,y with up to two decimals in [-1, 1]', () => {
    expect(parseLook('-0.75,-0.50')).toEqual({ kind: 'point', x: -0.75, y: -0.5 });
    expect(parseLook('1,0')).toEqual({ kind: 'point', x: 1, y: 0 });
    expect(parseLook('1.00,-1.0')).toEqual({ kind: 'point', x: 1, y: -1 });
    expect(parseLook('0.5,0.25')).toEqual({ kind: 'point', x: 0.5, y: 0.25 });
  });
  it('rejects out-of-range, over-precise, malformed and unknown values', () => {
    for (const bad of ['1.5,0', '0,-1.01', '0.125,0', '1.001,0', '0.5', '0.5,', ',0.5', 'a,b', 'moon', '', '0.5,0.5,0.5']) {
      expect(parseLook(bad)).toBeNull();
    }
  });
});

describe('parseWalkTo (§2.6)', () => {
  it('accepts WALK_ANCHORS only — never coordinates', () => {
    for (const a of WALK_ANCHORS) expect(parseWalkTo(a)).toBe(a);
    expect(parseWalkTo('0.5,0.5')).toBeNull();
    expect(parseWalkTo('cursor')).toBeNull();
    expect(parseWalkTo('')).toBeNull();
  });
});

describe('boundSay (§2.6 say bound)', () => {
  it('passes text at or under SAY_MAX_GRAPHEMES through untouched', () => {
    const s = '你'.repeat(SAY_MAX_GRAPHEMES);
    expect(boundSay(s)).toEqual({ text: s, truncated: false });
    expect(boundSay('')).toEqual({ text: '', truncated: false });
  });
  it('truncates at the last sentence terminator inside the bound', () => {
    const s = '你'.repeat(50) + '。' + '好'.repeat(60) + '！' + '啦'.repeat(30);
    expect(boundSay(s)).toEqual({ text: '你'.repeat(50) + '。' + '好'.repeat(60) + '！', truncated: true });
  });
  it('hard-cuts at 120 graphemes when there is no terminator inside the bound', () => {
    const s = '你'.repeat(150);
    expect(boundSay(s)).toEqual({ text: '你'.repeat(120), truncated: true });
  });
  it('counts grapheme clusters, not code units (an emoji ZWJ sequence is one)', () => {
    const family = '👨‍👩‍👧';
    const s = family.repeat(121);
    expect(boundSay(s)).toEqual({ text: family.repeat(120), truncated: true });
    expect(boundSay(family.repeat(120)).truncated).toBe(false);
  });
});

describe('ACT_ATTRS', () => {
  it('is the D14 attribute list in order', () => {
    expect(ACT_ATTRS).toEqual(['emotion', 'motion', 'look', 'walkTo']);
  });
});
