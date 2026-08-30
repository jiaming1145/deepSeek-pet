import { describe, expect, it } from 'vitest';
import { BehaviorBindError, MIN_USABLE_BEHAVIORS, bindResources, type ResourceCatalogue } from './bind.ts';
import { parseBehaviorPack } from './schema.ts';
import { HARU_CATALOGUE } from './test-util.ts';

const base = { weight: 1, minMs: 5000, maxMs: 9000 };
const pack = () => parseBehaviorPack({ version: 1, character: 'haru', behaviors: [
  { ...base, id: 'b01', motion: ['Idle', 0] },
  { ...base, id: 'b02', motion: ['Idle', 1] },
  { ...base, id: 'b03', motion: ['TapBody', 3] },
  { ...base, id: 'b04', expression: 'F01' },
  { ...base, id: 'b05', expression: 'F05', overlay: 'headDroop' },
  { ...base, id: 'b06', expression: 'F07', overlay: 'blush' },
  { ...base, id: 'b07', overlay: 'headTilt' },
  { ...base, id: 'b08', motion: ['TapBody', 0], expression: 'F02' },
  { ...base, id: 'b09', gaze: 'wander' },
  { ...base, id: 'b10', gaze: 'down' },
  { ...base, id: 'b11', gaze: 'up' },
  { ...base, id: 'b12', gaze: 'away' },
  { ...base, id: 'b13', motion: ['TapBody', 9] },           // index out of range
  { ...base, id: 'b14', motion: ['Dance', 0] },             // group absent
  { ...base, id: 'b15', expression: 'F99' },                // expression absent
  { ...base, id: 'b16', overlay: 'headTilt', when: { fact: 'onFloor', lt: 1 } },  // type mismatch → warning
] });

describe('bindResources (§4.7)', () => {
  it('MIN_USABLE_BEHAVIORS is 12 and is not relaxed per character', () => { expect(MIN_USABLE_BEHAVIORS).toBe(12); });
  it('binds what resolves, drops the rest WITH reasons, warns on condition type mismatches', () => {
    const bound = bindResources(pack(), HARU_CATALOGUE);
    expect(bound.character).toBe('haru');
    expect(bound.behaviors.map((b) => b.id)).toEqual(['b01', 'b02', 'b03', 'b04', 'b05', 'b06', 'b07', 'b08', 'b09', 'b10', 'b11', 'b12', 'b16']);
    expect(bound.dropped).toEqual([
      { id: 'b13', reason: '动作 TapBody[9] 越界（共 4）' },
      { id: 'b14', reason: '动作组 Dance 不存在' },
      { id: 'b15', reason: '表情 F99 不存在' },
    ]);
    expect(bound.warnings).toEqual(['b16: lt on non-number fact onFloor']);
  });
  it('drops a behaviour whose overlay touches an undeclared parameter', () => {
    const cat = { ...HARU_CATALOGUE, parameters: HARU_CATALOGUE.parameters.filter((p) => p !== 'ParamTere') };
    const bound = bindResources(pack(), cat);
    expect(bound.dropped.map((d) => d.id)).toEqual(['b06', 'b13', 'b14', 'b15']);
    expect(bound.dropped[0]).toEqual({ id: 'b06', reason: '参数 ParamTere 未声明（overlay blush）' });
    expect(bound.behaviors).toHaveLength(12);   // exactly the floor — still binds
  });
  it('throws BehaviorBindError below the floor, naming the missing kinds in first-failure order', () => {
    const hiyoriLike: ResourceCatalogue = { motionGroups: { Idle: 9, TapBody: 1 }, expressions: [], parameters: HARU_CATALOGUE.parameters };
    let err: unknown;
    try { bindResources(pack(), hiyoriLike); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(BehaviorBindError);
    const e = err as BehaviorBindError;
    expect(e.usable).toBe(8);
    expect(e.dropped.map((d) => d.id)).toEqual(['b03', 'b04', 'b05', 'b06', 'b08', 'b13', 'b14', 'b15']);
    expect(e.message).toBe('角色行为不足：可用 8/12（缺少：动作、表情）');
  });
  it('exactly 12 usable passes; 11 throws', () => {
    const p = pack();
    const eleven = { ...p, behaviors: p.behaviors.slice(0, 11).concat(p.behaviors.slice(12, 15)) };   // b01..b11 + b13,b14,b15
    expect(bindResources({ ...p, behaviors: p.behaviors.slice(0, 12) }, HARU_CATALOGUE).behaviors).toHaveLength(12);
    expect(() => bindResources(eleven, HARU_CATALOGUE)).toThrow('角色行为不足：可用 11/12（缺少：动作、表情）');
  });
});

describe('hitParts validation (§6.4)', () => {
  it('unknown key is a warning; drawable-id keys resolve; a non-HIT_PARTS value throws', () => {
    const ok = bindResources(pack(), HARU_CATALOGUE, {
      Part01Face001: { part: 'face', participatesInHitTest: true },
      ArtMesh12: { part: 'body', participatesInHitTest: true },
      Part99Ghost: { part: 'hair', participatesInHitTest: true },
    });
    expect(ok.warnings).toEqual(['b16: lt on non-number fact onFloor', 'hitParts.Part99Ghost 未在模型中找到（部件或网格）']);
    expect(() => bindResources(pack(), HARU_CATALOGUE, { Part01Face001: { part: 'nose', participatesInHitTest: true } }))
      .toThrow('hitParts.Part01Face001.part 不是合法部位：nose');
  });
  it('a catalogue without parts/drawables skips key resolution silently', () => {
    const cat = { motionGroups: HARU_CATALOGUE.motionGroups, expressions: HARU_CATALOGUE.expressions, parameters: HARU_CATALOGUE.parameters };
    expect(bindResources(pack(), cat, { Whatever: { part: 'head', participatesInHitTest: false } }).warnings).toEqual(['b16: lt on non-number fact onFloor']);
  });
});
