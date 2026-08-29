/**
 * Per-frame helpers kept free of Framework imports so they are unit-testable in Node: the vendored
 * `model/cubismmodel.ts:23-28` reads `Live2DCubismCore.ColorBlendType_*` at module scope, so any
 * module that reaches the renderer needs the proprietary, browser-only Core just to be imported.
 */

/** The slice of CubismWebGLOffscreenManager a frame needs. */
export interface OffscreenFrameManager<GL> {
  beginFrameProcess(gl: GL): void;
  endFrameProcess(gl: GL): void;
  releaseStaleRenderTextures(gl: GL): void;
}

/**
 * Runs one frame's work between beginFrameProcess and endFrameProcess.
 *
 * Without the try/finally a throw from the model update or the draw leaves the offscreen manager
 * mid-frame and its stale render textures unreleased, and every later frame inherits that state.
 */
export function withOffscreenFrame<GL>(
  offscreen: OffscreenFrameManager<GL>,
  gl: GL,
  work: () => void,
): void {
  offscreen.beginFrameProcess(gl);
  try {
    work();
  } finally {
    offscreen.endFrameProcess(gl);
    offscreen.releaseStaleRenderTextures(gl);
  }
}

/** The slice of CubismModelMatrix the viewport fit needs (CubismMatrix44.setMatrix + setWidth). */
export interface FitMatrix {
  setMatrix(tr: Float32Array): void;
  setWidth(w: number): void;
}

/**
 * Applies the "wide model in a tall window" fit on top of the model matrix the model3.json Layout
 * produced, and only when the fit state actually changes.
 *
 * `CubismModelMatrix.setWidth` *assigns* the scale (`math/cubismmodelmatrix.ts:36-40` ->
 * `cubismmatrix44.ts:258-260`) and leaves the layout translation alone, so re-deriving it from a
 * saved baseline is exact. The previous code had no baseline at all: it called `setWidth(2)` every
 * portrait frame and never undid it, so a canvas resized portrait -> landscape kept portrait scale.
 * `setHeight(2)` is *not* a valid reset - it discards the model3.json Layout width/height.
 */
export class ViewportFit {
  private applied: boolean | null = null;

  /** Re-applies the fit from `baseline` if `fitByWidth` differs from the state already applied. */
  apply(matrix: FitMatrix, baseline: Float32Array, fitByWidth: boolean): void {
    if (fitByWidth === this.applied) return;
    matrix.setMatrix(baseline);
    if (fitByWidth) matrix.setWidth(2);
    this.applied = fitByWidth;
  }

  /** Forgets the applied state, so the next apply() writes the matrix again. */
  reset(): void {
    this.applied = null;
  }
}
