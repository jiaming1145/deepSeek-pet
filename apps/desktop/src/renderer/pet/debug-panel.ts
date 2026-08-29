import type { Live2DStage } from '@ds/stage';
import { EMOTIONS } from '@ds/stage';

/** `<div>label…children</div>`, appended to the panel. The label is text, never markup. */
function row(root: HTMLElement, label: string, ...children: Node[]): HTMLDivElement {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(label));
  for (const child of children) div.appendChild(child);
  root.appendChild(div);
  return div;
}

function button(label: string, onclick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

/**
 * Builds the debug HUD from DOM calls rather than an HTML string.
 *
 * Every label here is model-supplied — expression names, motion group names and hit-area names come
 * out of `model3.json`, i.e. out of a character pack. Interpolating them into `innerHTML` made two
 * of them a code path: a name containing `<` or a quote broke out of the attribute it was written
 * into, and the `data-motion="group:index"` round-trip picked the wrong group (or `NaN`) for any
 * group name containing `:`. Neither survives here: names are only ever assigned to `textContent`,
 * and the group/index a button plays is captured in its closure instead of being re-parsed.
 */
export function mountDebugPanel(root: HTMLElement, stage: Live2DStage): void {
  root.classList.add('show');
  root.replaceChildren();

  // expression: the select carries names by *position*, so a name that happens to be '' cannot
  // collide with the "(none)" entry and no name has to survive an attribute round-trip.
  const select = document.createElement('select');
  select.id = 'dbg-expr';
  const values: (string | null)[] = [null, ...stage.model.expressionNames()];
  for (const value of values) {
    const option = document.createElement('option');
    option.textContent = value ?? '(none)';
    select.appendChild(option);
  }
  select.onchange = () => stage.model.setExpression(values[select.selectedIndex] ?? null);
  row(root, 'expression: ', select);

  row(root, 'emotion: ', ...EMOTIONS.map((e) => button(e, () => stage.setEmotion(e))));

  const motions: HTMLButtonElement[] = [];
  for (const [group, count] of Object.entries(stage.model.motionGroups())) {
    for (let index = 0; index < count; index++) {
      motions.push(button(`${group}[${index}]`, () => stage.playMotion([group, index])));
    }
  }
  row(root, 'motion: ', ...motions);

  row(root, 'mouth: ',
    Object.assign(button('talk', () => stage.mouth.start()), { id: 'dbg-talk' }),
    document.createTextNode(' '),
    Object.assign(button('quiet', () => stage.mouth.stop()), { id: 'dbg-quiet' }),
  );

  const hit = document.createElement('div');
  hit.id = 'dbg-hit';
  hit.textContent = 'hit: -';
  root.appendChild(hit);
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
