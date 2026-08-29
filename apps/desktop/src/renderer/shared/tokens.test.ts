import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// A tiny, deterministic CSS reader. It parses only what tokens.css contains:
// custom-property declarations inside brace blocks. No CSS engine, no DOM —
// which is why this file runs in vitest's node environment today and keeps
// passing unchanged once R6 puts src/renderer/** in jsdom.
// ---------------------------------------------------------------------------

const CSS_PATH = fileURLToPath(new URL('./tokens.css', import.meta.url));

let cache: string | undefined;
function css(): string {
  if (cache === undefined) cache = readFileSync(CSS_PATH, 'utf8');
  return cache;
}

/** The text between the brace that follows `from` and its matching close brace. */
function braceBlock(source: string, from: number): string {
  const open = source.indexOf('{', from);
  if (open === -1) throw new Error(`no block after index ${from}`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after index ${from}`);
}

function indexOfOrThrow(source: string, needle: string): number {
  const i = source.indexOf(needle);
  if (i === -1) throw new Error(`tokens.css does not contain ${JSON.stringify(needle)}`);
  return i;
}

/** Custom properties of one block, values whitespace-normalised to single spaces. */
function decls(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const chunk of block.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const t = chunk.trim();
    if (!t.startsWith('--')) continue;
    const colon = t.indexOf(':');
    out.set(t.slice(0, colon).trim(), t.slice(colon + 1).trim().replace(/\s+/g, ' '));
  }
  return out;
}

function lightBlock(): Map<string, string> {
  return decls(braceBlock(css(), indexOfOrThrow(css(), ':root {')));
}
function darkBlock(): Map<string, string> {
  const media = indexOfOrThrow(css(), '@media (prefers-color-scheme: dark)');
  return decls(braceBlock(css(), indexOfOrThrow(css().slice(media), ':root {') + media));
}
function reducedBlock(): Map<string, string> {
  const media = indexOfOrThrow(css(), '@media (prefers-reduced-motion: reduce)');
  return decls(braceBlock(css(), indexOfOrThrow(css().slice(media), ':root {') + media));
}
function emotionBlock(emotion: string): Map<string, string> {
  return decls(braceBlock(css(), indexOfOrThrow(css(), `[data-emotion='${emotion}']`)));
}

// ---------------------------------------------------------------------------
// Colour maths — sRGB, WCAG 2.2 relative luminance and contrast ratio.
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];

function parseHex(value_: string): Rgb {
  const m = /^#([0-9a-fA-F]{6})$/.exec(value_);
  if (!m) throw new Error(`not a 6-digit hex colour: ${value_}`);
  const h = m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function parseRgba(value_: string): [number, number, number, number] {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(value_);
  if (!m) throw new Error(`not an rgba() colour: ${value_}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

/** One level of `var(--x)` indirection is resolved; anything deeper is a design error. */
function value(block: Map<string, string>, name: string): string {
  const raw = block.get(name);
  if (raw === undefined) throw new Error(`missing token ${name}`);
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(raw);
  if (!ref) return raw;
  const target = block.get(ref[1]);
  if (target === undefined) throw new Error(`${name} refers to missing token ${ref[1]}`);
  return target;
}

function colour(block: Map<string, string>, name: string): Rgb {
  return parseHex(value(block, name));
}

function over(fg: [number, number, number, number], bg: Rgb): Rgb {
  return [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])) as Rgb;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The bubble surface composited over the page ground, exactly as §5.8 specifies. */
function band(block: Map<string, string>): Rgb {
  return over(parseRgba(value(block, '--c-bubble-surface')), colour(block, '--c-bg'));
}

// ---------------------------------------------------------------------------
// The token census.
// ---------------------------------------------------------------------------

/** Defined once on :root; theme-independent. */
const ROOT_ONLY = [
  '--r-window', '--r-popover', '--r-bubble', '--r-control', '--r-tooltip',
  '--dur-feedback', '--dur-state', '--dur-overlay', '--dur-exit', '--dur-blink',
  '--ease-enter', '--ease-exit',
  '--font-sans', '--fw-regular', '--fw-medium', '--fw-semibold', '--fw-line',
  '--fs-caption', '--lh-caption', '--fs-body', '--lh-body',
  '--fs-bubble', '--lh-bubble', '--fs-bubble-lg', '--lh-bubble-lg',
  '--fs-title', '--lh-title',
  '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6',
  '--adv-skew', '--adv-cut',
] as const;

/** Defined in both the light block and the dark block. */
const THEME_TOKENS = [
  '--c-bg', '--c-surface', '--c-surface-2', '--c-surface-hint', '--c-border', '--c-border-strong',
  '--c-text', '--c-text-2', '--c-text-3',
  '--c-accent', '--c-accent-text', '--c-accent-weak',
  '--c-ok', '--c-warn', '--c-warn-text', '--c-danger', '--c-danger-text',
  '--c-scrim', '--c-focus-ring',
  '--c-bubble-surface', '--c-bubble-text', '--c-bubble-border', '--c-bubble-tail',
  '--c-plate', '--c-advance', '--c-hint-text',
  '--shadow-popover', '--shadow-bubble', '--shadow-hint',
] as const;

const EMOTIONS = [
  'happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'neutral',
] as const;

/** Body-text pairs. WCAG 2.2 AA normal text. */
const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--c-text', '--c-surface'],
  ['--c-text-2', '--c-surface'],
  ['--c-text-3', '--c-surface'],
  ['--c-text', '--c-surface-2'],
  ['--c-text', '--c-bg'],
  ['--c-text', '--c-accent-weak'],
  ['--c-hint-text', '--c-surface-hint'],
  ['--c-warn-text', '--c-surface-hint'],
  ['--c-danger-text', '--c-surface-hint'],
  ['--c-accent-text', '--c-accent'],
];

