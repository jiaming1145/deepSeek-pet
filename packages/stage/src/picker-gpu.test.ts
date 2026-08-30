import { describe, expect, it } from 'vitest';
import { FBO_REFRESH_MS, FBO_SCALE, GpuPressReader } from './picker-gpu';

/** The slice of WebGL2RenderingContext the reader touches; `alphaAt` decides what readPixels returns. */
function fakeGl(width: number, height: number, alphaAt: (x: number, yGl: number) => number) {
  const calls: unknown[][] = [];
  const gl = {
    drawingBufferWidth: width, drawingBufferHeight: height,
    RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, FRAMEBUFFER: 0x8d40,
    bindFramebuffer: (target: number, fb: unknown) => { calls.push(['bindFramebuffer', target, fb]); },
    readPixels: (x: number, y: number, w: number, h: number, f: number, t: number, buf: Uint8Array) => {
      calls.push(['readPixels', x, y, w, h, f, t]);
      buf[0] = 1; buf[1] = 2; buf[2] = 3; buf[3] = alphaAt(x, y);
    },
  };
  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}

describe('GpuPressReader (§6.3)', () => {
  it('returns null when nothing is queued and never touches gl', () => {
    const { gl, calls } = fakeGl(630, 1080, () => 255);
    expect(new GpuPressReader().service(gl)).toBeNull();
    expect(calls).toEqual([]);
  });
  it('reads exactly one pixel of the DEFAULT framebuffer at (x, height - 1 - y) and clears the queue', () => {
    const { gl, calls } = fakeGl(630, 1080, (x, y) => (x === 300 && y === 1080 - 1 - 400 ? 200 : 0));
    const r = new GpuPressReader();
    r.queue({ pressId: 7, deviceX: 300.4, deviceY: 399.6 });
    expect(r.service(gl)).toEqual({ pressId: 7, alpha: 200 });
    expect(calls).toEqual([
      ['bindFramebuffer', gl.FRAMEBUFFER, null],
      ['readPixels', 300, 679, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE],
    ]);
    expect(r.service(gl)).toBeNull();
  });
  it('clamps an off-canvas press into the buffer instead of reading out of bounds', () => {
    const { gl, calls } = fakeGl(630, 1080, () => 0);
    const r = new GpuPressReader();
    r.queue({ pressId: 1, deviceX: -3, deviceY: 5000 });
    expect(r.service(gl)).toEqual({ pressId: 1, alpha: 0 });
    expect(calls[1]).toEqual(['readPixels', 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE]);
  });
  it('a second queue() before the frame supersedes the first (one press per frame)', () => {
    const { gl } = fakeGl(10, 10, () => 9);
    const r = new GpuPressReader();
    r.queue({ pressId: 1, deviceX: 1, deviceY: 1 });
    r.queue({ pressId: 2, deviceX: 1, deviceY: 1 });
    expect(r.service(gl)?.pressId).toBe(2);
    expect(r.service(gl)).toBeNull();
  });
});

describe('FBO constants (§6.6)', () => {
  it('pins FBO_SCALE and FBO_REFRESH_MS', () => {
    expect(FBO_SCALE).toBe(0.25);
    expect(FBO_REFRESH_MS).toBe(150);
  });
});
