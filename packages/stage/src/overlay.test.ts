import { describe, expect, it } from 'vitest';
import { CubismUpdateOrder } from '@framework/motion/icubismupdater';
import type { CubismModel } from '@framework/model/cubismmodel';
import type { CubismIdHandle } from '@framework/id/cubismid';
import { OVERLAY_EXECUTION_ORDER, OVERLAY_TABLE, OverlayUpdater } from './overlay';

type Call = [string, number, number];
function fakeModel() {
  const calls: Call[] = [];
  const model = { addParameterValueById: (id: unknown, v: number, w: number) => { calls.push([id as string, v, w]); } } as unknown as CubismModel;
  return { model, calls };
}
const identity = (n: string) => n as unknown as CubismIdHandle;
const round = (calls: Call[]) => calls.map(([id, v, w]) => [id, Math.round(v * 1000) / 1000, w]);

describe('OverlayUpdater (§5.7, §4.1)', () => {
  it('runs at execution order 450, between Drag 400 and Breath 500', () => {
    const u = new OverlayUpdater(identity);
    expect(OVERLAY_EXECUTION_ORDER).toBe(450);
    expect(u.getExecutionOrder()).toBe(450);
    expect(CubismUpdateOrder.CubismUpdateOrder_Drag).toBeLessThan(450);
    expect(CubismUpdateOrder.CubismUpdateOrder_Breath).toBeGreaterThan(450);
  });

  it('carries the §4.1 table verbatim', () => {
    expect(OVERLAY_TABLE).toEqual({
      headTilt:     { deltas: { ParamAngleZ: 12 }, inMs: 400, outMs: 400 },
      headTiltHold: { deltas: { ParamAngleZ: 18, ParamBodyAngleZ: 4 }, inMs: 600, outMs: 400 },
      headDroop:    { deltas: { ParamAngleY: -10, ParamBodyAngleZ: 4 }, inMs: 900, outMs: 600 },
      leanLeft:     { deltas: { ParamAngleX: -8, ParamBodyAngleX: -6 }, inMs: 500, outMs: 400 },
      leanRight:    { deltas: { ParamAngleX: 8, ParamBodyAngleX: 6 }, inMs: 500, outMs: 400 },
      lookUp:       { deltas: { ParamAngleY: 10 }, inMs: 500, outMs: 400 },
      blush:        { deltas: { ParamTere: 0.8 }, inMs: 700, outMs: 900 },
    });
    expect(Object.keys(OVERLAY_TABLE)).toEqual(['headTilt', 'headTiltHold', 'headDroop', 'leanLeft', 'leanRight', 'lookUp', 'blush']);
  });

  it('eases in linearly over inMs and writes delta * envelope through addParameterValueById(id, v, 1.0)', () => {
    const u = new OverlayUpdater(identity);
    const { model, calls } = fakeModel();
    u.onLateUpdate(model, 0.5);
    expect(calls).toEqual([]);                       // 'none' writes nothing
    expect(u.set('headTilt')).toBe(true);
    u.onLateUpdate(model, 0.2);                      // 200 / 400 ms -> 0.5
    expect(round(calls)).toEqual([['ParamAngleZ', 6, 1]]);
    u.onLateUpdate(model, 0.2);                      // 400 / 400 -> 1.0
    u.onLateUpdate(model, 1.0);                      // clamped at 1.0
    expect(round(calls).slice(1)).toEqual([['ParamAngleZ', 12, 1], ['ParamAngleZ', 12, 1]]);
    expect(u.weightOf('headTilt')).toBe(1);
  });

  it('eases out over outMs after set("none") and is removed at zero', () => {
    const u = new OverlayUpdater(identity);
    const { model, calls } = fakeModel();
    u.set('blush');
    u.onLateUpdate(model, 0.7);                      // fully in
    u.set('none');
    u.onLateUpdate(model, 0.45);                     // 450 / 900 out -> 0.5
    expect(round(calls).at(-1)).toEqual(['ParamTere', 0.4, 1]);
    u.onLateUpdate(model, 0.45);
    expect(u.weightOf('blush')).toBe(0);
    u.onLateUpdate(model, 0.1);
    expect(calls.length).toBe(3);                    // nothing written once the layer is gone
    expect(u.current()).toBe('none');
  });

  it('cross-fades: the previous preset eases out on its own outMs while the new one eases in', () => {
    const u = new OverlayUpdater(identity);
    const { model, calls } = fakeModel();
    u.set('headTiltHold');
    u.onLateUpdate(model, 0.6);                      // in
    u.set('leanLeft');
    u.onLateUpdate(model, 0.2);                      // hold: 200/400 out -> 0.5; leanLeft: 200/500 in -> 0.4
    expect(round(calls).slice(-4)).toEqual([
      ['ParamAngleZ', 9, 1], ['ParamBodyAngleZ', 2, 1],
      ['ParamAngleX', -3.2, 1], ['ParamBodyAngleX', -2.4, 1],
    ]);
    expect(u.current()).toBe('leanLeft');
  });

  it('rejects an unknown preset name without changing state', () => {
    const u = new OverlayUpdater(identity);
    u.set('headTilt');
    expect(u.set('spin' as never)).toBe(false);
    expect(u.current()).toBe('headTilt');
  });
});
