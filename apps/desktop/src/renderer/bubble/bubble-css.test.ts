// @vitest-environment node
//
// Reads bubble.css off disk (same reason as emotion-tokens.test.ts: the jsdom lane cannot import
// a stylesheet as text). These pin the final-review craft fixes that have no DOM behaviour to test.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./bubble.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The declaration block of the rule whose whole selector list is `selector` (starts a line). */
const block = (selector: string): string => {
  const m = css.match(new RegExp(`(?:^|(?<!,)\\n)${escapeRe(selector)}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
};

describe('bubble.css craft fixes', () => {
  it('M-16: the band root takes no pointer; only the surface and the plate do', () => {
    expect(block('.bubble')).toMatch(/pointer-events:\s*none/);
    expect(block('.bubble__surface,\n.bubble__plate')).toMatch(/pointer-events:\s*auto/);
  });

  it('M-13: the plate carries the outline and its span counter-skews from the token', () => {
    expect(block('.bubble__plate')).toMatch(/border:\s*1px solid var\(--c-border-strong\)/);
    expect(block('.bubble__plate-text')).toMatch(/skewX\(calc\(-1 \* var\(--adv-skew\)\)\)/);
  });

  it('M-11: the anchor notch is flush with the surface edge on every side', () => {
    expect(block(".bubble[data-side='left'] .bubble__anchor")).toMatch(
      /right:\s*calc\(var\(--sp-3\) \+ var\(--notch\) - 3px\)/,
    );
    expect(block(".bubble[data-side='right'] .bubble__anchor")).toMatch(
      /left:\s*calc\(var\(--sp-3\) \+ var\(--notch\) - 3px\)/,
    );
    expect(block(".bubble[data-side='top'] .bubble__anchor")).toMatch(
      /bottom:\s*calc\(var\(--sp-6\) \+ var\(--notch\) - 3px\)/,
    );
    expect(block(".bubble[data-side='bottom'] .bubble__anchor")).toMatch(
      /top:\s*calc\(var\(--plate-h\) \+ var\(--sp-1\) \+ var\(--notch\) - 3px\)/,
    );
  });

  it('M-12: the surface reserves a strip under the last line for the advance mark', () => {
    expect(block('.bubble__surface')).toMatch(
      /padding:\s*var\(--sp-3\) var\(--sp-4\) calc\(var\(--sp-3\) \+ var\(--sp-3\)\)/,
    );
    expect(block('.bubble__advance')).toMatch(/bottom:\s*var\(--sp-1\)/);
  });
});
