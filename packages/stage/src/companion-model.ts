import { CubismDefaultParameterId } from '@framework/cubismdefaultparameterid';
import { CubismModelSettingJson } from '@framework/cubismmodelsettingjson';
import type { ICubismModelSetting } from '@framework/icubismmodelsetting';
import { CubismFramework } from '@framework/live2dcubismframework';
import type { CubismIdHandle } from '@framework/id/cubismid';
import { CubismUserModel } from '@framework/model/cubismusermodel';
import { CubismMoc } from '@framework/model/cubismmoc';
import type { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import type { ICubismUpdater } from '@framework/motion/icubismupdater';
import { ACubismMotion } from '@framework/motion/acubismmotion';
import { InvalidMotionQueueEntryHandleValue } from '@framework/motion/cubismmotionqueuemanager';
import { CubismUpdateScheduler } from '@framework/motion/cubismupdatescheduler';
import { CubismBreathUpdater } from '@framework/motion/cubismbreathupdater';
import { CubismEyeBlinkUpdater } from '@framework/motion/cubismeyeblinkupdater';
import { CubismExpressionUpdater } from '@framework/motion/cubismexpressionupdater';
import { CubismLipSyncUpdater } from '@framework/motion/cubismlipsyncupdater';
import { CubismPhysicsUpdater } from '@framework/motion/cubismphysicsupdater';
import { CubismPoseUpdater } from '@framework/motion/cubismposeupdater';
import { IParameterProvider } from '@framework/motion/iparameterprovider';
import { BreathParameterData, CubismBreath } from '@framework/effect/cubismbreath';
import { CubismEyeBlink } from '@framework/effect/cubismeyeblink';
import { CubismLook, LookParameterData } from '@framework/effect/cubismlook';
import { GazeDriver, GazeLookUpdater } from './gaze-driver';
import { MotionFinishTracker } from './motion-callbacks';
import type { MouthDriver } from './mouth';
import { pickIndex, type Rng } from './rng';
import { loadTexture } from './textures';

export const Priority = { none: 0, idle: 1, normal: 2, force: 3 } as const;

/** Adapts our MouthDriver to the Framework's abstract IParameterProvider. */
class MouthProvider extends IParameterProvider {
  constructor(private readonly driver: MouthDriver) {
    super();
  }
  update(dt = 0): boolean {
    return this.driver.update(dt);
  }
  getParameter(): number {
    return this.driver.getParameter();
  }
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.arrayBuffer();
}

export interface CompanionModelOptions {
  baseUrl: string;
  modelJson: string;
  gl: WebGL2RenderingContext;
  shaderPath: string;
  mouth: MouthDriver;
  checkMoc?: boolean;
  /**
   * Random source for idle-motion picks. Injectable so `?test=1` can seed it and spec §9's
   * "with a fixed seed" screenshot comparison stops racing a random idle animation.
   */
  rng?: Rng;
  /**
   * §4.10 `extraMotions`: motion files model3.json does not register, keyed by group. Loaded after
   * the registered groups so `motionGroups()` reports them for bindResources (§4.7).
   */
  extraMotions?: Readonly<Record<string, readonly { file: string }[]>>;
}

export class CompanionModel extends CubismUserModel {
  private setting: ICubismModelSetting;
  private baseUrl = '';
  private shaderPath = '';
  private readonly scheduler = new CubismUpdateScheduler();
  private motionUpdated = false;
  private readonly motions = new Map<string, ACubismMotion>();
  private readonly expressions = new Map<string, ACubismMotion>();
  private eyeBlinkIds: CubismIdHandle[] = [];
  private lipSyncIds: CubismIdHandle[] = [];
  /** Kept so release() can delete them: CubismRenderer_WebGL borrows textures and only nulls its array. */
  private readonly textures: WebGLTexture[] = [];
  private gl: WebGL2RenderingContext = null;
  private rng: Rng = Math.random;
  /** Spec §4.3's gaze easing, in place of the Framework's frame-count-driven CubismTargetPoint. */
  private readonly gaze = new GazeDriver();
  private readonly finishedCallbacks = new MotionFinishTracker();
  /** Post-setupFromLayout model matrix, so the viewport fit is always re-derived from it. */
  private layoutMatrix: Float32Array = null;
  private released = false;
  public idleGroup = 'Idle';
  /** §5.14 item 3: false once the arbiter owns the body lane; tick() then never self-starts idle. */
  public autoIdle = true;
  /** §5.14 item 7: parameter ids the model declares, computed once at the end of setup(). */
  private parameterIdCache: readonly string[] = Object.freeze([]);
  /** Item 8 (gap): extra motion groups loaded from character.json `extraMotions` — group -> count. */
  private extraGroups: Record<string, number> = {};
  private extraMotions: Readonly<Record<string, readonly { file: string }[]>> = {};

  static async load(opts: CompanionModelOptions): Promise<CompanionModel> {
    const m = new CompanionModel();
    if (opts.rng) m.rng = opts.rng;
    if (opts.extraMotions) m.extraMotions = opts.extraMotions;
    // model3.json references its siblings (moc3, textures, expressions/, motions/) relative to ITS
    // OWN directory, so every fetch is rooted at <characterUrl>/<dirname(modelJson)>/, not the character dir.
    const charBase = opts.baseUrl.endsWith('/') ? opts.baseUrl : opts.baseUrl + '/';
    const slash = opts.modelJson.lastIndexOf('/');
    m.baseUrl = charBase + (slash >= 0 ? opts.modelJson.slice(0, slash + 1) : '');
    const modelFile = slash >= 0 ? opts.modelJson.slice(slash + 1) : opts.modelJson;
    m.shaderPath = opts.shaderPath;
    const settingBuf = await fetchBuffer(m.baseUrl + modelFile);
    m.setting = new CubismModelSettingJson(settingBuf, settingBuf.byteLength);
    try {
      await m.setup(opts.gl, opts.mouth, opts.checkMoc ?? true);
    } catch (e) {
      // A partial load (a 404 on a texture, a bad motion3.json) would otherwise strand the moc,
      // model, renderer and any textures already uploaded.
      m.release();
      throw e;
    }
    return m;
  }

  private async setup(
    gl: WebGL2RenderingContext,
    mouth: MouthDriver,
    checkMoc: boolean,
  ): Promise<void> {
    const s = this.setting;
    this.gl = gl;
    const idm = CubismFramework.getIdManager();
    const id = (name: string) => idm.getId(name);

    // moc - version guard first
    const mocBuf = await fetchBuffer(this.baseUrl + s.getModelFileName());
    const mocVersion = CubismMoc.getMocVersionFromBuffer(mocBuf);
    const latest = Live2DCubismCore.Version.csmGetLatestMocVersion();
    if (mocVersion > latest) {
      // Named model file first: spec §8 wants a dialog naming the model, and the renderer forwards
      // only { message }, so anything not in this string cannot reach the user.
      throw new Error(
        `${s.getModelFileName()}: moc3 version ${mocVersion} is newer than bundled Core (${latest})`,
      );
    }
    this.loadModel(mocBuf, checkMoc);
    if (this._model == null) {
      throw new Error(`failed to create model from ${s.getModelFileName()}`);
    }

    // expressions
    for (let i = 0; i < s.getExpressionCount(); i++) {
      const name = s.getExpressionName(i);
      const buf = await fetchBuffer(this.baseUrl + s.getExpressionFileName(i));
      const motion = this.loadExpression(buf, buf.byteLength, name);
      if (motion) this.expressions.set(name, motion);
    }
    // §5.4 / §5.14 item 1: bar §0 "expressions <= 300 ms"; the Framework default is 1.0 s (§0.2).
    this.setExpressionFades(0.3, 0.3);
    this.scheduler.addUpdatableList(new CubismExpressionUpdater(this._expressionManager));

    // physics / pose
    if (s.getPhysicsFileName() !== '') {
      const buf = await fetchBuffer(this.baseUrl + s.getPhysicsFileName());
      this.loadPhysics(buf, buf.byteLength);
      this.scheduler.addUpdatableList(new CubismPhysicsUpdater(this._physics));
    }
    if (s.getPoseFileName() !== '') {
      const buf = await fetchBuffer(this.baseUrl + s.getPoseFileName());
      this.loadPose(buf, buf.byteLength);
      this.scheduler.addUpdatableList(new CubismPoseUpdater(this._pose));
    }

    // eye blink
    if (s.getEyeBlinkParameterCount() > 0) {
      this._eyeBlink = CubismEyeBlink.create(s);
      // CubismEyeBlink draws its next blink time from Math.random (`effect/cubismeyeblink.ts:191`);
      // route it through the injected rng so a seeded stage is deterministic end to end.
      const eyeBlink = this._eyeBlink as unknown as {
        _userTimeSeconds: number;
        _blinkingIntervalSeconds: number;
        determinNextBlinkingTiming: () => number;
      };
      const rng = this.rng;
      eyeBlink.determinNextBlinkingTiming = () =>
        eyeBlink._userTimeSeconds + rng() * (2.0 * eyeBlink._blinkingIntervalSeconds - 1.0);
      this.scheduler.addUpdatableList(
        new CubismEyeBlinkUpdater(() => this.motionUpdated, this._eyeBlink),
      );
    }
    for (let i = 0; i < s.getEyeBlinkParameterCount(); i++) {
      this.eyeBlinkIds.push(s.getEyeBlinkParameterId(i));
    }

    // breath (same constants as the sample)
    const angleX = id(CubismDefaultParameterId.ParamAngleX);
    const angleY = id(CubismDefaultParameterId.ParamAngleY);
    const angleZ = id(CubismDefaultParameterId.ParamAngleZ);
    const bodyX = id(CubismDefaultParameterId.ParamBodyAngleX);
    this._breath = CubismBreath.create();
    this._breath.setParameters([
      new BreathParameterData(angleX, 0.0, 15.0, 6.5345, 0.5),
      new BreathParameterData(angleY, 0.0, 8.0, 3.5345, 0.5),
      new BreathParameterData(angleZ, 0.0, 10.0, 5.5345, 0.5),
      new BreathParameterData(bodyX, 0.0, 4.0, 15.5345, 0.5),
      new BreathParameterData(id(CubismDefaultParameterId.ParamBreath), 0.5, 0.5, 3.2345, 1),
    ]);
    this.scheduler.addUpdatableList(new CubismBreathUpdater(this._breath));

    // user data (optional)
    if (s.getUserDataFile() !== '') {
      const buf = await fetchBuffer(this.baseUrl + s.getUserDataFile());
      this.loadUserData(buf, buf.byteLength);
    }

    // lip sync -> our mouth driver
    for (let i = 0; i < s.getLipSyncParameterCount(); i++) {
      this.lipSyncIds.push(s.getLipSyncParameterId(i));
    }
    if (this.lipSyncIds.length > 0) {
      this.scheduler.addUpdatableList(
        new CubismLipSyncUpdater(this.lipSyncIds, new MouthProvider(mouth)),
      );
    }

    // look (gaze) - driven by our GazeDriver via setGaze(), NOT by _dragManager: CubismTargetPoint
    // advances its position by a per-call constant (cubismtargetpoint.ts:119-120), so its easing
    // speed changed with the 30/60 fps hover switch.
    const look = CubismLook.create();
    look.setParameters([
      new LookParameterData(angleX, 30.0, 0.0, 0.0),
      new LookParameterData(angleY, 0.0, 30.0, 0.0),
      new LookParameterData(angleZ, 0.0, 0.0, -30.0),
      new LookParameterData(bodyX, 10.0, 0.0, 0.0),
      new LookParameterData(id(CubismDefaultParameterId.ParamEyeBallX), 1.0, 0.0, 0.0),
      new LookParameterData(id(CubismDefaultParameterId.ParamEyeBallY), 0.0, 1.0, 0.0),
    ]);
    this.scheduler.addUpdatableList(new GazeLookUpdater(look, this.gaze));
    this.scheduler.sortUpdatableList();

    // layout
    const layout = new Map<string, number>();
    s.getLayoutMap(layout);
    this._modelMatrix.setupFromLayout(layout);
    // Snapshot the baseline before anything applies a viewport fit on top of it.
    this.layoutMatrix = new Float32Array(this._modelMatrix.getArray());

    // motions (preload all groups)
    this._model.saveParameters();
    for (let g = 0; g < s.getMotionGroupCount(); g++) {
      const group = s.getMotionGroupName(g);
      for (let i = 0; i < s.getMotionCount(group); i++) {
        const file = s.getMotionFileName(group, i);
        const buf = await fetchBuffer(this.baseUrl + file);
        const motion = this.loadMotion(
          buf,
          buf.byteLength,
          `${group}_${i}`,
          null,
          null,
          s,
          group,
          i,
          this._motionConsistency,
        );
        if (!motion) continue;
        motion.setEffectIds(this.eyeBlinkIds, this.lipSyncIds);
        this.motions.set(`${group}_${i}`, motion);
      }
    }
    // Item 8 (gap): extraMotions, indexed by array position, so ["Extra", 0] is a normal MotionRef.
    for (const [group, entries] of Object.entries(this.extraMotions)) {
      let count = 0;
      for (let i = 0; i < entries.length; i++) {
        const buf = await fetchBuffer(this.baseUrl + entries[i].file);
        const motion = this.loadMotion(buf, buf.byteLength, `${group}_${i}`, null, null, s, group, i, this._motionConsistency);
        if (!motion) continue;
        motion.setEffectIds(this.eyeBlinkIds, this.lipSyncIds);
        this.motions.set(`${group}_${i}`, motion);
        count++;
      }
      this.extraGroups[group] = count;
    }
    this._motionManager.stopAllMotions();

    // renderer + textures
    this.createRenderer(gl.canvas.width, gl.canvas.height);
    this.getRenderer().startUp(gl);
    this.getRenderer().loadShaders(this.shaderPath);
    this.getRenderer().setIsPremultipliedAlpha(true);
    for (let i = 0; i < s.getTextureCount(); i++) {
      const name = s.getTextureFileName(i);
      if (name === '') continue;
      const tex = await loadTexture(gl, this.baseUrl + name, true);
      this.textures.push(tex);
      this.getRenderer().bindTexture(i, tex);
    }
    // Item 7: computed once; CubismId.getString() returns the raw id string.
    const ids: string[] = [];
    for (let i = 0; i < this._model.getParameterCount(); i++) ids.push(this._model.getParameterId(i).getString());
    this.parameterIdCache = Object.freeze(ids);
    this._updating = false;
    this._initialized = true;
  }

  // ---- public API -------------------------------------------------------

  expressionNames(): string[] {
    return [...this.expressions.keys()];
  }

  motionGroups(): Record<string, number> {
    const out: Record<string, number> = {};
    for (let g = 0; g < this.setting.getMotionGroupCount(); g++) {
      const name = this.setting.getMotionGroupName(g);
      out[name] = this.setting.getMotionCount(name);
    }
    for (const [group, count] of Object.entries(this.extraGroups)) out[group] = count;
    return out;
  }

  hitAreaNames(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.setting.getHitAreasCount(); i++) {
      out.push(this.setting.getHitAreaName(i));
    }
    return out;
  }

  setExpression(name: string | null): void {
    // Public API can be reached from a late callback after release(); the managers are null then.
    if (this.released) return;
    if (name === null) {
      this._expressionManager.stopAllMotions();
      return;
    }
    const motion = this.expressions.get(name);
    if (!motion) throw new Error(`unknown expression ${name}`);
    this._expressionManager.startMotion(motion, false);
  }

  startMotion(group: string, index: number, priority: number, onFinished?: () => void): boolean {
    // Resolve the motion BEFORE touching the reservation. CubismMotionManager only clears
    // _reservePriority inside startMotionPriority, so bailing out after reserving would leak the
    // reservation: every later reserveMotion() would fail and tick()'s idle restart would never
    // fire again.
    if (this.released) return false;
    const motion = this.motions.get(`${group}_${index}`);
    if (!motion) return false;
    if (priority === Priority.force) this._motionManager.setReservePriority(priority);
    else if (!this._motionManager.reserveMotion(priority)) return false;
    // The finished callback belongs to THIS playback, not to the shared preloaded motion object:
    // see MotionFinishTracker. tick() invokes it once the queue entry reports finished.
    const handle = this._motionManager.startMotionPriority(motion, false, priority);
    if (handle === InvalidMotionQueueEntryHandleValue) return false;
    if (onFinished) this.finishedCallbacks.track(handle, onFinished);
    return true;
  }

  hitTest(areaName: string, viewX: number, viewY: number): boolean {
    if (!this._initialized) return false;
    if (this._opacity < 1) return false;
    for (let i = 0; i < this.setting.getHitAreasCount(); i++) {
      if (this.setting.getHitAreaName(i) === areaName) {
        return this.isHit(this.setting.getHitAreaId(i), viewX, viewY);
      }
    }
    return false;
  }

  hitAny(viewX: number, viewY: number): string | null {
    if (!this._initialized) return null;
    for (const name of this.hitAreaNames()) {
      if (this.hitTest(name, viewX, viewY)) return name;
    }
    return null;
  }

  setGaze(x: number, y: number): void {
    this.gaze.setTarget(x, y);
  }

  /** §5.14 item 1: fade-in/out for every loaded expression. Called with (0.30, 0.30) at load. */
  setExpressionFades(inS: number, outS: number): void {
    for (const e of this.expressions.values()) {
      e.setFadeInTime(inS);
      e.setFadeOutTime(outS);
    }
  }

  /** §5.14 item 2: ACubismMotion.setWeight — the arbiter is the only caller and resets to 1.0 on release. */
  setExpressionWeight(name: string, w: number): void {
    const motion = this.expressions.get(name);
    if (!motion) throw new Error(`unknown expression ${name}`);
    motion.setWeight(w);
  }

  /** §5.14 item 4: every arbiter-issued motion. Sets the fade-in, then starts at Priority.force. */
  startMotionForced(group: string, index: number, fadeInS: number, onFinished?: () => void): boolean {
    if (this.released) return false;
    const motion = this.motions.get(`${group}_${index}`);
    if (!motion) return false;
    motion.setFadeInTime(fadeInS);
    return this.startMotion(group, index, Priority.force, onFinished);
  }

  /** §5.14 item 6: registers an updater and re-sorts, so a post-setup add still lands in execution order. */
  addUpdater(u: ICubismUpdater): void {
    if (this.released) return;
    this.scheduler.addUpdatableList(u);
    this.scheduler.sortUpdatableList();
  }

  /** §5.14 item 7: parameter ids the model declares (ResourceCatalogue.parameters). */
  parameterIds(): readonly string[] {
    return this.parameterIdCache;
  }

  /** The post-setupFromLayout model matrix, or null before setup finished. Do not mutate. */
  getLayoutMatrix(): Float32Array | null {
    return this.layoutMatrix;
  }

  /** Frame update - identical order to LAppModel.update() at 5-r.5. */
  tick(dt: number): void {
    if (!this._initialized) return;
    this._model.loadParameters();
    this.motionUpdated = false;
    if (this._motionManager.isFinished()) {
      // Item 3: with the arbiter owning the body lane this restart would be a second owner.
      if (this.autoIdle) {
        const n = this.setting.getMotionCount(this.idleGroup);
        if (n > 0) this.startMotion(this.idleGroup, pickIndex(n, this.rng), Priority.idle);
      }
    } else {
      this.motionUpdated = this._motionManager.updateMotion(this._model, dt);
    }
    this._model.saveParameters();
    this.scheduler.onLateUpdate(this._model, dt);
    this._model.update();
    // After the whole update traversal: a finished callback is free to start another motion, swap
    // the character or dispose the stage without re-entering a manager that is mid-update.
    this.finishedCallbacks.flush(this._motionManager);
  }

  draw(projection: CubismMatrix44, framebuffer: WebGLFramebuffer | null, viewport: number[]): void {
    if (!this._initialized) return;
    const mvp = projection.clone();
    mvp.multiplyByMatrix(this._modelMatrix);
    const r = this.getRenderer();
    r.setMvpMatrix(mvp);
    r.setRenderState(framebuffer, viewport);
    r.drawModel(this.shaderPath);
  }

  /**
   * Releases what CubismUserModel.release() knows nothing about — the update scheduler's updaters,
   * the GL textures loadTexture() created (CubismRenderer_WebGL borrows them and only nulls its own
   * array) and the preloaded motions/expressions (started with autoDelete=false, so the queue never
   * disposes them and their curve data would outlive a replaced character).
   *
   * Idempotent: CubismUserModel.release() is not (`model/cubismusermodel.ts:461`, it nulls the
   * managers it releases), and this is reachable twice — Live2DStage.dispose() calls it, and it is
   * public. Safe to call on a partially loaded model: every field it touches is either initialised
   * at declaration or null-checked, and the Framework's own delete helpers are null-safe.
   */
  override release(): void {
    if (this.released) return;
    this.released = true;
    // CubismUserModel.release() never clears _initialized (`model/cubismusermodel.ts:461`), so
    // tick()/draw()/hitTest guards would keep passing on a released model and dereference the
    // nulled managers. Clear it first: a finished-callback that disposes the stage must be safe.
    this._initialized = false;
    this.finishedCallbacks.clear();
    this.scheduler.release();
    if (this.gl) {
      for (const tex of this.textures) this.gl.deleteTexture(tex);
    }
    this.textures.length = 0;
    // A retained, released model must not keep the context (and its canvas) alive.
    this.gl = null;
    this.layoutMatrix = null;
    super.release();
    // After the managers are down, so nothing can be mid-playback on a released motion.
    // ACubismMotion.delete -> release() drops CubismMotion's parsed curve data
    // (`motion/cubismmotion.ts:801`).
    for (const motion of new Set([...this.motions.values(), ...this.expressions.values()])) {
      if (motion) ACubismMotion.delete(motion);
    }
    this.motions.clear();
    this.expressions.clear();
  }
}
