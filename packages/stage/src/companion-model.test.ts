import { afterEach, describe, expect, it, vi } from 'vitest';

/** Version numbers the Core stand-in below reports; individual tests move them. */
let latestMocVersion = 4;
let bufferMocVersion = 4;

/**
 * The Cubism Core is proprietary and browser-only, but `vendor/CubismWebFramework/src/model/
 * cubismmodel.ts:23-28` reads `Live2DCubismCore.ColorBlendType_*` at *module* scope, so
 * companion-model.ts cannot even be imported without the global existing. Everything else the
 * Framework does with the Core happens inside functions this file never reaches.
 *
 * The stand-in below answers the blend-mode constants with 0 and the three version/logging entry
 * points the moc guard needs. It is a test double for module-load, not a Core implementation: any
 * test that needs real Core behaviour belongs in the Playwright suite (Lane C).
 */
const core: Record<string, unknown> = {
  Version: {
    csmGetVersion: () => 0x05000000,
    csmGetLatestMocVersion: () => latestMocVersion,
    csmGetMocVersion: () => bufferMocVersion,
  },
  Logging: { csmSetLogFunction: () => {}, csmGetLogFunction: () => () => {} },
  Memory: { initializeAmountOfMemory: () => {} },
};
(globalThis as Record<string, unknown>).Live2DCubismCore = new Proxy(core, {
  get: (target, prop) => (prop in target ? target[prop as string] : 0),
});

const { ACubismMotion } = await import('@framework/motion/acubismmotion');
const { CompanionModel, Priority } = await import('./companion-model');
const { CubismUpdateOrder, ICubismUpdater } = await import('@framework/motion/icubismupdater');

type AnyModel = InstanceType<typeof CompanionModel> & Record<string, never>;

class StubMotion extends ACubismMotion {
  released = 0;
  doUpdateParameters(): void {}
  override release(): void {
    this.released++;
    super.release();
  }
}

/** Serves a minimal model3.json and an (unparsed) moc3 buffer, so load() reaches the moc guard. */
function stubModelFetch(): void {
  const model3 = JSON.stringify({
    Version: 3,
    FileReferences: { Moc: 'Haru.moc3', Textures: [], Expressions: [], Motions: {} },
    Groups: [],
    HitAreas: [],
  });
  vi.stubGlobal('fetch', async (url: string) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () =>
      url.endsWith('.model3.json')
        ? new TextEncoder().encode(model3).buffer
        : new ArrayBuffer(64),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  latestMocVersion = 4;
  bufferMocVersion = 4;
});

function bareModel() {
  // CubismUserModel's constructor only builds the managers (model/cubismusermodel.ts:423-455) -
  // no Core, no GL - so a bare instance is enough to exercise startMotion and release.
  const model = new CompanionModel();
  const internals = model as unknown as {
    motions: Map<string, unknown>;
    expressions: Map<string, unknown>;
    finishedCallbacks: { pending: number; flush(source: unknown): void };
    _motionManager: {
      getCubismMotionQueueEntries(): { setIsFinished(v: boolean): void }[];
      isFinishedByHandle(h: unknown): boolean;
    };
    gaze: { getTargetX(): number; getTargetY(): number };
    scheduler: { release(): void };
  };
  return { model, internals };
}

describe('CompanionModel.startMotion', () => {
  it('keys the finished callback to the playback, not to the shared motion object', () => {
    const { model, internals } = bareModel();
    const motion = new StubMotion();
    internals.motions.set('Idle_0', motion);
    const fired: string[] = [];

    expect(model.startMotion('Idle', 0, Priority.normal, () => fired.push('first'))).toBe(true);
    // Force-restart of the SAME preloaded motion while the first entry is still fading out.
    expect(model.startMotion('Idle', 0, Priority.force, () => fired.push('second'))).toBe(true);

    // The shared motion's own handler is never touched any more - that was the bug.
    expect(motion.getFinishedMotionHandler()).toBeUndefined();
    expect(internals.finishedCallbacks.pending).toBe(2);

    const entries = internals._motionManager.getCubismMotionQueueEntries();
    expect(entries.length).toBe(2);

    entries[0].setIsFinished(true);
    internals.finishedCallbacks.flush(internals._motionManager);
    expect(fired).toEqual(['first']);

    entries[1].setIsFinished(true);
    internals.finishedCallbacks.flush(internals._motionManager);
    expect(fired).toEqual(['first', 'second']);
    expect(internals.finishedCallbacks.pending).toBe(0);
  });

  it('tracks nothing for a playback with no callback', () => {
    const { model, internals } = bareModel();
    internals.motions.set('Idle_0', new StubMotion());
    expect(model.startMotion('Idle', 0, Priority.normal)).toBe(true);
    expect(internals.finishedCallbacks.pending).toBe(0);
  });

  it('returns false for an unknown motion without leaking the reservation', () => {
    const { model, internals } = bareModel();
    expect(model.startMotion('Idle', 7, Priority.normal)).toBe(false);
    internals.motions.set('Idle_0', new StubMotion());
    expect(model.startMotion('Idle', 0, Priority.normal)).toBe(true);
  });
});

