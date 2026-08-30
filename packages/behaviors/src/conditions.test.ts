import { describe, expect, it } from 'vitest';
import { CONDITION_FACTS, ConditionSchema, conditionTypeIssues, evaluate, type Condition, type ConditionFacts } from './conditions.ts';

const F: ConditionFacts = {
  phase: 'day', present: true, presentation: 'awake', liveliness: 0.3, mood: 0.1, energy: 60,
  onFloor: true, nearEdge: false, cursorNear: false, userIdleS: 30, affection: 20, probableTyping: false,
};

describe('CONDITION_FACTS', () => {
  it('is exactly the twelve addressable facts of §4.2, in order', () => {
    expect([...CONDITION_FACTS]).toEqual([
      'phase', 'present', 'presentation', 'liveliness', 'mood', 'energy',
      'onFloor', 'nearEdge', 'cursorNear', 'userIdleS', 'affection', 'probableTyping',
    ]);
  });
});

describe('ConditionSchema', () => {
  it('accepts every §4.9 shape', () => {
    const ok: unknown[] = [
      { fact: 'energy', gt: 40 },
      { fact: 'mood', lt: -0.25 },
      { fact: 'cursorNear', eq: true },
      { fact: 'presentation', in: ['nap', 'sleep'] },
      { allOf: [{ fact: 'energy', gt: 40 }, { fact: 'presentation', eq: 'awake' }] },
      { anyOf: [{ fact: 'phase', eq: 'night' }, { fact: 'energy', lt: 35 }] },
      { not: { fact: 'onFloor', eq: true } },
    ];
    for (const c of ok) expect(ConditionSchema.safeParse(c).success, JSON.stringify(c)).toBe(true);
  });
  it('rejects unknown facts, empty/oversized lists and JS-expression strings', () => {
    expect(ConditionSchema.safeParse({ fact: 'windowTitle', eq: 'x' }).success).toBe(false);
    expect(ConditionSchema.safeParse({ allOf: [] }).success).toBe(false);
    expect(ConditionSchema.safeParse({ anyOf: new Array(9).fill({ fact: 'present', eq: true }) }).success).toBe(false);
    expect(ConditionSchema.safeParse({ fact: 'energy', in: [] }).success).toBe(false);
    expect(ConditionSchema.safeParse('energy > 40').success).toBe(false);
    expect(ConditionSchema.safeParse({ fact: 'energy', gt: '40' }).success).toBe(false);
  });
});

describe('evaluate', () => {
  it('undefined is always eligible', () => { expect(evaluate(undefined, F)).toBe(true); });
  it('eq / lt / gt / in on matching types', () => {
    expect(evaluate({ fact: 'phase', eq: 'day' }, F)).toBe(true);
    expect(evaluate({ fact: 'phase', eq: 'night' }, F)).toBe(false);
    expect(evaluate({ fact: 'energy', gt: 40 }, F)).toBe(true);
    expect(evaluate({ fact: 'energy', gt: 60 }, F)).toBe(false);
    expect(evaluate({ fact: 'mood', lt: -0.25 }, F)).toBe(false);
    expect(evaluate({ fact: 'userIdleS', lt: 31 }, F)).toBe(true);
    expect(evaluate({ fact: 'presentation', in: ['nap', 'sleep'] }, F)).toBe(false);
    expect(evaluate({ fact: 'presentation', in: ['awake', 'nap'] }, F)).toBe(true);
    expect(evaluate({ fact: 'cursorNear', eq: true }, F)).toBe(false);
    expect(evaluate({ fact: 'cursorNear', eq: false }, F)).toBe(true);
  });
  it('allOf / anyOf / not compose, and nest', () => {
    expect(evaluate({ allOf: [{ fact: 'energy', gt: 40 }, { fact: 'presentation', eq: 'awake' }] }, F)).toBe(true);
    expect(evaluate({ allOf: [{ fact: 'energy', gt: 40 }, { fact: 'presentation', eq: 'nap' }] }, F)).toBe(false);
    expect(evaluate({ anyOf: [{ fact: 'phase', eq: 'night' }, { fact: 'energy', lt: 35 }] }, F)).toBe(false);
    expect(evaluate({ anyOf: [{ fact: 'phase', eq: 'night' }, { fact: 'energy', lt: 61 }] }, F)).toBe(true);
    expect(evaluate({ not: { fact: 'onFloor', eq: true } }, F)).toBe(false);
    expect(evaluate({ not: { anyOf: [{ fact: 'phase', eq: 'night' }, { not: { fact: 'present', eq: true } }] } }, F)).toBe(true);
  });
  it('is total: a type mismatch evaluates to FALSE, never throws', () => {
    const mismatches: Condition[] = [
      { fact: 'onFloor', lt: 1 },            // lt on a boolean fact
      { fact: 'present', gt: 0 },            // gt on a boolean fact
      { fact: 'phase', lt: 3 },              // lt on a string fact
      { fact: 'energy', eq: '60' },          // string vs number
      { fact: 'present', eq: 1 },            // number vs boolean
      { fact: 'probableTyping', in: ['x'] }, // in on a boolean fact
    ];
    for (const c of mismatches) expect(evaluate(c, F), JSON.stringify(c)).toBe(false);
    expect(evaluate({ not: { fact: 'onFloor', lt: 1 } }, F)).toBe(true);
  });
});

describe('conditionTypeIssues', () => {
  it('reports the same mismatches statically, for bind() to surface', () => {
    expect(conditionTypeIssues(undefined)).toEqual([]);
    expect(conditionTypeIssues({ fact: 'energy', gt: 40 })).toEqual([]);
    expect(conditionTypeIssues({ fact: 'onFloor', lt: 1 })).toEqual(['lt on non-number fact onFloor']);
    expect(conditionTypeIssues({ fact: 'energy', eq: '60' })).toEqual(['eq value type string does not match fact energy (number)']);
    expect(conditionTypeIssues({ allOf: [{ fact: 'phase', gt: 1 }, { not: { fact: 'present', in: [1] } }] })).toEqual([
      'gt on non-number fact phase', 'in on boolean fact present',
    ]);
  });
});
