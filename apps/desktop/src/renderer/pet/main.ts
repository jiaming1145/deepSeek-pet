import { CubismFramework } from '@framework/live2dcubismframework';
import type { CubismIdHandle } from '@framework/id/cubismid';
import { CubismUpdateOrder, ICubismUpdater } from '@framework/motion/icubismupdater';
import type { CubismModel } from '@framework/model/cubismmodel';
import {
  GpuPressReader, LEAVE_RING, Live2DStage, OverlayUpdater, Picker, STATIONARY_REPICK_HZ,
  loadPickerTextures, movedEnough, nextHoverInside, pickerMapFromConfig, shouldRender, type Rng,
} from '@ds/stage';
import { Channels, LIVELINESS_PRESETS, type Lane, type LaneSource, type Payload, type SimSnapshot } from '@ds/protocol';
import { livelinessMap } from '@ds/sim';
import { BehaviorSelector, bindResources, parseBehaviorPack, type ConditionFacts } from '@ds/behaviors';
import { fpsFor } from '../bubble/fps';
import { bridge } from './bridge';
import { HoverTracker } from './hover';
import { lookupMotion } from './motion-lookup';
import { PoseTracker } from './pose';
import { PressTracker, tapCandidates } from './press';
import { createDebugToggle, inDebugPanel, overDebugPanel } from './debug-panel';
import { Arbiter, BLINK_CLOSED_SLEEPY_S, BLINK_DRAW_INTERVAL_S, type GazeTarget } from './stage/arbiter';
import { BehaviourRunner, CONDITION_POLL_MS } from './stage/behaviour-runner';
import { TAP_SLOP_DIP, TouchReactor } from './stage/touch';
import { GazeLane, LOOK_LEASE_TTL_MS } from './stage/gaze-lane';
import { HoverAckMachine } from './stage/hover-ack';
import { applyUiFlags, createUiFlags } from './stage/ui-flags';   // R3-35 / A3-1
import { DragVisual, applySquash, type DragPose } from './stage/drag-visual';
import { SfxPlayer } from './stage/sfx';

const params = new URLSearchParams(location.search);
// Dev builds only: `import.meta.env.DEV` is a compile-time constant, so the whole hook surface is
// tree-shaken out of the production bundle. Playwright drives the Vite dev server, which is DEV.
const TEST = import.meta.env.DEV && params.get('test') === '1';
const DEBUG = TEST || params.get('debug') === '1';
const character = params.get('character') ?? 'haru';

/**
 * The `?test=1` surface, in one place.
 *
 * Exported so `tests/stage.spec.ts` can `import type` it instead of re-declaring the shape: a
 * renamed method then fails the typecheck instead of silently returning `undefined` in the browser.
 */
export interface StageTestHook {
  ready: boolean;
  setExpression(n: string | null): void;
  playMotion(g: string, i: number): boolean;
  hitTest(x: number, y: number): string | null;
  /** ParamMouthOpenY right now. Polled by tests/mouth-sync.spec.ts (D8). */
  mouth(): number;
  pixels(): { opaque: number; hash: number };
  /** Every tap the PressTracker emitted, in order, with the motion the seeded rng chose for it. */
  taps: { hit: string; motion: [string, number] | null }[];
  /**
   * The most recent motion the arbiter started: with `autoIdle = false` (§5.14 item 3) every motion
   * on the model comes through the body lane, so this is the arbiter's last `startMotionForced`.
   */
  readonly lastMotion: [string, number] | null;
  /** §5.14: the three renderer lanes right now. `source` is null on an idle lane. */
  arbiter(): { lane: Lane; source: LaneSource | null; generation: number }[];
  /** §5.14: the running behaviour id, or null between behaviours. */
  behaviour(): string | null;
}