describe('CompanionModel.setGaze', () => {
  it('drives the GazeDriver, not the Framework drag manager', () => {
    const { model, internals } = bareModel();
    model.setGaze(0.5, -0.5);
    expect(internals.gaze.getTargetX()).toBe(0.5);
    expect(internals.gaze.getTargetY()).toBe(-0.5);
    // _dragManager is left at rest: gaze no longer routes through CubismTargetPoint.
    const drag = model as unknown as { _dragManager: { getX(): number; getY(): number } };
    expect(drag._dragManager.getX()).toBe(0);
    expect(drag._dragManager.getY()).toBe(0);
  });
});

describe('CompanionModel.release', () => {
  it('releases every preloaded motion and expression exactly once, and clears both maps', () => {
    const { model, internals } = bareModel();
    const idle = new StubMotion();
    const tap = new StubMotion();
    const smile = new StubMotion();
    internals.motions.set('Idle_0', idle);
    internals.motions.set('Tap_0', tap);
    internals.expressions.set('smile', smile);

    model.release();

    expect([idle.released, tap.released, smile.released]).toEqual([1, 1, 1]);
    expect(internals.motions.size).toBe(0);
    expect(internals.expressions.size).toBe(0);
  });

  it('is idempotent: a second release is a no-op', () => {
    const { model, internals } = bareModel();
    const idle = new StubMotion();
    internals.motions.set('Idle_0', idle);
    let schedulerReleases = 0;
    const scheduler = internals.scheduler;
    const originalRelease = scheduler.release.bind(scheduler);
    scheduler.release = () => {
      schedulerReleases++;
      originalRelease();
    };

    model.release();
    model.release();
    model.release();

    expect(schedulerReleases).toBe(1);
    expect(idle.released).toBe(1);
  });

  it('drops pending finished callbacks instead of firing them after disposal', () => {
    const { model, internals } = bareModel();
    internals.motions.set('Idle_0', new StubMotion());
    let fired = 0;
    model.startMotion('Idle', 0, Priority.normal, () => fired++);
    expect(internals.finishedCallbacks.pending).toBe(1);
    model.release();
    expect(internals.finishedCallbacks.pending).toBe(0);
    expect(fired).toBe(0);
  });

  it('survives a setup that failed before the renderer existed', async () => {
    // The moc-version guard is the earliest possible failure, so nothing but `setting` is built.
    latestMocVersion = 4;
    bufferMocVersion = 6;
    const release = vi.spyOn(CompanionModel.prototype, 'release');
    stubModelFetch();

    await expect(
      CompanionModel.load({
        baseUrl: 'app://characters/haru/',
        modelJson: 'model/Haru.model3.json',
        gl: null as never,
        shaderPath: 'app://live2d/shaders/',
        mouth: null as never,
      }),
    ).rejects.toThrow('Haru.moc3: moc3 version 6 is newer than bundled Core (4)');

    // load()'s cleanup ran exactly once and did not throw on the half-built model.
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.results[0].type).toBe('return');
  });

  it('deletes the GL textures it owns, once', () => {
    const { model, internals } = bareModel();
    const deleted: unknown[] = [];
    const gl = { deleteTexture: (t: unknown) => deleted.push(t) };
    const priv = model as unknown as { gl: unknown; textures: unknown[] };
    priv.gl = gl;
    priv.textures.push({ id: 't0' }, { id: 't1' });

    model.release();
    model.release();

    expect(deleted.length).toBe(2);
    expect(internals.motions.size).toBe(0);
  });
});

describe('CompanionModel after release()', () => {
  it('answers hit tests, expression and motion calls without touching released managers', () => {
    const { model } = bareModel();
    model.release();
    expect(() => model.hitTest('Head', 0, 0)).not.toThrow();
    expect(model.hitTest('Head', 0, 0)).toBe(false);
    expect(model.hitAny(0, 0)).toBeNull();
    expect(() => model.setExpression(null)).not.toThrow();
    expect(model.startMotion('Idle', 0, 1)).toBe(false);
  });
});

