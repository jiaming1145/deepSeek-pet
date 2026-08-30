import type { HitPart } from '@ds/protocol';
import type { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import type { CharacterConfig } from './character';

/** R3-6d: enter when alpha >= 10/255. */
export const ENTER_ALPHA = 10;
/** R3-6d: leave when every sample < 4/255. */
export const LEAVE_ALPHA = 4;
/** R3-6d: a 5-DIP radius, 9 samples. */
export const LEAVE_RADIUS_DIP = 5;
/** centre + 8 at 45-degree steps */
export const LEAVE_SAMPLES = 9;
export const DRAWABLE_MIN_OPACITY = 0.01;
export const PART_ATTRIBUTION_MIN = 0.1;
/** skip re-evaluation for a move under 2 DIP */
export const MOVE_EPS_DIP = 2;
/** R3-6: <= 5 Hz under a stationary pointer while animating */
export const STATIONARY_REPICK_HZ = 5;

export interface PickResult {
  /** Composited alpha at the point, 0..255. 0 means fully transparent. */
  alpha: number;
  /** The semantic part of the topmost PARTICIPATING drawable with its own alpha >= PART_MIN. */
  part: HitPart | null;
  /** Model-local coordinates of the point, [-1, 1] on both axes (the drag anchor, §7.2). */
  modelX: number;
  modelY: number;
}
export interface HitPartEntry { part: HitPart; participatesInHitTest: boolean }
export interface TicklishRect { x0: number; y0: number; x1: number; y1: number }
/** §4.10's three siblings, together. Keys of `hitParts` are Cubism PART ids, or drawable ids (override). */
export interface PickerMap {
  hitParts: Readonly<Record<string, HitPartEntry>>;
  ticklishRect: TicklishRect | null;
  hitPartDefault: HitPart;
}
export function pickerMapFromConfig(
  config: Pick<Partial<CharacterConfig>, 'hitParts' | 'ticklishRect' | 'hitPartDefault'>,
): PickerMap {
  return {
    hitParts: (config.hitParts ?? {}) as Readonly<Record<string, HitPartEntry>>,
    ticklishRect: config.ticklishRect ?? null,
    hitPartDefault: config.hitPartDefault ?? 'body',
  };
}

/** The CubismModel surface the predicate reads (§0.2 "Cubism picking API"). Structural so tests need no Core. */
export interface PickSource {
  getDrawableCount(): number;
  getDrawableId(i: number): { getString(): string };
  getRenderOrders(): Int32Array;
  getDrawableDynamicFlagIsVisible(i: number): boolean;
  getDrawableOpacity(i: number): number;
  getModelOapcity(): number;
  getPartOpacityByIndex(p: number): number;
  getDrawableParentPartIndex(i: number): number;
  getPartId(p: number): { getString(): string };
  getDrawableVertexIndices(i: number): Uint16Array;
  getDrawableVertexPositions(i: number): Float32Array;
  getDrawableVertexUvs(i: number): Float32Array;
  getDrawableTextureIndex(i: number): number;
  getDrawableCulling(i: number): boolean;
  getDrawableMasks(): Int32Array[];
  getDrawableMaskCounts(): Int32Array;
  getDrawableInvertedMaskBit(i: number): boolean;
  getDrawableBlendMode(i: number): number;
  getCanvasWidth(): number;
  getCanvasHeight(): number;
}
/** What `CompanionModel` satisfies. */
export interface PickModel {
  getModel(): PickSource;
  getModelMatrix(): { invertTransformX(v: number): number; invertTransformY(v: number): number };
}
/** What `HTMLCanvasElement` satisfies: the client -> device mapping of Live2DStage.toDevice. */
export interface PickSurface {
  width: number;
  height: number;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

const EMPTY: PickResult = { alpha: 0, part: null, modelX: 0, modelY: 0 };

export class Picker {
  private disposed = false;
  /** Per-drawable map resolution (§6.4), computed on first pick; drawable count is fixed per moc. */
  private entries: (HitPartEntry | null)[] | null = null;
  private order: Int32Array | null = null;
  private readonly w = new Float64Array(3);

  constructor(
    private readonly model: PickModel,
    private readonly map: PickerMap,
    private readonly textures: readonly ImageData[],
    private readonly surface: PickSurface,
  ) {}

  /** Invalidated by a texture reload or a model swap. */
  dispose(): void {
    this.disposed = true;
    this.entries = null;
    this.order = null;
  }

  /** The predicate. `projection` MUST be the same matrix the frame drew with. Run after model.update(). */
  pick(clientX: number, clientY: number, projection: CubismMatrix44): PickResult {
    if (this.disposed) return EMPTY;
    const m = this.model.getModel();
    // Step 1 — client -> device -> NDC -> view -> model, the inverse of NDC = projection * modelMatrix * v.
    const r = this.surface.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) return EMPTY;
    const dx = ((clientX - r.left) / r.width) * this.surface.width;
    const dy = ((clientY - r.top) / r.height) * this.surface.height;
    const ndcX = (dx / this.surface.width) * 2 - 1;
    const ndcY = 1 - (dy / this.surface.height) * 2;
    const mm = this.model.getModelMatrix();
    const mx = mm.invertTransformX(projection.invertTransformX(ndcX));
    const my = mm.invertTransformY(projection.invertTransformY(ndcY));
    const modelX = clamp1(mx / (m.getCanvasWidth() / 2));
    const modelY = clamp1(my / (m.getCanvasHeight() / 2));

    const entries = this.resolveEntries(m);
    // Step 2 — descending render order, never index order.
    const orders = m.getRenderOrders();
    if (!this.order || this.order.length !== orders.length) this.order = new Int32Array(orders.length);
    const order = this.order;
    for (let i = 0; i < order.length; i++) order[i] = i;
    order.sort((a, b) => orders[b] - orders[a]);

    const modelOpacity = m.getModelOapcity();
    const masks = m.getDrawableMasks();
    const maskCounts = m.getDrawableMaskCounts();
    let acc = 0;
    let part: HitPart | null = null;
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      // Step 3 — skip rules.
      if (!m.getDrawableDynamicFlagIsVisible(i)) continue;
      const drawableOpacity = m.getDrawableOpacity(i) * modelOpacity;
      if (drawableOpacity < DRAWABLE_MIN_OPACITY) continue;
      const partOpacity = m.getPartOpacityByIndex(m.getDrawableParentPartIndex(i));
      if (partOpacity < DRAWABLE_MIN_OPACITY) continue;
      const entry = entries[i];
      if (entry && !entry.participatesInHitTest) continue;
      // Steps 4–6.
      const texAlpha = this.meshAlpha(m, i, mx, my);
      if (texAlpha <= 0) continue;
      // Step 7 — one-level clipping masks.
      let coverage = 1;
      const nMasks = maskCounts[i];
      if (nMasks > 0) {
        coverage = 0;
        const list = masks[i];
        for (let j = 0; j < nMasks; j++) {
          const mi = list[j];
          const a = this.meshAlpha(m, mi, mx, my);
          if (a > 0) coverage = Math.max(coverage, a * m.getDrawableOpacity(mi));
        }
        if (m.getDrawableInvertedMaskBit(i)) coverage = 1 - coverage;
      }
      // Step 8 — blend policy: Additive (1) / Multiplicative (2) contribute 0 and never attribute.
      if (m.getDrawableBlendMode(i) !== 0) continue;
      // Step 9 — over accumulation.
      const ai = texAlpha * drawableOpacity * partOpacity * coverage;
      acc += ai * (1 - acc);
      // Step 10 — attribution.
      if (part === null && ai >= PART_ATTRIBUTION_MIN) part = entry ? entry.part : this.map.hitPartDefault;
      if (acc >= 0.99) break;
    }
    if (part === null && acc >= ENTER_ALPHA / 255) part = this.map.hitPartDefault;
    const rect = this.map.ticklishRect;
    if (part !== null && rect) {
      const u = (modelX + 1) / 2;
      const v = (modelY + 1) / 2;
      if (u >= rect.x0 && u <= rect.x1 && v >= rect.y0 && v <= rect.y1) part = 'ticklish';
    }
    // Step 11.
    return { alpha: Math.round(acc * 255), part, modelX, modelY };
  }

  /** §6.4: drawable-id key wins over part-id key; no key -> null (participates, hitPartDefault). */
  private resolveEntries(m: PickSource): (HitPartEntry | null)[] {
    if (this.entries) return this.entries;
    const n = m.getDrawableCount();
    const out: (HitPartEntry | null)[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const byDrawable = this.map.hitParts[m.getDrawableId(i).getString()];
      const byPart = this.map.hitParts[m.getPartId(m.getDrawableParentPartIndex(i)).getString()];
      out[i] = byDrawable ?? byPart ?? null;
    }
    this.entries = out;
    return out;
  }

  /**
   * Steps 4–6 for one drawable: AABB reject, barycentric point-in-triangle with culling, UV
   * interpolation, bilinear texture alpha (v flipped). Returns 0..1, or 0 when no triangle contains
   * the point.
   */
  private meshAlpha(m: PickSource, i: number, px: number, py: number): number {
    const v = m.getDrawableVertexPositions(i);
    // AABB — recomputed per pick, the vertices deform every frame.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < v.length; k += 2) {
      const x = v[k], y = v[k + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (px < minX || px > maxX || py < minY || py > maxY) return 0;
    const idx = m.getDrawableVertexIndices(i);
    const culling = m.getDrawableCulling(i);
    const w = this.w;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t] * 2, b = idx[t + 1] * 2, c = idx[t + 2] * 2;
      const ax = v[a], ay = v[a + 1], bx = v[b], by = v[b + 1], cx = v[c], cy = v[c + 1];
      const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (area === 0) continue;
      if (culling && area < 0) continue; // back-facing under Cubism's CCW front: not drawn, not hit
      const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area;
      const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      w[0] = w0; w[1] = w1; w[2] = w2;
      const uv = m.getDrawableVertexUvs(i);
      const u = w0 * uv[a] + w1 * uv[b] + w2 * uv[c];
      const vv = w0 * uv[a + 1] + w1 * uv[b + 1] + w2 * uv[c + 1];
      return this.bilinearAlpha(m.getDrawableTextureIndex(i), u, vv);
    }
    return 0;
  }

  /** u -> px = u * (w - 1); v is bottom-up (GL) while ImageData is top-down -> py = (1 - v) * (h - 1). */
  private bilinearAlpha(textureIndex: number, u: number, v: number): number {
    const img = this.textures[textureIndex];
    if (!img) return 0;
    const W = img.width, H = img.height, d = img.data;
    const px = Math.min(Math.max(u, 0), 1) * (W - 1);
    const py = (1 - Math.min(Math.max(v, 0), 1)) * (H - 1);
    const x0 = Math.floor(px), y0 = Math.floor(py);
    const x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1);
    const fx = px - x0, fy = py - y0;
    const a00 = d[(y0 * W + x0) * 4 + 3], a10 = d[(y0 * W + x1) * 4 + 3];
    const a01 = d[(y1 * W + x0) * 4 + 3], a11 = d[(y1 * W + x1) * 4 + 3];
    const top = a00 + (a10 - a00) * fx;
    const bottom = a01 + (a11 - a01) * fx;
    return (top + (bottom - top) * fy) / 255;
  }
}