/** Non-text UI pairs. WCAG 2.2 AA non-text contrast (1.4.11). */
const UI_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--c-focus-ring', '--c-surface'],
  ['--c-focus-ring', '--c-bg'],
  ['--c-border-strong', '--c-surface'],
  ['--c-ok', '--c-surface'],
  ['--c-warn', '--c-surface'],
  ['--c-danger', '--c-surface'],
];

describe('tokens.css', () => {
  it('opens with the owner-locked direction contract and its seed key', () => {
    const head = css().slice(0, 4000);
    for (const label of ['THESIS', 'OWN-WORLD', 'STORY', 'FIRST VIEWPORT', 'FORM', 'FINISH']) {
      expect(head).toContain(label);
    }
    expect(head).toContain('94ed1849');
    expect(head).toContain('ADV');
  });

  it(':root defines every theme-independent token exactly once and the dark block redefines none', () => {
    const light = lightBlock();
    const dark = darkBlock();
    for (const name of ROOT_ONLY) {
      expect(light.has(name), `:root is missing ${name}`).toBe(true);
      expect(dark.has(name), `the dark block must not redefine ${name}`).toBe(false);
    }
    expect(light.size).toBe(ROOT_ONLY.length + THEME_TOKENS.length);
  });

  it('defines every theme token in both the light and the dark block', () => {
    const light = lightBlock();
    const dark = darkBlock();
    for (const name of THEME_TOKENS) {
      expect(light.has(name), `:root is missing ${name}`).toBe(true);
      expect(dark.has(name), `the dark block is missing ${name}`).toBe(true);
    }
    expect(dark.size).toBe(THEME_TOKENS.length);
  });

  it('keeps the C5 radii, motion, ramp, weights, spacing and family byte-exact', () => {
    const t = lightBlock();
    expect(t.get('--r-window')).toBe('8px');
    expect(t.get('--r-popover')).toBe('8px');
    expect(t.get('--r-bubble')).toBe('14px');
    expect(t.get('--r-control')).toBe('6px');
    expect(t.get('--r-tooltip')).toBe('4px');
    expect(t.get('--dur-feedback')).toBe('100ms');
    expect(t.get('--dur-state')).toBe('180ms');
    expect(t.get('--dur-overlay')).toBe('250ms');
    expect(t.get('--dur-exit')).toBe('160ms');
    expect(t.get('--ease-enter')).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
    expect(t.get('--ease-exit')).toBe('cubic-bezier(0.3, 0, 1, 1)');
    expect(t.get('--fw-regular')).toBe('400');
    expect(t.get('--fw-medium')).toBe('500');
    expect(t.get('--fw-semibold')).toBe('600');
    expect(t.get('--fs-caption')).toBe('12px');
    expect(t.get('--lh-caption')).toBe('18px');
    expect(t.get('--fs-body')).toBe('14px');
    expect(t.get('--lh-body')).toBe('22px');
    expect(t.get('--fs-bubble')).toBe('16px');
    expect(t.get('--lh-bubble')).toBe('26px');
    expect(t.get('--fs-bubble-lg')).toBe('18px');
    expect(t.get('--lh-bubble-lg')).toBe('28px');
    expect(t.get('--fs-title')).toBe('20px');
    expect(t.get('--lh-title')).toBe('28px');
    expect(t.get('--sp-1')).toBe('4px');
    expect(t.get('--sp-2')).toBe('8px');
    expect(t.get('--sp-3')).toBe('12px');
    expect(t.get('--sp-4')).toBe('16px');
    expect(t.get('--sp-5')).toBe('20px');
    expect(t.get('--sp-6')).toBe('24px');
    expect(t.get('--font-sans')).toBe(
      '"MiSans VF", "MiSans", "HarmonyOS Sans SC", "Noto Sans SC", "Source Han Sans SC", ' +
        '"Microsoft YaHei UI", "Segoe UI Variable Text", system-ui, sans-serif',
    );
  });

  it('keeps the C5 popover shadow byte-exact in both themes', () => {
    expect(lightBlock().get('--shadow-popover')).toBe(
      '0 8px 16px rgba(0, 0, 0, .14), 0 0 2px rgba(0, 0, 0, .12)',
    );
    expect(darkBlock().get('--shadow-popover')).toBe(
      '0 8px 16px rgba(0, 0, 0, .28), 0 0 2px rgba(0, 0, 0, .20)',
    );
  });

  it('gives --c-bubble-surface alpha exactly 0.92 in both themes', () => {
    expect(parseRgba(value(lightBlock(), '--c-bubble-surface'))[3]).toBe(0.92);
    expect(parseRgba(value(darkBlock(), '--c-bubble-surface'))[3]).toBe(0.92);
  });

  it('light: bubble text on the composited band is 14.714:1', () => {
    const t = lightBlock();
    const r = ratio(colour(t, '--c-bubble-text'), band(t));
    expect(r).toBeGreaterThanOrEqual(4.5);
    expect(r).toBeCloseTo(14.714, 2);
  });

  it('dark: bubble text on the composited band is 15.255:1', () => {
    const t = darkBlock();
    const r = ratio(colour(t, '--c-bubble-text'), band(t));
    expect(r).toBeGreaterThanOrEqual(4.5);
    expect(r).toBeCloseTo(15.255, 2);
  });

  it('light: every text pair clears 4.5:1', () => {
    const t = lightBlock();
    for (const [fg, bg] of TEXT_PAIRS) {
      expect(ratio(colour(t, fg), colour(t, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dark: every text pair clears 4.5:1', () => {
    const t = darkBlock();
    for (const [fg, bg] of TEXT_PAIRS) {
      expect(ratio(colour(t, fg), colour(t, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('light: every non-text UI pair clears 3:1, on surfaces and on the band', () => {
    const t = lightBlock();
    for (const [fg, bg] of UI_PAIRS) {
      expect(ratio(colour(t, fg), colour(t, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
    expect(ratio(colour(t, '--c-advance'), band(t)), '--c-advance on the band').toBeGreaterThanOrEqual(3);
    expect(ratio(colour(t, '--c-border-strong'), band(t)), '--c-border-strong on the band').toBeGreaterThanOrEqual(3);
  });

  it('dark: every non-text UI pair clears 3:1, on surfaces and on the band', () => {
    const t = darkBlock();
    for (const [fg, bg] of UI_PAIRS) {
      expect(ratio(colour(t, fg), colour(t, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
    expect(ratio(colour(t, '--c-advance'), band(t)), '--c-advance on the band').toBeGreaterThanOrEqual(3);
    expect(ratio(colour(t, '--c-border-strong'), band(t)), '--c-border-strong on the band').toBeGreaterThanOrEqual(3);
  });

  it('tints the plate per emotion and keeps --c-accent-text above 4.5:1 on all nine tints', () => {
    const light = lightBlock();
    const dark = darkBlock();
    const weights = new Set<string>();
    for (const emotion of EMOTIONS) {
      const rule = emotionBlock(emotion);
      const plate = rule.get('--c-plate');
      const weight = rule.get('--fw-line');
      expect(plate, `[data-emotion='${emotion}'] must set --c-plate`).toBeDefined();
      expect(weight, `[data-emotion='${emotion}'] must set --fw-line`).toBeDefined();
      weights.add(weight as string);
      const tint = parseHex(plate as string);
      expect(ratio(colour(light, '--c-accent-text'), tint), `light ${emotion}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(colour(dark, '--c-accent-text'), tint), `dark ${emotion}`).toBeGreaterThanOrEqual(4.5);
    }
    expect([...weights].sort()).toEqual(['var(--fw-medium)', 'var(--fw-regular)']);
  });

  it('collapses every duration to 80ms or less under reduced motion', () => {
    const r = reducedBlock();
    for (const name of ['--dur-feedback', '--dur-state', '--dur-overlay', '--dur-exit']) {
      const v = r.get(name);
      expect(v, `reduced motion must redefine ${name}`).toBeDefined();
      expect(Number((v as string).replace('ms', ''))).toBeLessThanOrEqual(80);
    }
    expect(r.get('--dur-blink')).toBe('0ms');
    expect(r.get('--ease-enter')).toBe('linear');
    expect(r.get('--ease-exit')).toBe('linear');
  });
});