describe('CompanionModel — Phase 3 hooks (§5.14)', () => {
  class StubUpdater extends ICubismUpdater {
    onLateUpdate(): void {}
  }
  function hooked() {
    const model = new CompanionModel();
    const internals = model as unknown as {
      motions: Map<string, InstanceType<typeof StubMotion>>;
      expressions: Map<string, InstanceType<typeof StubMotion>>;
      scheduler: { getUpdatableCount(): number; getUpdatable(i: number): InstanceType<typeof ICubismUpdater> | null };
      extraGroups: Record<string, number>;
      parameterIdCache: readonly string[];
      setting: unknown;
      _model: unknown;
      _initialized: boolean;
      _motionManager: { setReservePriority(p: number): void };
    };
    return { model, internals };
  }

  it('item 1: setExpressionFades applies both fades to every loaded expression', () => {
    const { model, internals } = hooked();
    const a = new StubMotion(); const b = new StubMotion();
    internals.expressions.set('F01', a); internals.expressions.set('F02', b);
    model.setExpressionFades(0.3, 0.3);
    expect([a.getFadeInTime(), a.getFadeOutTime(), b.getFadeInTime(), b.getFadeOutTime()]).toEqual([0.3, 0.3, 0.3, 0.3]);
  });

  it('item 2: setExpressionWeight sets ACubismMotion.setWeight on the named expression and throws on unknown', () => {
    const { model, internals } = hooked();
    const f = new StubMotion(); internals.expressions.set('F07', f);
    model.setExpressionWeight('F07', 0.65);
    expect(f.getWeight()).toBe(0.65);
    expect(() => model.setExpressionWeight('F99', 1)).toThrow('unknown expression F99');
  });

  it('item 3: autoIdle defaults to true and, when false, tick() never restarts the idle group', () => {
    const { model, internals } = hooked();
    expect(model.autoIdle).toBe(true);
    internals._initialized = true;
    internals._model = { loadParameters() {}, saveParameters() {}, update() {} };
    internals.setting = { getMotionCount: () => 2 };
    const start = vi.spyOn(model, 'startMotion').mockReturnValue(true);
    model.autoIdle = false;
    model.tick(1 / 60);
    expect(start).not.toHaveBeenCalled();
    model.autoIdle = true;
    model.tick(1 / 60);
    expect(start).toHaveBeenCalledWith('Idle', expect.any(Number), Priority.idle);
  });

  it('item 4: startMotionForced sets the fade-in then starts at Priority.force', () => {
    const { model, internals } = hooked();
    const m = new StubMotion(); internals.motions.set('TapBody_1', m);
    const reserve = vi.spyOn(internals._motionManager, 'setReservePriority');
    let done = 0;
    expect(model.startMotionForced('TapBody', 1, 0.12, () => done++)).toBe(true);
    expect(m.getFadeInTime()).toBeCloseTo(0.12, 6);
    expect(reserve).toHaveBeenCalledWith(Priority.force);
    expect(model.startMotionForced('TapBody', 9, 0.12)).toBe(false);
    expect(done).toBe(0);
  });

  it('item 6: addUpdater lands in execution order (450 sits between Drag 400 and Breath 500) and is a no-op after release', () => {
    const { model, internals } = hooked();
    const breath = new StubUpdater(CubismUpdateOrder.CubismUpdateOrder_Breath);
    const drag = new StubUpdater(CubismUpdateOrder.CubismUpdateOrder_Drag);
    const overlay = new StubUpdater(450);
    model.addUpdater(breath); model.addUpdater(drag); model.addUpdater(overlay);
    expect(internals.scheduler.getUpdatableCount()).toBe(3);
    expect([0, 1, 2].map((i) => internals.scheduler.getUpdatable(i)?.getExecutionOrder())).toEqual([400, 450, 500]);
    model.release();
    model.addUpdater(new StubUpdater(450));
    expect(internals.scheduler.getUpdatableCount()).toBe(0);
  });

  it('item 7: parameterIds() returns the cached, frozen list', () => {
    const { model, internals } = hooked();
    expect(model.parameterIds()).toEqual([]);
    internals.parameterIdCache = Object.freeze(['ParamAngleX', 'ParamTere']);
    expect(model.parameterIds()).toEqual(['ParamAngleX', 'ParamTere']);
    expect(Object.isFrozen(model.parameterIds())).toBe(true);
  });

  it('item 8 (gap): motionGroups() merges extraMotions groups after the model3.json groups', () => {
    const { model, internals } = hooked();
    internals.setting = { getMotionGroupCount: () => 1, getMotionGroupName: () => 'Idle', getMotionCount: () => 2 };
    internals.extraGroups = { Extra: 1 };
    expect(model.motionGroups()).toEqual({ Idle: 2, Extra: 1 });
  });
});
