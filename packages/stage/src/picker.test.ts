import { describe, expect, it } from 'vitest';
import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { CubismModelMatrix } from '@framework/math/cubismmodelmatrix';
import {
  DRAWABLE_MIN_OPACITY, ENTER_ALPHA, LEAVE_ALPHA, LEAVE_RADIUS_DIP, LEAVE_RING, LEAVE_SAMPLES,
  MOVE_EPS_DIP, PART_ATTRIBUTION_MIN, STATIONARY_REPICK_HZ, Picker, movedEnough, nextHoverInside,
  pickerMapFromConfig, type PickSource, type PickerMap,
} from './picker';

/** One drawable of the fake CubismModel surface. Vertices are model-space (x, y) pairs. */
interface FakeDrawable {
  id: string; part: number; verts: number[]; uvs: number[]; idx: number[]; order: number;
  visible?: boolean; opacity?: number; texture?: number; culling?: boolean; blend?: number;
  masks?: number[]; inverted?: boolean;
}
function fakeSource(ds: FakeDrawable[], parts: string[], partOpacity: number[] = parts.map(() => 1), modelOpacity = 1): PickSource {
  const idOf = (s: string) => ({ getString: () => s });
  return {
    getDrawableCount: () => ds.length,
    getDrawableId: (i) => idOf(ds[i].id),
    getRenderOrders: () => Int32Array.from(ds.map((d) => d.order)),
    getDrawableDynamicFlagIsVisible: (i) => ds[i].visible ?? true,
    getDrawableOpacity: (i) => ds[i].opacity ?? 1,
    getModelOapcity: () => modelOpacity,
    getPartOpacityByIndex: (p) => partOpacity[p],
    getDrawableParentPartIndex: (i) => ds[i].part,
    getPartId: (p) => idOf(parts[p]),
    getDrawableVertexIndices: (i) => Uint16Array.from(ds[i].idx),
    getDrawableVertexPositions: (i) => Float32Array.from(ds[i].verts),
    getDrawableVertexUvs: (i) => Float32Array.from(ds[i].uvs),
    getDrawableTextureIndex: (i) => ds[i].texture ?? 0,
    getDrawableCulling: (i) => ds[i].culling ?? false,
    getDrawableMasks: () => ds.map((d) => Int32Array.from(d.masks ?? [])),
    getDrawableMaskCounts: () => Int32Array.from(ds.map((d) => (d.masks ?? []).length)),
    getDrawableInvertedMaskBit: (i) => ds[i].inverted ?? false,
    getDrawableBlendMode: (i) => ds[i].blend ?? 0,
    getCanvasWidth: () => 2, getCanvasHeight: () => 2,
  };
}
/** 4x4 texture whose alpha is `alpha(x, y)` with y = 0 the TOP row (ImageData order). */
function tex(alpha: (x: number, y: number) => number): ImageData {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) data[(y * 4 + x) * 4 + 3] = alpha(x, y);
  return { width: 4, height: 4, data, colorSpace: 'srgb' } as unknown as ImageData;
}
const OPAQUE = tex(() => 255);
/** Unit quad centred on the origin, CCW, uv covering the whole texture. */
const QUAD = { verts: [-1, -1, 1, -1, 1, 1, -1, 1], uvs: [0, 0, 1, 0, 1, 1, 0, 1], idx: [0, 1, 2, 0, 2, 3] };
/** 200x200 device px surface at (0,0): client px == device px, NDC (0,0) at (100,100). */
const SURFACE = { width: 200, height: 200, getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) };
const MAP: PickerMap = {
  hitParts: { Face: { part: 'face', participatesInHitTest: true }, Deco: { part: 'face', participatesInHitTest: false }, MeshOverride: { part: 'arm', participatesInHitTest: true } },
  ticklishRect: null, hitPartDefault: 'body',
};
function picker(ds: FakeDrawable[], parts = ['Face', 'Deco', 'Hair'], map = MAP, textures = [OPAQUE], partOpacity?: number[], modelOpacity?: number) {
  const model = { getModel: () => fakeSource(ds, parts, partOpacity, modelOpacity), getModelMatrix: () => new CubismModelMatrix(2, 2) };
  return new Picker(model, map, textures, SURFACE);
}
const I = () => new CubismMatrix44(); // identity projection: model space == NDC

