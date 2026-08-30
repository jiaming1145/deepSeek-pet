import { Live2DStage, pickIndex, type Rng } from '@ds/stage';
import { Channels } from '@ds/protocol';
import { fpsFor } from '../bubble/fps';
import { bridge } from './bridge';
import { HoverTracker } from './hover';
import { lookupMotion } from './motion-lookup';
import { PressTracker, tapCandidates } from './press';
import { createDebugToggle, inDebugPanel, overDebugPanel } from './debug-panel';

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
   * The most recent motion picked off the seeded stream: the first idle pick after load, then
   * whatever each tap chose. Null before the first frame.
   */
  readonly lastMotion: [string, number] | null;
}

/**
 * mulberry32: a 32-bit PRNG, seeded, so spec §9's "with a fixed seed" holds. One instance feeds both
 * the stage's idle-motion picks and the tap-motion picks below, so a `?test=1` page is reproducible
 * end to end rather than only in one of the two places motions are chosen.
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

async function main(): Promise<void> {
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const seeded = TEST ? mulberry32(1) : null;
  /** Where every motion pick draws from: the seeded stream under `?test=1`, else Math.random. */
  const draw: Rng = seeded ?? Math.random;
  let lastMotion: [string, number] | null = null;

  /**
   * Re-derives the stage's *first* idle-motion index from the first number it draws, so the spec can
   * see it — `CompanionModel` picks the motion internally and reports nothing.
   *
   * Only the first draw: the stage has two consumers of the injected rng, the idle pick in `tick()`
   * and `CubismEyeBlink`'s next-blink time, and they are indistinguishable from inside the rng. The
   * first draw is unambiguous though — `CubismEyeBlink`'s constructor makes no draw
   * (`vendor/CubismWebFramework/src/effect/cubismeyeblink.ts:164`, `_nextBlinkingTime = 0`), its
   * first one happens in `updateParameters` (`:145`), and `tick()` runs the idle pick *before*
   * `scheduler.onLateUpdate` reaches the blink updater. So draw #1 is the first idle pick.
   *
   * Safe to reference `stage` before its initialiser completes: the first draw happens on the first
   * `tick()`, which cannot run until `create()` has resolved and `start()` has been called.
   */
  // Only the FIRST idle pick is recorded (that is what the determinism test pins); later idle picks
  // do not update lastMotion, taps do.
  let drawn = 0;
  function noteFirstIdlePick(value: number): void {
    if (drawn++ > 0) return;
    const group = stage.config.idleGroup;
    lastMotion = [group, pickIndex(stage.model.motionGroups()[group] ?? 0, () => value)];
  }

  const stage = await Live2DStage.create({
    canvas, characterUrl: `/characters/${character}`, shaderPath: '/live2d/shaders/', preserveDrawingBuffer: TEST,
    rng: seeded ? () => { const value = seeded(); noteFirstIdlePick(value); return value; } : undefined,
  });
  stage.start();
  window.addEventListener('resize', () => stage.resize());

  const debugRoot = document.getElementById('debug')!;
  const toggleDebugPanel = createDebugToggle(debugRoot, stage);
  /** The pointer counts as "on the pet" while it is over the debug panel, so the panel is clickable. */
  const overPanel = (x: number, y: number): boolean => overDebugPanel(debugRoot, x, y);

  // hover → click-through toggle (main decides), tap → motion, drag → move window
  // D7: one policy (fpsFor), one writer (applyFps). Hover and speech both flow through it, so
  // un-hovering mid-reveal can no longer drop the stage to 30 Hz.
  const fpsState = { hovering: false, speaking: false };
  const applyFps = (): void => stage.setFps(fpsFor(fpsState));
  const hover = new HoverTracker((inside) => {
    bridge?.send(Channels.avatarHover, { inside });
    fpsState.hovering = inside;
    applyFps();
  });
  /** Accumulated pointer travel a press may have and still count as a tap rather than a drag. */
  const TAP_SLOP_PX = 4;
  const taps: StageTestHook['taps'] = [];
  const press = new PressTracker({
    hitTest: (x, y) => stage.hitTestClient(x, y),
    slopPx: TAP_SLOP_PX,
    isRejected: (target) => inDebugPanel(debugRoot, target),
    onDragMove: (dx, dy) => bridge?.send(Channels.avatarDrag, { dx, dy }),
    onDragEnd: () => bridge?.send(Channels.avatarDragEnd, {}),
    onTap: (hit) => {
      bridge?.send(Channels.avatarTap, { hitArea: hit });
      const candidates = tapCandidates(stage.config.tapMotions[hit]);
      const motion = candidates.length > 0 ? candidates[pickIndex(candidates.length, draw)] : null;
      if (motion) {
        stage.playMotion(motion);
        lastMotion = motion;
      }
      if (TEST) taps.push({ hit, motion });
    },
  });

  window.addEventListener('mousemove', (e) => {
    // First, so a release we never saw as a mouseup stops the drag before anything else runs.
    press.mousemove(e);
    const hit = stage.hitTestClient(e.clientX, e.clientY);
    hover.sample(hit !== null || overPanel(e.clientX, e.clientY), performance.now());
    if (!bridge) stage.gazeClient(e.clientX, e.clientY); // browser mode: gaze from local mouse
    const el = document.getElementById('dbg-hit'); if (el) el.textContent = `hit: ${hit ?? '-'}`;
  });
  window.addEventListener('mousedown', (e) => press.mousedown(e));
  window.addEventListener('mouseup', (e) => press.mouseup(e));

  bridge?.on(Channels.gazeCursor, ({ x, y }) => {
    // Once main turns click-through on, DOM mousemove stops arriving and this forwarded stream is
    // the only cursor signal left - hover has to be sampled from it or it could leave and never
    // come back.
    hover.sample(stage.hitTestClient(x, y) !== null || overPanel(x, y), performance.now());
    stage.gazeClient(x, y);
  });
  bridge?.on(Channels.debugExpression, ({ name }) => stage.model.setExpression(name));
  bridge?.on(Channels.debugMotion, ({ group, index }) => stage.playMotion([group, index]));
  // Hidden means nobody can see her: stop the render loop entirely rather than idling at 30 fps
  // (spec §4.6). The 30/60 split for idle/hovered is decided locally in the HoverTracker callback.
  bridge?.on(Channels.shellVisibility, ({ hidden }) => {
    if (hidden) {
      stage.stop();
      return;
    }
    stage.start();
    // Main forced click-through while hidden; forget the cached hover so the next cursor sample
    // (main re-sends one right after showing) re-emits the true hit.
    hover.reset();
  });
  bridge?.on(Channels.debugToggle, () => toggleDebugPanel());

  // Poses and mouth follow the turn; the reveal itself lives in the bubble window (R3).
  bridge?.on(Channels.brainState, ({ state }) => {
    fpsState.speaking = state !== 'idle';
    applyFps();
    if (state === 'thinking') {
      stage.setEmotion('think');
      const think = stage.config.motionMap.think;
      if (think) stage.playMotion(think);
    } else if (state === 'idle') {
      stage.setEmotion('neutral');
    }
  });
  bridge?.on(Channels.brainSentence, (ev) => {
    stage.setEmotion(ev.emotion);
    // M-25: own-property lookup, so `constructor` / `__proto__` from the model never reach playMotion.
    const motion = lookupMotion(stage.config.motionMap, ev.motion);
    if (motion) stage.playMotion(motion);
  });
  bridge?.on(Channels.speechMouth, ({ on }) => (on ? stage.mouth.start() : stage.mouth.stop()));
  bridge?.on(Channels.avatarListening, ({ on }) => {
    if (on) stage.setEmotion('curious');
    stage.mouth.stop();
  });

  // C-12: a single tap stays a reaction (Phase 1, unchanged). Double-clicking her opens the chat.
  window.addEventListener('dblclick', (e) => {
    if (stage.hitTestClient(e.clientX, e.clientY) === null) return;
    bridge?.send(Channels.chatOpen, { source: 'pet', focusComposer: true });
  });

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
      playMotion: (g: string, i: number) => stage.playMotion([g, i]),
      hitTest: (x: number, y: number) => stage.hitTestClient(x, y),
      mouth: () => stage.mouth.getParameter(),
      pixels,
      taps,
      get lastMotion() { return lastMotion; },
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
