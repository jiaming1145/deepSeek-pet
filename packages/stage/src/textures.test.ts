import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTexture } from './textures';

/** Minimal stand-in for the WebGL2 enum values loadTexture touches. */
const ENUMS = {
  TEXTURE_2D: 0x0de1,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  LINEAR_MIPMAP_LINEAR: 0x2703,
  LINEAR: 0x2601,
  RGBA: 0x1908,
  UNSIGNED_BYTE: 0x1401,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
};

type Call = [string, ...unknown[]];

function fakeGl(overrides: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const texture = { id: 'texture' } as unknown as WebGLTexture;
  const gl = {
    ...ENUMS,
    createTexture: () => {
      calls.push(['createTexture']);
      return texture;
    },
    bindTexture: (_t: number, tex: unknown) => calls.push(['bindTexture', tex]),
    texParameteri: (_t: number, p: number, v: number) => calls.push(['texParameteri', p, v]),
    pixelStorei: (p: number, v: number) => calls.push(['pixelStorei', p, v]),
    texImage2D: () => calls.push(['texImage2D']),
    generateMipmap: () => calls.push(['generateMipmap']),
    deleteTexture: (tex: unknown) => calls.push(['deleteTexture', tex]),
    ...overrides,
  } as unknown as WebGL2RenderingContext;
  return { gl, calls, texture };
}

/** Image stand-in: node has no DOM, and we need the crossOrigin/src assignment order. */
class FakeImage {
  static mode: 'load' | 'error' = 'load';
  static instances: FakeImage[] = [];
  readonly order: string[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  #crossOrigin: string | null = null;
  #src = '';

  constructor() {
    FakeImage.instances.push(this);
  }

  get crossOrigin(): string | null {
    return this.#crossOrigin;
  }
  set crossOrigin(v: string | null) {
    this.#crossOrigin = v;
    this.order.push('crossOrigin');
  }

  get src(): string {
    return this.#src;
  }
  set src(v: string) {
    this.#src = v;
    this.order.push('src');
    queueMicrotask(() => {
      if (FakeImage.mode === 'load') this.onload?.();
      else this.onerror?.();
    });
  }
}

function installImage(mode: 'load' | 'error' = 'load'): void {
  FakeImage.mode = mode;
  FakeImage.instances = [];
  vi.stubGlobal('Image', FakeImage);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadTexture', () => {
  it('uploads, unbinds and restores the premultiply flag on success', async () => {
    installImage();
    const { gl, calls, texture } = fakeGl();

    await expect(loadTexture(gl, 'app://x/haru.png')).resolves.toBe(texture);

    expect(FakeImage.instances[0].order).toEqual(['crossOrigin', 'src']);
    expect(FakeImage.instances[0].crossOrigin).toBe('anonymous');
    const pixelStore = calls.filter((c) => c[0] === 'pixelStorei');
    expect(pixelStore).toEqual([
      ['pixelStorei', ENUMS.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1],
      ['pixelStorei', ENUMS.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0],
    ]);
    expect(calls.at(-2)).toEqual(['bindTexture', null]);
    expect(calls.some((c) => c[0] === 'deleteTexture')).toBe(false);
  });

  it('rejects, deletes the texture once and restores state when texImage2D throws', async () => {
    installImage();
    const boom = new Error('SecurityError: tainted canvases may not be loaded');
    const { gl, calls, texture } = fakeGl({
      texImage2D: () => {
        throw boom;
      },
    });

    await expect(loadTexture(gl, 'https://cdn/haru.png')).rejects.toThrow(
      'texture upload failed: https://cdn/haru.png',
    );

    const deletes = calls.filter((c) => c[0] === 'deleteTexture');
    expect(deletes).toEqual([['deleteTexture', texture]]);
    expect(calls).toContainEqual(['bindTexture', null]);
    expect(calls.filter((c) => c[0] === 'pixelStorei').at(-1)).toEqual([
      'pixelStorei',
      ENUMS.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
      0,
    ]);
  });

  it('keeps the original failure as the rejection cause', async () => {
    installImage();
    const boom = new Error('SecurityError');
    const { gl } = fakeGl({
      texImage2D: () => {
        throw boom;
      },
    });
    await expect(loadTexture(gl, 'https://cdn/haru.png')).rejects.toMatchObject({ cause: boom });
  });

  it('rejects without deleting anything when createTexture returns null', async () => {
    installImage();
    const { gl, calls } = fakeGl({ createTexture: (): WebGLTexture | null => null });
    await expect(loadTexture(gl, 'app://x/haru.png')).rejects.toThrow('texture upload failed');
    expect(calls.some((c) => c[0] === 'deleteTexture')).toBe(false);
  });

  it('rejects when the image itself fails to load', async () => {
    installImage('error');
    const { gl, calls } = fakeGl();
    await expect(loadTexture(gl, 'app://x/missing.png')).rejects.toThrow(
      'texture load failed: app://x/missing.png',
    );
    expect(calls).toEqual([]);
  });
});