/**
 * mulberry32: a 32-bit PRNG, seeded, so spec §9's "with a fixed seed" holds. One instance feeds the
 * blink draw, the gaze lane's saccades, the behaviour selector and the tap-motion picks, so a
 * `?test=1` page is reproducible end to end rather than only in one of those places.
 */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Facts before the first sim:state (CONTRACT GAP: unspecified; the liveliness default is §3.1's). */
const DEFAULT_FACTS: ConditionFacts = {
  phase: 'day', present: true, presentation: 'awake', liveliness: LIVELINESS_PRESETS.default, mood: 0, energy: 60,
  onFloor: true, nearEdge: false, cursorNear: false, userIdleS: 0, affection: 0, probableTyping: false,
};
const factsOf = (s: SimSnapshot): ConditionFacts => ({
  phase: s.phase, present: s.presence !== 'absent', presentation: s.presentationMode, liveliness: s.liveliness,
  mood: s.valence, energy: s.energy, onFloor: s.onFloor, nearEdge: s.nearEdge, cursorNear: s.cursorNear,
  userIdleS: s.userIdleS, affection: s.affection, probableTyping: s.probableTyping,
});
/** §5.7 blink state from the snapshot: sleep never blinks; nap lengthens the closed time; idle > 5 s = rest. */
const CURSOR_REST_S = 5;
/**
 * §7.5's pose and §5.9's work-mode fade are the two things that must land BETWEEN the stage's own
 * per-frame fit and its draw, which is exactly where the update scheduler runs (CompanionModel.tick
 * → scheduler.onLateUpdate → model.update() → draw). Ordered just after the §5.7 overlay (450) so a
 * behaviour's head tilt and the drag lean compose additively, and still under breath (500).
 *
 * CONTRACT GAP: §5.5 gives the squash a `feetY` in MODEL space but nothing exposes the model's feet.
 * Cubism model space is y-up with the moc canvas floor at y = 0, so 0 is the planted-feet value for
 * a full-body model drawn on the canvas floor; the compensation term is then zero.
 */
const DRAG_POSE_ORDER = CubismUpdateOrder.CubismUpdateOrder_Drag + 60;
const FEET_Y_MODEL = 0;
class PetPoseUpdater extends ICubismUpdater {
  pose: DragPose | null = null;
  /** 1 = fully opaque. §5.9's work-mode fade tween, re-applied every frame so nothing resets it. */
  opacity = 1;
  constructor(
    private readonly ids: { angleX: CubismIdHandle; angleZ: CubismIdHandle; bodyAngleZ: CubismIdHandle },
    private readonly matrix: { getArray(): Float32Array; setMatrix(a: Float32Array): void; scaleRelative(x: number, y: number): void; translateRelative(x: number, y: number): void } | null,
  ) { super(DRAG_POSE_ORDER); }

  onLateUpdate(model: CubismModel, _deltaTimeSeconds: number): void {
    model.setModelOapcity(this.opacity);
    const p = this.pose;
    if (!p) return;
    const add = (id: CubismIdHandle, v: number): void => { if (v !== 0) model.addParameterValueById(id, v, 1.0); };
    add(this.ids.angleX, p.angleX);
    add(this.ids.angleZ, p.angleZ);
    add(this.ids.bodyAngleZ, p.bodyAngleZ);
    // The stage re-derives the model matrix from the layout baseline every frame (applyFit runs
    // before tick), so THIS frame's matrix is the clean fitted one and copying it here is the
    // private base copy §5.5 demands.
    if (this.matrix && p.squash !== 0) {
      applySquash(this.matrix, new Float32Array(this.matrix.getArray()), p.squash, FEET_Y_MODEL);
    }
  }
}

async function main(): Promise<void> {
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const seeded = TEST ? mulberry32(1) : null;
  /** Where every draw comes from: the seeded stream under `?test=1`, else Math.random. */
  const draw: Rng = seeded ?? Math.random;
  let lastMotion: [string, number] | null = null;

  // The arbiter wraps the rng: with autoIdle=false CubismEyeBlink is the stage's only rng consumer,
  // so every draw it makes is a next-blink draw (§5.7). Constructed before the stage; its ports bind
  // to `stageRef` / `gazeLane` / `overlay`, all of which exist by the first frame.
  let stageRef: Live2DStage | null = null;
  const traceSend = (rec: Payload<'arb:trace'>): void => { bridge?.send(Channels.arbTrace, rec); };
  /** CubismUserModel keeps `_eyeBlink` protected and the Framework exposes no accessor; the cast is
   *  the same precedent `companion-model.ts:176` already uses to seed its next-blink draw. */
  const eyeBlinkOf = (): {
    _nextBlinkingTime: number; _userTimeSeconds: number;
    setBlinkingSetting(closing: number, closed: number, opening: number): void;
    setBlinkingInterval(seconds: number): void;
  } | null => (stageRef?.model as unknown as { _eyeBlink: ReturnType<typeof eyeBlinkOf> } | null)?._eyeBlink ?? null;
  let gazeLane: GazeLane | null = null;
  /** §5.9 "opt-in, default off" — and, since R3-35 / contract Amendment A3-1, actually reachable:
   *  `SimSnapshot.uiWorkMode` and `.uiSfxMuted` ride every `sim:state`, and the A3-1 relay below
   *  writes this box (read by `HoverAckDeps.workMode()` at tick time) and calls `SfxPlayer.setMuted`. */
  const uiFlags = createUiFlags();
  let overlay: OverlayUpdater | null = null;
  let poseUpdater: PetPoseUpdater | null = null;
  const arbiter = new Arbiter({
    now: () => performance.now(),
    schedule: (fn, ms) => { setTimeout(fn, ms); },
    trace: traceSend,
    motion: { startMotionForced: (g, i, fade, done) => { lastMotion = [g, i]; return stageRef?.model.startMotionForced(g, i, fade, done) ?? false; } },
    expression: {
      setExpression: (n) => stageRef?.model.setExpression(n),
      setExpressionWeight: (n, w) => stageRef?.model.setExpressionWeight(n, w),
    },
    // `ArbiterPorts.gaze` is THIS file's adapter onto Task 8's lane; the arbiter never sees GazeLane.
    gaze: {
      apply: (t: GazeTarget, ease) => {
        const now = performance.now();
        if (t.kind === 'anchor') { gazeLane?.look({ kind: 'anchor', anchor: t.anchor }, now); return; }
        if (t.kind === 'point') { gazeLane?.look({ kind: 'point', x: t.x, y: t.y }, now); return; }
        // CONTRACT GAP: §5.6 gives no pattern -> target table and no per-request ease.
        // 'follow'/'cursorLock' ride the cursor; every other pattern releases to the lane's own state.
        if (t.pattern === 'follow' || t.pattern === 'cursorLock') {
          gazeLane?.touchTarget({ x: 0, y: 0, followCursor: true }, ease ?? LOOK_LEASE_TTL_MS, now);
        } else {
          gazeLane?.end('completed', now);
        }
      },
      release: () => gazeLane?.end('completed', performance.now()),
    },
    overlay: { set: (p) => overlay?.set(p) },
    blink: {
      force: () => { const b = eyeBlinkOf(); if (b) b._nextBlinkingTime = b._userTimeSeconds; },
      setSleepy: (on) => eyeBlinkOf()?.setBlinkingSetting(0.1, on ? BLINK_CLOSED_SLEEPY_S : 0.05, 0.15),
    },
  });
  const blinkRng = arbiter.blinkRng(draw);

  const stage = await Live2DStage.create({
    canvas, characterUrl: `/characters/${character}`, shaderPath: '/live2d/shaders/', preserveDrawingBuffer: TEST, rng: blinkRng,
  });
  stageRef = stage;
  // §5.14 items 1 and 3, before the first frame: one owner for the body lane, 300 ms expression fades.
  stage.model.autoIdle = false;
  stage.model.setExpressionFades(0.30, 0.30);
  eyeBlinkOf()?.setBlinkingInterval(BLINK_DRAW_INTERVAL_S);

  // §4.7 stage 1 + stage 2: a bind failure throws BehaviorBindError (角色行为不足…) into main().catch → stage:error.
  const packRes = await fetch(`/characters/${character}/behaviors.json`);
  if (!packRes.ok) throw new Error(`behaviors.json ${packRes.status}`);
  const pack = bindResources(parseBehaviorPack(await packRes.json()), {
    motionGroups: stage.model.motionGroups(), expressions: stage.model.expressionNames(), parameters: stage.model.parameterIds(),
  });
  for (const d of pack.dropped) console.warn(`[behaviors] dropped ${d.id}: ${d.reason}`);

  overlay = new OverlayUpdater();
  stage.model.addUpdater(overlay);
  // `addParameterValueById` compares CubismIdHandle IDENTITY (cubismmodel.ts:615), so a raw string
  // silently matches nothing. Same resolver the §5.7 overlay uses; the Framework is booted by
  // Live2DStage.create above.
  const idOf = (name: string): CubismIdHandle => CubismFramework.getIdManager().getId(name);
  poseUpdater = new PetPoseUpdater(
    { angleX: idOf('ParamAngleX'), angleZ: idOf('ParamAngleZ'), bodyAngleZ: idOf('ParamBodyAngleZ') },
    stage.model.getModelMatrix() as unknown as ConstructorParameters<typeof PetPoseUpdater>[1],
  );
  stage.model.addUpdater(poseUpdater);
  // Task 8's GazeLaneDeps is exactly {rng, setTarget, trace}; the clock is a constructor argument.
  gazeLane = new GazeLane({
    rng: draw,
    setTarget: (x, y) => stage.model.setGaze(x, y),   // Phase 1 GazeDriver sink; the lane sends EYES every tick
    trace: (rec) => traceSend({ tsRenderer: performance.now(), kind: 'gazeBreak', lane: 'gaze', source: null, generation: null, id: '', result: null, value: rec.value, label: rec.label }),
  }, performance.now());
  const sfx = bridge ? new SfxPlayer('/sfx/') : null;
  const dragVisual = new DragVisual();
  const pressReader: GpuPressReader = stage.pressReader;
  // CONTRACT GAP (Concern 3): `Picker` takes ImageData, and nothing on the stage hands it over.
  // Task 11 shipped `loadPickerTextures`, which re-reads model3.json's texture list itself.
  const textures = await loadPickerTextures(`/characters/${character}`, stage.config.model);
  const pickerMap = pickerMapFromConfig(stage.config);
  const picker = new Picker(stage.model, pickerMap, textures, canvas);
  const hitPartDefault = pickerMap.hitPartDefault;

  let facts: ConditionFacts = DEFAULT_FACTS;
  const selector = new BehaviorSelector({ pack, rng: draw, map: livelinessMap(facts.liveliness) });
  const runner = new BehaviourRunner({ selector, arbiter, facts: () => facts, now: () => performance.now(), trace: traceSend });

  /** `Live2DStage` exposes no `running()`; this file owns both start/stop call sites, so it tracks it. */
  let stageRunning = true;
  stage.start();
  window.addEventListener('resize', () => stage.resize());

  const debugRoot = document.getElementById('debug')!;
  const toggleDebugPanel = createDebugToggle(debugRoot, stage);
  /** The pointer counts as "on the pet" while it is over the debug panel, so the panel is clickable. */
  const overPanel = (x: number, y: number): boolean => overDebugPanel(debugRoot, x, y);

  // D7: one policy (fpsFor), one writer (applyFps) — the only place this file changes the fps.
  const fpsState = { hovering: false, speaking: false, moving: false };
  const applyFps = (): void => stage.setFps(fpsFor(fpsState));
  const hover = new HoverTracker((inside) => {
    bridge?.send(Channels.avatarHover, { inside });
    fpsState.hovering = inside;
    applyFps();
  });

  // §6.2 hover consumer: enter at alpha >= ENTER_ALPHA on the exact point, leave only when all nine
  // LEAVE_RING samples are < LEAVE_ALPHA; a move under MOVE_EPS_DIP skips the pick entirely.
  let hoverInside = false;
  let lastPick = { x: Number.NaN, y: Number.NaN };
  const opaqueAt = (x: number, y: number, force = false): boolean => {
    if (!force && Number.isFinite(lastPick.x) && !movedEnough(lastPick.x, lastPick.y, x, y)) return hoverInside;
    lastPick = { x, y };
    const projection = stage.currentProjection();
    const alphas = hoverInside
      ? LEAVE_RING.map(([dx, dy]) => picker.pick(x + dx, y + dy, projection).alpha)
      : [picker.pick(x, y, projection).alpha];
    hoverInside = nextHoverInside(hoverInside, alphas);
    return hoverInside;
  };
  let lastCursor: { x: number; y: number } | null = null;
  setInterval(() => {
    if (!lastCursor || fpsState.moving || !stageRunning) return;
    hover.sample(opaqueAt(lastCursor.x, lastCursor.y, true) || overPanel(lastCursor.x, lastCursor.y), performance.now());
  }, 1000 / STATIONARY_REPICK_HZ);

  // §5.9: the D7 machine (Task 8) drives the gaze glance, the freeze, the fade and the single click.
  const hoverAck = new HoverAckMachine({
    glance: (ttlMs) => { gazeLane?.touchTarget({ x: 0, y: 0, followCursor: true }, ttlMs, performance.now()); },
    setFrozen: (f) => runner.setFrozen(f),
    // CONTRACT GAP: `CompanionModel` has no opacity tween; the fade is driven here and written by
    // PetPoseUpdater every frame (CubismModel.setModelOapcity is a raw setter, not a tween).
    setModelOapcity: (o, fadeMs) => { fadeOpacity(o, fadeMs); },
    sendPassthrough: (faded) => { bridge?.send(Channels.arbPassthrough, { faded }); },
    openChat: () => { bridge?.send(Channels.chatOpen, { source: 'pet', focusComposer: true }); },
    workMode: () => uiFlags.workMode,   // R3-35/A3-1: written by the relay on every sim:state
    trace: (rec) => traceSend({ tsRenderer: performance.now(), kind: 'hoverAck', lane: null, source: null, generation: null, id: '', result: null, value: null, label: rec.label }),
  });
  let opacityTween: { from: number; to: number; startedAt: number; ms: number } | null = null;
  const fadeOpacity = (to: number, fadeMs: number): void => {
    const from = poseUpdater?.opacity ?? 1;
    opacityTween = fadeMs > 0 ? { from, to, startedAt: performance.now(), ms: fadeMs } : null;
    if (!opacityTween && poseUpdater) poseUpdater.opacity = to;
  };

  const taps: StageTestHook['taps'] = [];
  const touch = new TouchReactor({
    arbiter,
    send: (p) => bridge?.send(Channels.arbTouch, p),
    legacyTap: () => {},   // replaced per-tap below so the Phase 1 hit-AREA name is the one at the tap point
    sfx,
    intensity: () => arbiter.liveliness().touchVariantIntensity,
  });
  // `Live2DStage.toDevice` is private (stage.ts:242, Task 11's file); the mapping is the canvas's
  // own rendered-box ratio, so it is re-derived here rather than reaching into another task's file.
  const toDevice = (x: number, y: number): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) return { x: 0, y: 0 };
    return { x: ((x - r.left) / r.width) * canvas.width, y: ((y - r.top) / r.height) * canvas.height };
  };
  const press = new PressTracker({
    slopPx: TAP_SLOP_DIP,
    toDevice,
    queuePress: (p) => pressReader.queue(p),
    pick: (x, y) => picker.pick(x, y, stage.currentProjection()),
    hitPartDefault,
    isRejected: (target) => inDebugPanel(debugRoot, target),
    onGrab: (g) => { arbiter.dragStart(performance.now()); bridge?.send(Channels.arbGrab, g); },
    onRelease: (r) => { arbiter.dragEnd(performance.now()); bridge?.send(Channels.arbRelease, r); },
    onDisagreement: (delta) => traceSend({ tsRenderer: performance.now(), kind: 'laneResult', lane: null, source: 'touch', generation: null, id: 'alphaDelta', result: null, value: delta }),
    onTap: (t) => {
      // §2.9: avatar:tap (Phase 1 hit-area) first, then arb:touch — both for one gesture.
      const hit = stage.hitTestClient(t.clientX, t.clientY);
      if (hit) {
        bridge?.send(Channels.avatarTap, { hitArea: hit });
        const candidates = tapCandidates(stage.config.tapMotions[hit]);
        const motion = candidates.length > 0 ? candidates[Math.floor(draw() * candidates.length)] : null;
        if (TEST) taps.push({ hit, motion });
      }
      touch.tap(t.pressId, t.part, t.alpha, performance.now());
      hoverAck.click(performance.now());
    },
  });
  // §6.3: the reader is the stage's own; the serviced read comes back on the frame after the press.
  stage.onPressRead = (r) => press.resolvePress(r.pressId, r.alpha);

  /** client px -> the [-1,1] gaze target, i.e. ViewTransform.toGaze over the same device mapping.
   *  `GazeDriver.setTarget` clamps to the unit square, so an unconverted client pixel would peg her
   *  eyes at the bottom-right corner for every cursor position on screen. */
  const toGaze = (clientX: number, clientY: number): { x: number; y: number } => {
    const d = toDevice(clientX, clientY);
    return {
      x: Math.max(-1, Math.min(1, (d.x / canvas.width) * 2 - 1)),
      y: Math.max(-1, Math.min(1, -((d.y / canvas.height) * 2 - 1))),
    };
  };

  const sampleCursor = (x: number, y: number): void => {
    lastCursor = { x, y };
    const inside = opaqueAt(x, y) || overPanel(x, y);
    const now = performance.now();
    hover.sample(inside, now);
    // Task 8's machine has enter/move/leave, not cursor(inside).
    if (inside) { if (hoverAck.state === 'out') hoverAck.enter(now); else hoverAck.move(now); }
    else hoverAck.leave(now);
    // CSS px are DIPs in the pet renderer (no zoom), so x/y are the DIP pair; the lane's own x/y
    // are the normalised gaze target it feeds straight into the GazeDriver.
    const g = toGaze(x, y);
    gazeLane?.setCursor({ x: g.x, y: g.y, dipX: x, dipY: y }, now);
  };
  window.addEventListener('mousemove', (e) => {
    // First, so a release we never saw as a mouseup stops the press before anything else runs.
    press.mousemove(e);
    sampleCursor(e.clientX, e.clientY);   // the gaze lane owns the gaze in BOTH lanes now (§5.6)
    const el = document.getElementById('dbg-hit'); if (el) el.textContent = `hit: ${stage.hitTestClient(e.clientX, e.clientY) ?? '-'}`;
  });
  window.addEventListener('mousedown', (e) => press.mousedown(e));
  window.addEventListener('mouseup', (e) => press.mouseup(e));

  bridge?.on(Channels.gazeCursor, ({ x, y }) => {
    // Once main turns click-through on, DOM mousemove stops arriving and this forwarded stream is
    // the only cursor signal left - hover has to be sampled from it or it could leave and never
    // come back.
    sampleCursor(x, y);
  });
  bridge?.on(Channels.debugExpression, ({ name }) => stage.model.setExpression(name));
  bridge?.on(Channels.debugMotion, ({ group, index }) => stage.model.startMotionForced(group, index, 0.25));
  // Hidden means nobody can see her: stop the render loop entirely rather than idling at 30 fps
  // (spec §4.6). The 30/60 split for idle/hovered is decided locally in the HoverTracker callback.
  bridge?.on(Channels.shellVisibility, ({ hidden }) => {
    if (hidden) {
      stage.stop();
      stageRunning = false;
      return;
    }
    stage.start();
    stageRunning = true;
    // Main forced click-through while hidden; forget the cached hover so the next cursor sample
    // (main re-sends one right after showing) re-emits the true hit.
    hover.reset();
  });
  bridge?.on(Channels.debugToggle, () => toggleDebugPanel());

  // ---- Phase 3: sim, mode, motion snapshots (§5.14) ----
  bridge?.on(Channels.simState, (s) => {
    // R3-35 / A3-1 FIRST: the D7 fade and the mute must not lag the frame that arrives with them.
    applyUiFlags(s, uiFlags, { sfx });
    facts = factsOf(s);
    const map = livelinessMap(s.liveliness);
    selector.setLivelinessMap(map);
    arbiter.setLiveliness(s.liveliness);
    arbiter.setValence(s.valence);
    gazeLane?.setLiveliness(map);   // Task 8 takes the map object, not two numbers
    gazeLane?.setPresentation(s.presentationMode);
    arbiter.setBlinkState(s.presentationMode === 'sleep' ? 'sleep' : s.presentationMode === 'nap' ? 'sleepy' : s.userIdleS >= CURSOR_REST_S ? 'rest' : 'follow');
    arbiter.setMode(s.mode);
  });
  bridge?.on(Channels.simEvent, (ev) => arbiter.simEvent(ev.kind, performance.now()));
  bridge?.on(Channels.simWindowMotion, (m) => dragVisual.onSnapshot(m));
  bridge?.on(Channels.simLanding, (l) => { if (dragVisual.onLanding(l)) sfx?.play('land', Math.min(1, l.impulse / 2400)); });
  bridge?.on(Channels.modeChanged, ({ mode }) => arbiter.setMode(mode));

  // Poses and mouth follow the turn (Phase 2, unchanged); the LLM lanes are the arbiter's now.
  // CX-10: one tracker owns the pose so a listening edge can restore the turn's base pose.
  const pose = new PoseTracker((e) => stage.setEmotion(e));
  bridge?.on(Channels.brainState, ({ state }) => {
    fpsState.speaking = state !== 'idle';
    applyFps();
    if (state === 'thinking') {
      pose.setBase('think');
      const think = stage.config.motionMap.think;
      if (think) arbiter.llm({ expression: null, motion: think, look: null, emotion: 'neutral' }, performance.now());
    } else if (state === 'idle') {
      pose.setBase('neutral');
      arbiter.utteranceEnded(performance.now());
    }
  });
  bridge?.on(Channels.brainSentence, (ev) => {
    pose.setBase(ev.emotion);
    const target = stage.config.emotionMap[ev.emotion];
    // M-25: own-property lookup, so `constructor` / `__proto__` from the model never reach the lane.
    const motion = lookupMotion(stage.config.motionMap, ev.motion) ?? (Array.isArray(target) ? target : null);
    arbiter.llm({ expression: typeof target === 'string' ? target : null, motion, look: ev.look ?? null, emotion: ev.emotion }, performance.now());
    // walkTo is main's (§2.6): the renderer receives the field and ignores it.
  });
  bridge?.on(Channels.speechMouth, ({ on }) => (on ? stage.mouth.start() : stage.mouth.stop()));
  bridge?.on(Channels.avatarListening, ({ on }) => {
    pose.setListening(on);
    stage.mouth.stop();
  });

  // C-12: a single tap stays a reaction (Phase 1, unchanged). Double-clicking her opens the chat.
  window.addEventListener('dblclick', (e) => {
    if (stage.hitTestClient(e.clientX, e.clientY) === null) return;
    bridge?.send(Channels.chatOpen, { source: 'pet', focusComposer: true });
  });

  // The arbiter pump: RAF gated by the ticker's own shouldRender at the current fps, so the frame
  // intervals it measures are the render loop's. Also the §12.2 fps record at 1 Hz.
  let lastFrame = 0; let lastFpsTrace = 0; const frameMs: number[] = [];
  const pump = (now: number): void => {
    if (stageRunning && shouldRender(fpsFor(fpsState), lastFrame, now)) {
      const dtMs = lastFrame > 0 ? now - lastFrame : 0;
      if (lastFrame > 0) frameMs.push(dtMs);
      lastFrame = now;
      arbiter.update(now);
      gazeLane?.tick(now);   // Task 8's per-frame step; it pushes the EYES target through deps.setTarget
      hoverAck.tick(now);
      // §7.5: one pose per frame, written into the model by PetPoseUpdater during the stage's tick.
      const dragPose = dragVisual.step(dtMs);
      if (poseUpdater) poseUpdater.pose = dragPose;
      if (dragPose.moving !== fpsState.moving) { fpsState.moving = dragPose.moving; applyFps(); }
      if (opacityTween && poseUpdater) {
        const t = Math.min(1, (now - opacityTween.startedAt) / opacityTween.ms);
        poseUpdater.opacity = opacityTween.from + (opacityTween.to - opacityTween.from) * t;
        if (t >= 1) opacityTween = null;
      }
      if (now - lastFpsTrace >= 1000) {
        lastFpsTrace = now;
        const sorted = [...frameMs].sort((a, b) => a - b);
        const p50 = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
        frameMs.length = 0;
        traceSend({ tsRenderer: now, kind: 'fps', lane: null, source: null, generation: null, id: '', result: null, value: fpsFor(fpsState), value2: p50 });
      }
    }
    requestAnimationFrame(pump);
  };
  requestAnimationFrame(pump);
  setInterval(() => runner.update(), CONDITION_POLL_MS);
  runner.update();

  if (DEBUG) toggleDebugPanel();

  bridge?.send(Channels.stageReady, {
    character, expressions: stage.model.expressionNames(), motionGroups: stage.model.motionGroups(), hitAreas: stage.model.hitAreaNames(),
  });

  if (TEST) {
    const pixels = () => {
      const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = canvas.height;
      const ctx = c2.getContext('2d')!; ctx.drawImage(canvas, 0, 0);
      const d = ctx.getImageData(0, 0, c2.width, c2.height).data;
      let opaque = 0, hash = 0;
      for (let i = 3; i < d.length; i += 4 * 7) { if (d[i] > 10) opaque++; hash = (hash * 31 + d[i - 3] + d[i - 2] * 3 + d[i - 1] * 7) >>> 0; }
      return { opaque, hash };
    };
    const hook: StageTestHook = {
      ready: true,
      setExpression: (n: string | null) => stage.model.setExpression(n),
      playMotion: (g: string, i: number) => stage.model.startMotionForced(g, i, 0.25),
      hitTest: (x: number, y: number) => stage.hitTestClient(x, y),
      mouth: () => stage.mouth.getParameter(),
      pixels,
      taps,
      get lastMotion() { return lastMotion; },
      arbiter: () => arbiter.lanes(),
      behaviour: () => runner.current(),
    };
    (window as unknown as { __stage: StageTestHook }).__stage = hook;
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  bridge?.send(Channels.stageError, { message });
  // textContent, not insertAdjacentHTML: `message` can embed the failing URL, and `character` comes
  // from location.search — enough of a reflected-XSS path to not want an HTML sink here.
  const pre = document.createElement('pre');
  // Fixed and above the canvas, or the promised "console + on-page message" is only half true: the
  // canvas fills the window, so a static <pre> in normal flow sits behind it and is never seen.
  // `margin: 0` because <pre>'s default 1em margin would push the box past the 8 px inset.
  pre.style.cssText = 'position:fixed;inset:8px;z-index:10;margin:0;overflow:auto;color:#f55;background:#000;padding:8px';
  pre.textContent = message;
  document.body.appendChild(pre);
});
