import { CubismFramework } from '@framework/live2dcubismframework';
import type { CubismIdHandle } from '@framework/id/cubismid';
import type { CubismModel } from '@framework/model/cubismmodel';
import { ICubismUpdater } from '@framework/motion/icubismupdater';

/** §5.7: between CubismUpdateOrder_Drag (400) and _Breath (500) — composes on the gaze, under breath. */
export const OVERLAY_EXECUTION_ORDER = 450;

export interface OverlaySpec {
  /** Additive parameter deltas; Cubism clamps every write to the parameter's declared range. */
  readonly deltas: Readonly<Record<string, number>>;
  readonly inMs: number;
  readonly outMs: number;
}

/** §4.1's table, verbatim. Keys are the OVERLAY_PRESETS of @ds/behaviors minus 'none'. */
export const OVERLAY_TABLE = {
  headTilt:     { deltas: { ParamAngleZ: 12 }, inMs: 400, outMs: 400 },
  headTiltHold: { deltas: { ParamAngleZ: 18, ParamBodyAngleZ: 4 }, inMs: 600, outMs: 400 },
  headDroop:    { deltas: { ParamAngleY: -10, ParamBodyAngleZ: 4 }, inMs: 900, outMs: 600 },
  leanLeft:     { deltas: { ParamAngleX: -8, ParamBodyAngleX: -6 }, inMs: 500, outMs: 400 },
  leanRight:    { deltas: { ParamAngleX: 8, ParamBodyAngleX: 6 }, inMs: 500, outMs: 400 },
  lookUp:       { deltas: { ParamAngleY: 10 }, inMs: 500, outMs: 400 },
  blush:        { deltas: { ParamTere: 0.8 }, inMs: 700, outMs: 900 },
} as const satisfies Record<string, OverlaySpec>;

export type OverlayPresetName = keyof typeof OVERLAY_TABLE | 'none';
export type IdResolver = (name: string) => CubismIdHandle;

interface Layer { preset: keyof typeof OVERLAY_TABLE; weight: number; dir: 1 | -1; ids: [CubismIdHandle, number][] }

/**
 * The additive overlay layer (§5.7). Always-on: it never owns a lane, it only adds deltas scaled by a
 * linear ease-in/ease-out envelope, so a behaviour's head tilt composes with gaze and breath instead
 * of fighting them. `set()` cross-fades: the outgoing preset eases out on its own outMs.
 */
export class OverlayUpdater extends ICubismUpdater {
  private readonly resolveId: IdResolver;
  private layers: Layer[] = [];
  private active: OverlayPresetName = 'none';

  constructor(resolveId: IdResolver = (n) => CubismFramework.getIdManager().getId(n)) {
    super(OVERLAY_EXECUTION_ORDER);
    this.resolveId = resolveId;
  }

  /** Returns false (state unchanged) for a name outside the table. */
  set(preset: OverlayPresetName): boolean {
    if (preset !== 'none' && !(preset in OVERLAY_TABLE)) return false;
    this.active = preset;
    for (const l of this.layers) l.dir = l.preset === preset ? 1 : -1;
    if (preset !== 'none' && !this.layers.some((l) => l.preset === preset)) {
      const ids = Object.entries(OVERLAY_TABLE[preset].deltas).map(([n, d]) => [this.resolveId(n), d] as [CubismIdHandle, number]);
      this.layers.push({ preset, weight: 0, dir: 1, ids });
    }
    return true;
  }

  current(): OverlayPresetName {
    return this.active;
  }

  /** Test/trace hook: the envelope weight of a preset, 0 when it is not layered. */
  weightOf(preset: OverlayPresetName): number {
    return this.layers.find((l) => l.preset === preset)?.weight ?? 0;
  }

  onLateUpdate(model: CubismModel, deltaTimeSeconds: number): void {
    const ms = deltaTimeSeconds * 1000;
    const next: Layer[] = [];
    for (const l of this.layers) {
      const spec = OVERLAY_TABLE[l.preset];
      l.weight = l.dir === 1 ? Math.min(1, l.weight + ms / spec.inMs) : Math.max(0, l.weight - ms / spec.outMs);
      // The frame that reaches zero is still written (an additive `delta * 0` is identity) and only
      // then dropped, so the layer's last frame is the one that closes the envelope, never a jump.
      for (const [id, delta] of l.ids) model.addParameterValueById(id, delta * l.weight, 1.0);
      if (l.weight <= 0 && l.dir === -1) continue;
      next.push(l);
    }
    this.layers = next;
  }
}