describe('constants (§6.2, R3-6d)', () => {
  it('pins every tunable', () => {
    expect([ENTER_ALPHA, LEAVE_ALPHA, LEAVE_RADIUS_DIP, LEAVE_SAMPLES]).toEqual([10, 4, 5, 9]);
    expect([DRAWABLE_MIN_OPACITY, PART_ATTRIBUTION_MIN, MOVE_EPS_DIP, STATIONARY_REPICK_HZ]).toEqual([0.01, 0.1, 2, 5]);
  });
});

describe('pickerMapFromConfig (§4.10, §6.4)', () => {
  it('defaults an absent map to empty / no rect / body', () => {
    expect(pickerMapFromConfig({})).toEqual({ hitParts: {}, ticklishRect: null, hitPartDefault: 'body' });
  });
  it('passes the Haru values through', () => {
    const m = pickerMapFromConfig({ hitParts: { Part01Face001: { part: 'face', participatesInHitTest: true } }, ticklishRect: { x0: 0.3, y0: 0.55, x1: 0.7, y1: 0.8 }, hitPartDefault: 'hair' });
    expect(m.hitPartDefault).toBe('hair');
    expect(m.ticklishRect).toEqual({ x0: 0.3, y0: 0.55, x1: 0.7, y1: 0.8 });
  });
});

