import { CubismFramework, LogLevel, Option } from '@framework/live2dcubismframework';
import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { CubismViewMatrix } from '@framework/math/cubismviewmatrix';
import { CubismWebGLOffscreenManager } from '@framework/rendering/cubismoffscreenmanager';
import {
  parseCharacterConfig,
  type CharacterConfig,
  type Emotion,
  type MotionRef,
} from './character';
import { CompanionModel, Priority } from './companion-model';
import { TextMouthDriver, type MouthDriver } from './mouth';
import { Ticker } from './ticker';
import { ViewTransform } from './view';

let frameworkStarted = false;

/** CubismFramework is a process-wide singleton: start it at most once, never dispose per stage. */
function bootFramework(): void {
  if (frameworkStarted) return;
  const opt = new Option();
  opt.logFunction = (m: string) => console.log('[cubism]', m);
  opt.loggingLevel = LogLevel.LogLevel_Warning;
  CubismFramework.startUp(opt);
  CubismFramework.initialize();
  frameworkStarted = true;
}

/**
 * Owns the WebGL context, the render loop and the projection for one on-screen companion.
 *
 * Coordinate spaces (all four are used below):
 *   client px  - CSS pixels relative to the viewport (pointer events)
 *   device px  - canvas backing-store pixels = client px x devicePixelRatio
 *   NDC        - what GL draws into, [-1, 1] on both axes
 *   view       - what CubismUserModel.isHit() consumes; `projection` maps view -> NDC
 */
export class Live2DStage {
  readonly config: CharacterConfig;
  readonly model: CompanionModel;
  readonly mouth: MouthDriver;
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private view = new ViewTransform(1, 1);
  private readonly viewMatrix = new CubismViewMatrix();
  private readonly ticker: Ticker;
  private disposed = false;

  private constructor(
    canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    config: CharacterConfig,
    model: CompanionModel,
    mouth: MouthDriver,
  ) {
    this.canvas = canvas;
    this.gl = gl;
    this.config = config;
    this.model = model;
    this.mouth = mouth;
    this.ticker = new Ticker((dt) => this.frame(dt));
    this.resize();
  }

