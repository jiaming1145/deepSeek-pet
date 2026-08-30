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

export interface IdPass {
  width: number;
  height: number;
  /** RGBA8, GL row order (bottom-up). R = partIndex + 1 of the topmost participating drawable with a_i >= PART_ATTRIBUTION_MIN, 0 = none. */
  pixels: Uint8Array;
  /** Top-down lookup. */
  idAt(x: number, y: number): number;
}
export interface IdPassInput {
  model: { getModel(): PickSource; getModelMatrix(): CubismMatrix44 };
  projection: CubismMatrix44;
  textures: readonly WebGLTexture[];
  width: number;
  height: number;
  participates(drawableIndex: number): boolean;
}

const VS = `#version 300 es
in vec2 aPos; in vec2 aUv; uniform mat4 uMvp; uniform float uDepth; out vec2 vUv;
void main(){ vUv = aUv; gl_Position = uMvp * vec4(aPos, 0.0, 1.0); gl_Position.z = uDepth; }`;
const FS_ID = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform sampler2D uMask; uniform vec2 uSize;
uniform float uOpacity; uniform float uId; uniform int uMaskMode; uniform float uMin; out vec4 o;
void main(){
  float a = texture(uTex, vUv).a * uOpacity;
  if (uMaskMode != 0) { float c = texture(uMask, gl_FragCoord.xy / uSize).a; if (uMaskMode == 2) c = 1.0 - c; a *= c; }
  if (a < uMin) discard;
  o = vec4(uId / 255.0, 0.0, 0.0, a);
}`;
const FS_MASK = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform float uOpacity; out vec4 o;
void main(){ o = vec4(0.0, 0.0, 0.0, texture(uTex, vUv).a * uOpacity); }`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}
function rgbaTarget(gl: WebGL2RenderingContext, w: number, h: number): { fbo: WebGLFramebuffer; tex: WebGLTexture } {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { fbo, tex };
}

/**
 * §6.5 step 3. Every participating drawable is drawn with a flat colour R = partIndex + 1 and
 * A = its own composited alpha, with the model's real MVP, masks (one level, inverted bit) and
 * culling. Ordering uses the depth test with depth = render order (later = nearer), so the pixel
 * holds the TOPMOST drawable whose a_i >= PART_ATTRIBUTION_MIN — exactly §6.2 step 10's rule.
 * Exists only for the oracle; production bundles evaluate `DEV` to false and get `null`.
 */
const DEV: boolean = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
function renderIdPassImpl(gl: WebGL2RenderingContext, input: IdPassInput): IdPass {
  const { width: W, height: H } = input;
  const m = input.model.getModel();
  const mvp = input.projection.clone();
  mvp.multiplyByMatrix(input.model.getModelMatrix());
  const idProg = compile(gl, VS, FS_ID), maskProg = compile(gl, VS, FS_MASK);
  const id = rgbaTarget(gl, W, H), mask = rgbaTarget(gl, W, H);
  const depth = gl.createRenderbuffer()!;
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, W, H);
  gl.bindFramebuffer(gl.FRAMEBUFFER, id.fbo);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  const vbo = gl.createBuffer()!, uvbo = gl.createBuffer()!, ibo = gl.createBuffer()!;
  const orders = m.getRenderOrders();
  const idx = Array.from({ length: m.getDrawableCount() }, (_, i) => i).sort((a, b) => orders[a] - orders[b]);
  const masks = m.getDrawableMasks(), maskCounts = m.getDrawableMaskCounts();
  const modelOpacity = m.getModelOapcity();

  const bindMesh = (prog: WebGLProgram, i: number): number => {
    gl.useProgram(prog);
    const pos = m.getDrawableVertexPositions(i), uv = m.getDrawableVertexUvs(i), ind = m.getDrawableVertexIndices(i);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STREAM_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvbo); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STREAM_DRAW);
    const aUv = gl.getAttribLocation(prog, 'aUv'); gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ind, gl.STREAM_DRAW);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uMvp'), false, mvp.getArray());
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, input.textures[m.getDrawableTextureIndex(i)]);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
    if (m.getDrawableCulling(i)) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW); } else gl.disable(gl.CULL_FACE);
    return ind.length;
  };

  gl.viewport(0, 0, W, H);
  gl.bindFramebuffer(gl.FRAMEBUFFER, id.fbo);
  gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    if (!input.participates(i) || !m.getDrawableDynamicFlagIsVisible(i) || m.getDrawableBlendMode(i) !== 0) continue;
    const opacity = m.getDrawableOpacity(i) * modelOpacity * m.getPartOpacityByIndex(m.getDrawableParentPartIndex(i));
    if (opacity < 0.01) continue;
    let maskMode = 0;
    if (maskCounts[i] > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, mask.fbo);
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      for (let j = 0; j < maskCounts[i]; j++) {
        const mi = masks[i][j];
        const n = bindMesh(maskProg, mi);
        gl.uniform1f(gl.getUniformLocation(maskProg, 'uOpacity'), m.getDrawableOpacity(mi));
        gl.uniform1f(gl.getUniformLocation(maskProg, 'uDepth'), 0);
        gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_SHORT, 0);
      }
      gl.blendEquation(gl.FUNC_ADD);
      maskMode = m.getDrawableInvertedMaskBit(i) ? 2 : 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, id.fbo);
    }
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND);
    const n = bindMesh(idProg, i);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mask.tex);
    gl.uniform1i(gl.getUniformLocation(idProg, 'uMask'), 1);
    gl.uniform2f(gl.getUniformLocation(idProg, 'uSize'), W, H);
    gl.uniform1f(gl.getUniformLocation(idProg, 'uOpacity'), opacity);
    gl.uniform1f(gl.getUniformLocation(idProg, 'uId'), m.getDrawableParentPartIndex(i) + 1);
    gl.uniform1i(gl.getUniformLocation(idProg, 'uMaskMode'), maskMode);
    gl.uniform1f(gl.getUniformLocation(idProg, 'uMin'), PART_ATTRIBUTION_MIN);
    // later render order = nearer: depth in [-1, 1), strictly decreasing with k
    gl.uniform1f(gl.getUniformLocation(idProg, 'uDepth'), 1 - (2 * (k + 1)) / (idx.length + 1));
    gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_SHORT, 0);
  }
  const pixels = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  for (const b of [vbo, uvbo, ibo]) gl.deleteBuffer(b);
  gl.deleteRenderbuffer(depth); gl.deleteFramebuffer(id.fbo); gl.deleteFramebuffer(mask.fbo);
  gl.deleteTexture(id.tex); gl.deleteTexture(mask.tex); gl.deleteProgram(idProg); gl.deleteProgram(maskProg);
  return { width: W, height: H, pixels, idAt: (x, y) => pixels[((H - 1 - y) * W + x) * 4] };
}
/** Oracle only (§6.5). `null` outside a DEV build. */
export const renderIdPass: ((gl: WebGL2RenderingContext, input: IdPassInput) => IdPass) | null = DEV ? renderIdPassImpl : null;