describe('Picker.pick — the predicate (§6.2 steps 1–11)', () => {
  it('hits an opaque quad at its centre and misses outside it (steps 1, 4, 11)', () => {
    const p = picker([{ id: 'm0', part: 0, order: 0, ...QUAD }]);
    const hit = p.pick(100, 100, I());
    expect(hit).toEqual({ alpha: 255, part: 'face', modelX: 0, modelY: 0 });
    // DEVIATION (fixture arithmetic): CubismModelMatrix(2, 2) calls setHeight(2) -> scale(1) -> the
    // model matrix is the IDENTITY, so QUAD covers the whole 200x200 surface and no in-canvas point
    // misses it. The miss sample is therefore taken outside the surface (ndc -1.4, +1.4).
    expect(p.pick(-40, -40, I()).alpha).toBe(0);
    expect(p.pick(-40, -40, I()).part).toBeNull();
  });
  it('maps client px through the surface rect and returns model coords in [-1, 1] (step 1)', () => {
    const p = picker([{ id: 'm0', part: 0, order: 0, ...QUAD }]);
    const r = p.pick(150, 50, I()); // right, up
    expect(r.modelX).toBeCloseTo(0.5, 5);
    expect(r.modelY).toBeCloseTo(0.5, 5);
  });
  it('samples texture alpha bilinearly with v flipped (steps 5, 6)', () => {
    // Top texture row (ImageData y = 0) opaque, everything else transparent.
    const topRow = tex((_x, y) => (y === 0 ? 255 : 0));
    const p = picker([{ id: 'm0', part: 0, order: 0, ...QUAD }], undefined, MAP, [topRow]);
    // uv v = 1 is the top row in GL convention -> model y = +1 (top edge of the quad).
    expect(p.pick(100, 0.5, I()).alpha).toBeGreaterThanOrEqual(240);
    expect(p.pick(100, 199.5, I()).alpha).toBe(0);
    // Halfway between row 0 (255) and row 1 (0): bilinear, not nearest.
    // DEVIATION (fixture arithmetic): py = (1 - v) * (h - 1) with v = (modelY + 1) / 2, so py = 0.5
    // needs modelY = 1 - 2 * 0.5 / 3 (the brief's `1 - 0.5 / 3` lands on py = 0.25 -> 191).
    const mid = p.pick(100, 100 - 100 * (1 - (2 * 0.5) / 3), I()).alpha;
    expect(mid).toBeGreaterThan(100);
    expect(mid).toBeLessThan(160);
  });
  it('iterates in descending render order: the topmost drawable attributes the part (step 2, 10)', () => {
    const p = picker([
      { id: 'm0', part: 0, order: 10, ...QUAD },
      { id: 'm1', part: 2, order: 20, ...QUAD },
    ]);
    expect(p.pick(100, 100, I()).part).toBe('body'); // Hair has no map entry -> hitPartDefault
  });
  it('skips invisible, sub-DRAWABLE_MIN_OPACITY, faded-part and non-participating drawables (step 3)', () => {
    const base = { part: 0, order: 0, ...QUAD };
    expect(picker([{ id: 'a', ...base, visible: false }]).pick(100, 100, I()).alpha).toBe(0);
    expect(picker([{ id: 'a', ...base, opacity: 0.005 }]).pick(100, 100, I()).alpha).toBe(0);
    expect(picker([{ id: 'a', ...base }], undefined, MAP, [OPAQUE], [0.005, 1, 1]).pick(100, 100, I()).alpha).toBe(0);
    expect(picker([{ id: 'a', ...base }], undefined, MAP, [OPAQUE], undefined, 0.005).pick(100, 100, I()).alpha).toBe(0);
    expect(picker([{ id: 'a', ...base, part: 1 }]).pick(100, 100, I()).alpha).toBe(0); // Deco: participatesInHitTest false
  });
  it('honours culling: a clockwise triangle is not hit when culling is on (step 4)', () => {
    const cw = { verts: QUAD.verts, uvs: QUAD.uvs, idx: [0, 2, 1, 0, 3, 2] };
    expect(picker([{ id: 'a', part: 0, order: 0, ...cw, culling: true }]).pick(100, 100, I()).alpha).toBe(0);
    expect(picker([{ id: 'a', part: 0, order: 0, ...cw, culling: false }]).pick(100, 100, I()).alpha).toBe(255);
  });
  it('applies clipping masks one level deep, with the inverted bit (step 7)', () => {
    const leftHalf = tex((x) => (x < 2 ? 255 : 0)); // mask texture: opaque on the left half
    const ds = (inverted: boolean): FakeDrawable[] => [
      { id: 'mask', part: 1, order: 0, ...QUAD, texture: 1 },
      { id: 'body', part: 0, order: 1, ...QUAD, texture: 0, masks: [0], inverted },
    ];
    const plain = picker(ds(false), undefined, MAP, [OPAQUE, leftHalf]);
    expect(plain.pick(30, 100, I()).alpha).toBe(255); // inside mask coverage
    expect(plain.pick(170, 100, I()).alpha).toBe(0);  // outside -> clipped away
    const inv = picker(ds(true), undefined, MAP, [OPAQUE, leftHalf]);
    expect(inv.pick(30, 100, I()).alpha).toBe(0);
    expect(inv.pick(170, 100, I()).alpha).toBe(255);
  });
  it('additive and multiplicative drawables contribute nothing and attribute nothing but do not block (step 8)', () => {
    const p = picker([
      { id: 'body', part: 2, order: 0, ...QUAD },
      { id: 'glow', part: 0, order: 5, ...QUAD, blend: 1 },
      { id: 'shade', part: 0, order: 6, ...QUAD, blend: 2 },
    ]);
    expect(p.pick(100, 100, I())).toMatchObject({ alpha: 255, part: 'body' });
    const only = picker([{ id: 'glow', part: 0, order: 5, ...QUAD, blend: 1 }]);
    expect(only.pick(100, 100, I())).toMatchObject({ alpha: 0, part: null });
  });
  it('accumulates with the over operator and early-outs at 0.99 (step 9)', () => {
    const half = tex(() => 128);
    const p = picker([
      { id: 'a', part: 0, order: 0, ...QUAD },
      { id: 'b', part: 0, order: 1, ...QUAD },
    ], undefined, MAP, [half]);
    // 0.502 + 0.502 * (1 - 0.502) = 0.752 -> 192
    expect(p.pick(100, 100, I()).alpha).toBe(192);
    let reads = 0;
    const src = fakeSource([{ id: 'a', part: 0, order: 1, ...QUAD }, { id: 'b', part: 0, order: 0, ...QUAD }], ['Face']);
    const counting: PickSource = { ...src, getDrawableVertexPositions: (i) => { reads++; return src.getDrawableVertexPositions(i); } };
    const q = new Picker({ getModel: () => counting, getModelMatrix: () => new CubismModelMatrix(2, 2) }, MAP, [OPAQUE], SURFACE);
    q.pick(100, 100, I());
    expect(reads).toBe(1); // the second (lower) drawable was never evaluated
  });
  it('attributes the first drawable with a_i >= PART_ATTRIBUTION_MIN, else hitPartDefault when acc >= ENTER_ALPHA (step 10)', () => {
    const faint = tex(() => 20); // 0.078 < 0.10: never attributes on its own
    const p = picker([{ id: 'a', part: 0, order: 1, ...QUAD }, { id: 'b', part: 2, order: 0, ...QUAD }], undefined, MAP, [faint]);
    const r = p.pick(100, 100, I()); // acc = 0.078 + 0.078*0.922 = 0.15 -> 38 >= 10
    expect(r.alpha).toBe(38);
    expect(r.part).toBe('body');
    const thin = picker([{ id: 'a', part: 0, order: 1, ...QUAD }], undefined, MAP, [tex(() => 8)]);
    expect(thin.pick(100, 100, I()).part).toBeNull(); // 8 < ENTER_ALPHA
  });
  it('ticklishRect overrides the part inside it, in u = (x + 1) / 2 space (step 10)', () => {
    const map: PickerMap = { ...MAP, ticklishRect: { x0: 0.5, y0: 0.5, x1: 1, y1: 1 } };
    const p = picker([{ id: 'a', part: 0, order: 0, ...QUAD }], undefined, map);
    expect(p.pick(150, 50, I()).part).toBe('ticklish'); // model (0.5, 0.5) -> u,v = 0.75
    expect(p.pick(50, 150, I()).part).toBe('face');
  });
  it('a drawable-id key overrides the part-id key (§6.4)', () => {
    const p = picker([{ id: 'MeshOverride', part: 0, order: 0, ...QUAD }]);
    expect(p.pick(100, 100, I()).part).toBe('arm');
  });
  it('dispose() makes pick() return the empty result', () => {
    const p = picker([{ id: 'a', part: 0, order: 0, ...QUAD }]);
    p.dispose();
    expect(p.pick(100, 100, I())).toEqual({ alpha: 0, part: null, modelX: 0, modelY: 0 });
  });
});