  static async create(opts: {
    canvas: HTMLCanvasElement;
    /** directory containing character.json */
    characterUrl: string;
    shaderPath: string;
    mouth?: MouthDriver;
    preserveDrawingBuffer?: boolean;
  }): Promise<Live2DStage> {
    if (typeof Live2DCubismCore === 'undefined') {
      throw new Error('live2dcubismcore.min.js must be loaded via <script> before the stage');
    }
    bootFramework();
    const gl = opts.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    });
    if (!gl) throw new Error('WebGL2 is required');
    const base = opts.characterUrl.endsWith('/') ? opts.characterUrl : opts.characterUrl + '/';
    const cfgRes = await fetch(base + 'character.json');
    if (!cfgRes.ok) throw new Error(`character.json ${cfgRes.status}`);
    const config = parseCharacterConfig(await cfgRes.json());
    const mouth = opts.mouth ?? new TextMouthDriver();

    // Size the backing store before loading: CompanionModel.createRenderer() reads gl.canvas.width/height.
    opts.canvas.width = Math.max(1, Math.round(opts.canvas.clientWidth * devicePixelRatio));
    opts.canvas.height = Math.max(1, Math.round(opts.canvas.clientHeight * devicePixelRatio));
    // The Framework self-initialises this lazily (CubismOffscreenRenderTarget_WebGL
    // .initializeOffscreenManager) and re-initialises whenever the requested size changes, so this
    // call is only about starting from a known size rather than the 0x0 default.
    CubismWebGLOffscreenManager.getInstance().initialize(gl, opts.canvas.width, opts.canvas.height);

    let model: CompanionModel;
    try {
      model = await CompanionModel.load({
        baseUrl: base,
        modelJson: config.model,
        gl,
        shaderPath: opts.shaderPath,
        mouth,
      });
    } catch (e) {
      // The manager holds contexts in a strong Map keyed by the GL context, so a failed load (404,
      // moc-version guard) would otherwise pin this WebGL2 context - and its framebuffers/textures
      // if the renderer already registered lazily - for the process lifetime. Browsers cap live
      // contexts at ~16, so a retry loop would run the app out of contexts.
      CubismWebGLOffscreenManager.getInstance().removeContext(gl);
      throw e;
    }
    model.idleGroup = config.idleGroup;
    return new Live2DStage(opts.canvas, gl, config, model, mouth);
  }

  resize(): void {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * devicePixelRatio));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * devicePixelRatio));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.view = new ViewTransform(w, h);
    const ratio = w / h;
    this.viewMatrix.setScreenRect(-ratio, ratio, -1, 1);
    this.viewMatrix.scale(1, 1);
    this.viewMatrix.setMaxScale(2);
    this.viewMatrix.setMinScale(0.8);
    this.viewMatrix.setMaxScreenRect(-2, 2, -2, 2);
    // Same call frame() makes, so a hit test before the first frame sees the same model matrix.
    if (this.fitByWidth(w, h)) this.model.getModelMatrix().setWidth(2);
    this.model.setRenderTargetSize(w, h);
  }

  setFps(fps: 30 | 60): void {
    this.ticker.setFps(fps);
  }

  start(): void {
    if (this.disposed) return; // frame() would run against a released model
    this.ticker.start();
  }

  stop(): void {
    this.ticker.stop();
  }

  /** The sample's "wide model in a tall window" branch: fit by width instead of by height. */
  private fitByWidth(w: number, h: number): boolean {
    const m = this.model.getModel();
    return m != null && m.getCanvasWidth() > 1 && w < h;
  }

  /** view space -> NDC. Pure: frame() applies the matching setWidth() side effect itself. */
  private projection(w: number, h: number): CubismMatrix44 {
    const p = new CubismMatrix44();
    if (this.fitByWidth(w, h)) p.scale(1, w / h);
    else p.scale(h / w, 1);
    // scaleRelative/translateRelative, not scale/translate: CubismMatrix44.scale() *assigns*
    // _tr[0]/_tr[5] (cubismmatrix44.ts:258) and translate() assigns _tr[12]/_tr[13], so the
    // brief's second scale() call would have discarded the aspect correction above.
    p.scaleRelative(this.config.scale, this.config.scale);
    p.translateRelative(0, this.config.offsetY);
    p.multiplyByMatrix(this.viewMatrix);
    return p;
  }

  private frame(dt: number): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); // transparent background (the sample clears to opaque black)
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const offscreen = CubismWebGLOffscreenManager.getInstance();
    offscreen.beginFrameProcess(gl);
    if (this.fitByWidth(w, h)) this.model.getModelMatrix().setWidth(2);
    const projection = this.projection(w, h);

    this.model.tick(dt);
    this.model.draw(projection, null, [0, 0, w, h]);
    offscreen.endFrameProcess(gl);
    offscreen.releaseStaleRenderTextures(gl);
  }

  private toDevice(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) return { x: 0, y: 0 }; // detached/hidden canvas -> no NaN
    // Normalise against the rendered box rather than multiplying by devicePixelRatio: the two agree
    // once resize() has run, but the ratio form stays correct while the backing store is still stale
    // (CSS box already resized, resize() not called yet) and if the canvas is CSS-scaled.
    return {
      x: ((clientX - r.left) / r.width) * this.canvas.width,
      y: ((clientY - r.top) / r.height) * this.canvas.height,
    };
  }

  /**
   * client px -> hit area name (or null).
   *
   * frame() draws with `NDC = projection * modelMatrix * vertex`, and CubismUserModel.isHit()
   * applies `modelMatrix^-1` itself, so the coordinate it wants is `projection^-1 * NDC`.
   * `projection` only ever holds scales and translations, so invertTransformX/Y is that inverse
   * exactly - including config.scale, config.offsetY, the viewMatrix and the fit-by-width branch.
   */
  hitTestClient(clientX: number, clientY: number): string | null {
    const d = this.toDevice(clientX, clientY);
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ndcX = (d.x / w) * 2 - 1;
    const ndcY = 1 - (d.y / h) * 2;
    const p = this.projection(w, h);
    return this.model.hitAny(p.invertTransformX(ndcX), p.invertTransformY(ndcY));
  }

  /** client px (may be outside the canvas) -> gaze target; ViewTransform.toGaze clamps to [-1, 1]. */
  gazeClient(clientX: number, clientY: number): void {
    const d = this.toDevice(clientX, clientY);
    const g = this.view.toGaze(d.x, d.y);
    this.model.setGaze(g.x, g.y);
  }

  setEmotion(e: Emotion): void {
    const target = this.config.emotionMap[e];
    if (target === null) {
      this.model.setExpression(null);
      return;
    }
    if (typeof target === 'string') {
      this.model.setExpression(target);
      return;
    }
    this.playMotion(target, Priority.normal);
  }

  playMotion(ref: MotionRef, priority: number = Priority.normal): boolean {
    return this.model.startMotion(ref[0], ref[1], priority);
  }

  /** Idempotent: CubismUserModel.release() is not, so guard it. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.model.release();
    CubismWebGLOffscreenManager.getInstance().removeContext(this.gl);
  }
}
