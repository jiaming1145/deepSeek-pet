import { Live2DStage } from '@ds/stage';
import { Channels } from '@ds/protocol';
import { bridge } from './bridge';
import { HoverTracker } from './hover';
import { mountDebugPanel } from './debug-panel';

const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const DEBUG = TEST || params.get('debug') === '1';
const character = params.get('character') ?? 'haru';

async function main(): Promise<void> {
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const stage = await Live2DStage.create({
    canvas, characterUrl: `/characters/${character}`, shaderPath: '/live2d/shaders/', preserveDrawingBuffer: TEST,
  });
  stage.start();
  window.addEventListener('resize', () => stage.resize());

  // hover → click-through toggle (main decides), tap → motion, drag → move window
  const hover = new HoverTracker((inside) => {
    bridge?.send(Channels.avatarHover, { inside });
    stage.setFps(inside ? 60 : 30);
  });
  /** Accumulated pointer travel a press may have and still count as a tap rather than a drag. */
  const TAP_SLOP_PX = 4;
  let dragging: { x: number; y: number; moved: number } | null = null;
  window.addEventListener('mousemove', (e) => {
    // The button can be released where we never see the mouseup (outside the window, or over
    // another window once main has moved us). Without this the drag would stick and every later
    // move would keep dragging the window around.
    if (dragging && e.buttons === 0) {
      dragging = null;
      bridge?.send(Channels.avatarDragEnd, {});
    }
    const hit = stage.hitTestClient(e.clientX, e.clientY);
    hover.sample(hit !== null, performance.now());
    if (!bridge) stage.gazeClient(e.clientX, e.clientY); // browser mode: gaze from local mouse
    if (dragging) {
      const dx = e.screenX - dragging.x;
      const dy = e.screenY - dragging.y;
      dragging = { x: e.screenX, y: e.screenY, moved: dragging.moved + Math.abs(dx) + Math.abs(dy) };
      bridge?.send(Channels.avatarDrag, { dx, dy });
    }
    const el = document.getElementById('dbg-hit'); if (el) el.textContent = `hit: ${hit ?? '-'}`;
  });
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (stage.hitTestClient(e.clientX, e.clientY) === null) return;
    dragging = { x: e.screenX, y: e.screenY, moved: 0 };
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    const press = dragging;
    dragging = null;
    // Anything that moved already sent avatar:drag deltas, so main always gets its terminator.
    if (press && press.moved > 0) bridge?.send(Channels.avatarDragEnd, {});
    // A real drag ends there: letting go after moving the window must not also fire a tap. A press
    // that only jittered is still a tap, which is why the slop is compared instead of `moved > 0`.
    if (press && press.moved >= TAP_SLOP_PX) return;
    const hit = stage.hitTestClient(e.clientX, e.clientY);
    if (hit) {
      bridge?.send(Channels.avatarTap, { hitArea: hit });
      // Flatten every group rather than only Object.entries(...)[0]: a hit area mapped to
      // { TapBody: [0, 1], TapHead: [2] } must be able to pick all three, and {} must do nothing
      // instead of destructuring undefined.
      const candidates: [string, number][] = [];
      for (const [group, idxs] of Object.entries(stage.config.tapMotions[hit] ?? {})) {
        for (const index of idxs) candidates.push([group, index]);
      }
      if (candidates.length > 0) {
        stage.playMotion(candidates[Math.floor(Math.random() * candidates.length)]);
      }
    }
  });

  bridge?.on(Channels.gazeCursor, ({ x, y }) => {
    // Once main turns click-through on, DOM mousemove stops arriving and this forwarded stream is
    // the only cursor signal left - hover has to be sampled from it or it could leave and never
    // come back.
    hover.sample(stage.hitTestClient(x, y) !== null, performance.now());
    stage.gazeClient(x, y);
  });
  bridge?.on(Channels.stageSetFps, ({ fps }) => stage.setFps(fps));
  bridge?.on(Channels.debugExpression, ({ name }) => stage.model.setExpression(name));
  bridge?.on(Channels.debugMotion, ({ group, index }) => stage.playMotion([group, index]));
  bridge?.on(Channels.shellVisibility, ({ hidden }) => (hidden ? stage.stop() : stage.start()));

  if (DEBUG) mountDebugPanel(document.getElementById('debug')!, stage);

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
    (window as unknown as { __stage: unknown }).__stage = {
      ready: true,
      setExpression: (n: string | null) => stage.model.setExpression(n),
      playMotion: (g: string, i: number) => stage.playMotion([g, i]),
      hitTest: (x: number, y: number) => stage.hitTestClient(x, y),
      pixels,
    };
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  bridge?.send(Channels.stageError, { message });
  // textContent, not insertAdjacentHTML: `message` can embed the failing URL, and `character` comes
  // from location.search — enough of a reflected-XSS path to not want an HTML sink here.
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#f55;background:#000;padding:8px';
  pre.textContent = message;
  document.body.appendChild(pre);
});
