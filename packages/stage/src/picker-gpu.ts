import type { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { PART_ATTRIBUTION_MIN, type PickSource } from './picker';

export interface PendingPress { pressId: number; deviceX: number; deviceY: number }
export interface PressRead { pressId: number; alpha: number }

/**
 * R3-6b: press-time truth. One readPixels of ONE pixel of the default framebuffer, issued inside the
 * same RAF callback as the draw, so the backbuffer is still valid and preserveDrawingBuffer is not
 * required. A later queue() before the frame supersedes the earlier press.
 */
export class GpuPressReader {
  private pending: PendingPress | null = null;
  private readonly buf = new Uint8Array(4);

  /** Queued from the pointer-down handler; serviced inside the NEXT frame. */
  queue(p: PendingPress): void {
    this.pending = p;
  }

  /** Called by Live2DStage.frame() IMMEDIATELY after model.draw(), before the RAF returns. */
  service(gl: WebGL2RenderingContext): PressRead | null {
    const p = this.pending;
    if (!p) return null;
    this.pending = null;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const x = Math.min(Math.max(Math.round(p.deviceX), 0), w - 1);
    const y = Math.min(Math.max(Math.round(p.deviceY), 0), h - 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(x, h - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.buf);
    return { pressId: p.pressId, alpha: this.buf[3] };
  }
}

/** quarter scale: ~105 x 180 for a 420 x 720 window */
export const FBO_SCALE = 0.25;
/** R3-6a: "refreshed with an async fence every 150 ms" */
export const FBO_REFRESH_MS = 150;

// `renderIdPass` (§6.5) is appended in Step 9; `FboPicker` (§6.6) only in the conditional Step 12.
// The imports above are consumed there; they are kept here so the file compiles between steps.
void PART_ATTRIBUTION_MIN;
export type { CubismMatrix44 as _CubismMatrix44, PickSource as _PickSource };