describe('hysteresis helpers (R3-6d)', () => {
  it('LEAVE_RING is the centre plus eight 5-DIP samples at 45-degree steps', () => {
    expect(LEAVE_RING).toHaveLength(LEAVE_SAMPLES);
    expect(LEAVE_RING[0]).toEqual([0, 0]);
    for (const [dx, dy] of LEAVE_RING.slice(1)) expect(Math.hypot(dx, dy)).toBeCloseTo(LEAVE_RADIUS_DIP, 6);
    expect(LEAVE_RING[1]).toEqual([5, 0]);
    expect(LEAVE_RING[3][0]).toBeCloseTo(0, 6);
  });
  it('enters on the exact point >= ENTER_ALPHA and leaves only when all nine are < LEAVE_ALPHA', () => {
    expect(nextHoverInside(false, [10])).toBe(true);
    expect(nextHoverInside(false, [9])).toBe(false);
    expect(nextHoverInside(true, [0, 0, 0, 0, 0, 0, 0, 0, 3])).toBe(false);
    expect(nextHoverInside(true, [0, 0, 0, 0, 0, 0, 0, 0, 4])).toBe(true);
    expect(nextHoverInside(true, [0])).toBe(true); // a partial ring never leaves
  });
  it('movedEnough is a MOVE_EPS_DIP hypot threshold', () => {
    expect(movedEnough(0, 0, 1.9, 0)).toBe(false);
    expect(movedEnough(0, 0, 2, 0)).toBe(true);
    expect(movedEnough(0, 0, 1.5, 1.5)).toBe(true);
  });
});
