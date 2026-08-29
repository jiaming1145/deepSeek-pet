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
