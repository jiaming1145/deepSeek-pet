import { describe, expect, it } from 'vitest';
import type { HitPart } from '@ds/protocol';
import { FBO_REFRESH_MS, FBO_SCALE, FboPicker, GpuPressReader } from './picker-gpu';
import type { Picker, PickerMap } from './picker';

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

/**
 * The slice of WebGL2 `FboPicker` touches. `alphaAt(x, yGl)` fills the readback buffer in GL row
 * order; `state` records what the picker actually asked the GPU to do.
 */
function fakeFboGl(alphaAt: (x: number, yGl: number) => number) {
  const state = { draws: 0, readbacks: 0, fences: 0, signalled: false, w: 0, h: 0 };
  const gl = {
    TEXTURE_2D: 0x0de1, RGBA8: 0x8058, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
    FRAMEBUFFER: 0x8d40, COLOR_ATTACHMENT0: 0x8ce0, COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x100,
    PIXEL_PACK_BUFFER: 0x88eb, STREAM_READ: 0x88e1, SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    ALREADY_SIGNALED: 0x911a, CONDITION_SATISFIED: 0x911c, TIMEOUT_EXPIRED: 0x911b,
    createTexture: () => ({}), bindTexture: () => {},
    texImage2D: (_t: number, _l: number, _if: number, w: number, h: number) => { state.w = w; state.h = h; },
    createFramebuffer: () => ({}), bindFramebuffer: () => {}, framebufferTexture2D: () => {},
    createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {},
    viewport: () => {}, clearColor: () => {}, clear: () => {},
    readPixels: () => { state.readbacks++; },
    fenceSync: () => { state.fences++; return {}; },
    clientWaitSync: () => (state.signalled ? 0x911c : 0x911b),
    getBufferSubData: (_target: number, _offset: number, buf: Uint8Array) => {
      for (let y = 0; y < state.h; y++) for (let x = 0; x < state.w; x++) buf[(y * state.w + x) * 4 + 3] = alphaAt(x, y);
    },
    deleteSync: () => {}, deleteBuffer: () => {}, deleteFramebuffer: () => {}, deleteTexture: () => {},
  };
  return { gl: gl as unknown as WebGL2RenderingContext, state };
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

describe('FboPicker (§6.6, conditional)', () => {
  const surface = { width: 400, height: 400, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }) };
  const map: PickerMap = { hitParts: {}, ticklishRect: null, hitPartDefault: 'body' };
  const meshOf = (part: HitPart | null) =>
    ({ pick: () => ({ alpha: 255, part, modelX: 0.25, modelY: -0.5 }) }) as unknown as Picker;

  it('returns the mesh result until the first readback completes, then the FBO alpha', () => {
    // `alphaAt` is indexed in GL row order (row 0 = bottom), the order readPixels fills the PBO in.
    const { gl, state } = fakeFboGl((_x, yGl) => (yGl >= 90 ? 200 : 0));
    const f = new FboPicker({ draw: () => { state.draws++; } }, meshOf('face'), surface, map);
    expect(f.pick(10, 10, {} as never)).toEqual({ alpha: 255, part: 'face', modelX: 0.25, modelY: -0.5 });
    f.capture(gl, {} as never, 0);
    expect([state.draws, state.w, state.h]).toEqual([1, 100, 100]); // FBO_SCALE quarter of 400x400
    f.poll(gl, 0);
    expect([state.readbacks, state.fences]).toEqual([1, 1]);
    expect(f.pick(10, 10, {} as never).alpha).toBe(255); // fence still in flight -> mesh result
    state.signalled = true;
    f.poll(gl, 1);
    // client (10, 10) -> mask (2, 2) top-down -> GL row 97: opaque. (10, 390) -> GL row 2: empty.
    expect(f.pick(10, 10, {} as never)).toEqual({ alpha: 200, part: 'face', modelX: 0.25, modelY: -0.5 });
    expect(f.pick(10, 390, {} as never)).toEqual({ alpha: 0, part: null, modelX: 0.25, modelY: -0.5 });
  });

  it('redraws at most once per FBO_REFRESH_MS unless invalidated (§6.1 budget)', () => {
    const { gl, state } = fakeFboGl(() => 0);
    const f = new FboPicker({ draw: () => { state.draws++; } }, meshOf('face'), surface, map);
    f.capture(gl, {} as never, 0);
    expect(state.draws).toBe(1);
    for (let t = 16; t < FBO_REFRESH_MS; t += 16) f.capture(gl, {} as never, t); // a 60 Hz frame train
    expect(state.draws).toBe(1);
    f.capture(gl, {} as never, FBO_REFRESH_MS);
    expect(state.draws).toBe(2);
    f.invalidate(); // a motion start / resize forces the next frame through
    f.capture(gl, {} as never, FBO_REFRESH_MS + 1);
    expect(state.draws).toBe(3);
  });

  it('takes hitPartDefault from the injected map, not from private delegate state', () => {
    const { gl, state } = fakeFboGl(() => 255);
    const f = new FboPicker({ draw: () => { state.draws++; } }, meshOf(null), surface, { ...map, hitPartDefault: 'arm' });
    f.capture(gl, {} as never, 0);
    f.poll(gl, 0);
    state.signalled = true;
    f.poll(gl, 1);
    expect(f.pick(10, 10, {} as never).part).toBe('arm');
  });
});
