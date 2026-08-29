// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real @ds/stage barrel pulls in the vendored Cubism Framework and a WebGL2 context; only
// EMOTIONS is used at runtime here, and the types still come from the real declarations.
vi.mock('@ds/stage', () => ({ EMOTIONS: ['happy', 'sad', 'neutral'] as const }));

const { mountDebugPanel } = await import('./debug-panel');
type Live2DStage = Parameters<typeof mountDebugPanel>[1];

/**
 * Names a character pack can legally contain and that the old innerHTML build mangled: markup, a
 * quote, an ampersand, and — for motion groups — the ':' that `data-motion="group:index"` split on.
 */
const EXPRESSIONS = ['<img src=x onerror="boom()">', 'a"b\'c', 'A:B', 'tom&jerry'];
const MOTION_GROUPS = { 'Tap:Body': 2, '<b>bold</b>': 1 };

function fakeStage() {
  const calls: string[] = [];
  const stage = {
    model: {
      expressionNames: () => EXPRESSIONS,
      motionGroups: () => MOTION_GROUPS,
      setExpression: (n: string | null) => calls.push(`expr:${n}`),
    },
    setEmotion: (e: string) => calls.push(`emotion:${e}`),
    playMotion: ([g, i]: [string, number]) => calls.push(`motion:${g}|${i}`),
    mouth: { start: () => calls.push('talk'), stop: () => calls.push('quiet') },
  };
  return { stage: stage as unknown as Live2DStage, calls };
}

let root: HTMLElement;
let calls: string[];

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.appendChild(root);
  const f = fakeStage();
  calls = f.calls;
  mountDebugPanel(root, f.stage);
});

/** The button whose visible label is exactly `label`. */
function byLabel(label: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).filter((b) => b.textContent === label);
  expect(found, `one button labelled ${JSON.stringify(label)}`).toHaveLength(1);
  return found[0];
}

describe('mountDebugPanel — hostile model names', () => {
  it('renders every name as text, creating no markup from it', () => {
    expect(root.querySelectorAll('img, b')).toHaveLength(0);
    // The raw characters survive verbatim in the text layer, so nothing was escaped away either.
    for (const name of EXPRESSIONS) expect(root.textContent).toContain(name);
    expect(root.textContent).toContain('Tap:Body[1]');
    expect(root.textContent).toContain('<b>bold</b>[0]');
    // innerHTML is where the old build put them; assert the markup is escaped there.
    expect(root.innerHTML).toContain('&lt;img src=x onerror="boom()"&gt;');
  });

  it('selects the exact expression name, by position rather than by attribute value', () => {
    const select = root.querySelector<HTMLSelectElement>('#dbg-expr')!;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['(none)', ...EXPRESSIONS]);
    for (const [i, name] of EXPRESSIONS.entries()) {
      select.selectedIndex = i + 1;
      select.dispatchEvent(new Event('change'));
      expect(calls.at(-1)).toBe(`expr:${name}`);
    }
    select.selectedIndex = 0;
    select.dispatchEvent(new Event('change'));
    expect(calls.at(-1)).toBe('expr:null');
  });

  it('plays the exact group and index, including a group name containing ":"', () => {
    byLabel('Tap:Body[0]').click();
    byLabel('Tap:Body[1]').click();
    byLabel('<b>bold</b>[0]').click();
    expect(calls).toEqual(['motion:Tap:Body|0', 'motion:Tap:Body|1', 'motion:<b>bold</b>|0']);
  });

  it('wires the emotion buttons and the mouth controls', () => {
    byLabel('happy').click();
    byLabel('neutral').click();
    root.querySelector<HTMLButtonElement>('#dbg-talk')!.click();
    root.querySelector<HTMLButtonElement>('#dbg-quiet')!.click();
    expect(calls).toEqual(['emotion:happy', 'emotion:neutral', 'talk', 'quiet']);
  });

  it('shows the panel and keeps the hit readout main.ts writes into', () => {
    expect(root.classList.contains('show')).toBe(true);
    expect(root.querySelector('#dbg-hit')!.textContent).toBe('hit: -');
  });
});
