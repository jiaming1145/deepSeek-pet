import type { Live2DStage } from '@ds/stage';
import { EMOTIONS } from '@ds/stage';

export function mountDebugPanel(root: HTMLElement, stage: Live2DStage): void {
  root.classList.add('show');
  const exprs = stage.model.expressionNames();
  const groups = stage.model.motionGroups();
  root.innerHTML = `
    <div>expression: <select id="dbg-expr"><option value="">(none)</option>${exprs.map((e) => `<option>${e}</option>`).join('')}</select></div>
    <div>emotion: ${EMOTIONS.map((e) => `<button data-emo="${e}">${e}</button>`).join('')}</div>
    <div>motion: ${Object.entries(groups).map(([g, n]) => Array.from({ length: n }, (_, i) => `<button data-motion="${g}:${i}">${g}[${i}]</button>`).join('')).join('')}</div>
    <div>mouth: <button id="dbg-talk">talk</button> <button id="dbg-quiet">quiet</button></div>
    <div id="dbg-hit">hit: -</div>`;
  root.querySelector<HTMLSelectElement>('#dbg-expr')!.onchange = (ev) => {
    const v = (ev.target as HTMLSelectElement).value;
    stage.model.setExpression(v === '' ? null : v);
  };
  root.querySelectorAll<HTMLButtonElement>('[data-emo]').forEach((b) => (b.onclick = () => stage.setEmotion(b.dataset.emo as (typeof EMOTIONS)[number])));
  root.querySelectorAll<HTMLButtonElement>('[data-motion]').forEach((b) => (b.onclick = () => { const [g, i] = b.dataset.motion!.split(':'); stage.playMotion([g, Number(i)]); }));
  root.querySelector<HTMLButtonElement>('#dbg-talk')!.onclick = () => stage.mouth.start();
  root.querySelector<HTMLButtonElement>('#dbg-quiet')!.onclick = () => stage.mouth.stop();
}

/**
 * Show/hide the panel, mounting it on first use. The mount is lazy because it enumerates the
 * model's expressions and motions, which only exist once the stage has loaded — and because a
 * non-debug session should never build the markup at all.
 */
export function createDebugToggle(root: HTMLElement, stage: Live2DStage): () => void {
  let mounted = false;
  return () => {
    if (!mounted) {
      mounted = true;
      mountDebugPanel(root, stage); // adds `show`
      return;
    }
    root.classList.toggle('show');
  };
}

/**
 * True when the panel is on screen and the point is over it (client px).
 *
 * The panel lives inside the click-through pet window, so the window only stops ignoring the mouse
 * while the pointer is judged "inside". Without counting the panel as inside, its buttons would
 * only be clickable where they happen to overlap the model's silhouette.
 */
export function overDebugPanel(root: HTMLElement, x: number, y: number): boolean {
  if (!root.classList.contains('show')) return false;
  const r = root.getBoundingClientRect();
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

/** True when an event target is the panel or lives inside it. */
export function inDebugPanel(root: HTMLElement, target: EventTarget | null): boolean {
  return target instanceof Node && root.contains(target);
}