function clamp1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

// ---- R3-6d hysteresis helpers (pure; the hover state machine in the pet renderer calls them) ----

/** Centre + eight LEAVE_RADIUS_DIP offsets at 45-degree steps, in client (DIP) px. */
export const LEAVE_RING: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  ...Array.from({ length: LEAVE_SAMPLES - 1 }, (_, k) => {
    const t = (k * Math.PI) / 4;
    return [LEAVE_RADIUS_DIP * Math.cos(t), LEAVE_RADIUS_DIP * Math.sin(t)] as const;
  }),
];
/**
 * `alphas[0]` is the exact point; `alphas[1..8]` the ring. Enter on the exact point alone; leave only
 * when ALL nine are below LEAVE_ALPHA (a ring with fewer than 9 samples never leaves).
 */
export function nextHoverInside(inside: boolean, alphas: readonly number[]): boolean {
  if (!inside) return alphas[0] >= ENTER_ALPHA;
  if (alphas.length < LEAVE_SAMPLES) return true;
  return !alphas.every((a) => a < LEAVE_ALPHA);
}
/** A pointer move under MOVE_EPS_DIP skips the pick entirely. */
export function movedEnough(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.hypot(bx - ax, by - ay) >= MOVE_EPS_DIP;
}

/**
 * Loads the model's textures as un-premultiplied ImageData for the predicate. Re-reads model3.json's
 * FileReferences.Textures because CompanionModel keeps its setting private. Browser only.
 */
export async function loadPickerTextures(baseUrl: string, modelJson: string): Promise<ImageData[]> {
  const charBase = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const slash = modelJson.lastIndexOf('/');
  const modelDir = charBase + (slash >= 0 ? modelJson.slice(0, slash + 1) : '');
  const res = await fetch(charBase + modelJson);
  if (!res.ok) throw new Error(`${res.status} ${charBase + modelJson}`);
  const json = (await res.json()) as { FileReferences?: { Textures?: string[] } };
  const names = json.FileReferences?.Textures ?? [];
  return Promise.all(names.map(async (name) => {
    const blob = await (await fetch(modelDir + name)).blob();
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return ctx.getImageData(0, 0, c.width, c.height);
  }));
}
