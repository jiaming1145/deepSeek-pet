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
  let dragging: { x: number; y: number } | null = null;
  window.addEventListener('mousemove', (e) => {
    const hit = stage.hitTestClient(e.clientX, e.clientY);
    hover.sample(hit !== null, performance.now());
    if (!bridge) stage.gazeClient(e.clientX, e.clientY); // browser mode: gaze from local mouse
    if (dragging) {
      bridge?.send(Channels.avatarDrag, { dx: e.screenX - dragging.x, dy: e.screenY - dragging.y });
      dragging = { x: e.screenX, y: e.screenY };
    }
    const el = document.getElementById('dbg-hit'); if (el) el.textContent = `hit: ${hit ?? '-'}`;
  });
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (stage.hitTestClient(e.clientX, e.clientY) === null) return;
    dragging = { x: e.screenX, y: e.screenY };
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    const wasDragging = dragging !== null; dragging = null;
    if (wasDragging) bridge?.send(Channels.avatarDragEnd, {});
    const hit = stage.hitTestClient(e.clientX, e.clientY);
    if (hit) {
      bridge?.send(Channels.avatarTap, { hitArea: hit });
      const options = stage.config.tapMotions[hit];
      if (options) {
        const [group, idxs] = Object.entries(options)[0];
        stage.playMotion([group, idxs[Math.floor(Math.random() * idxs.length)]]);
      }
    }
  });

  bridge?.on(Channels.gazeCursor, ({ x, y }) => stage.gazeClient(x, y));
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
