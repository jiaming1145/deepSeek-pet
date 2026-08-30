// @vitest-environment node
//
// Reads chat.css off disk (see bubble/bubble-css.test.ts for why the jsdom lane cannot). Pins the
// final-review craft fixes that have no DOM behaviour to test.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./chat.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const block = (selector: string): string => {
  const m = css.match(new RegExp(`(?:^|(?<!,)\\n)${escapeRe(selector)}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
};

describe('chat.css craft fixes', () => {
  it('M-15: the composer scrolls past CHAT_MAX_ROWS with a thin token-coloured scrollbar', () => {
    const input = block('.composer__input');
    expect(input).toMatch(/overflow-y:\s*auto/);
    expect(input).not.toMatch(/overflow:\s*hidden/);
    expect(input).toMatch(/scrollbar-width:\s*thin/);
    expect(input).toMatch(/scrollbar-color:\s*var\(--c-border-strong\) transparent/);
  });

  it('M-14: reduced motion swaps the appear to an opacity-only keyframe', () => {
    const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduce).toMatch(/\.app\s*\{[^}]*animation-name:\s*adv-appear-fade/);
    const fade = block('@keyframes adv-appear-fade');
    expect(fade).not.toMatch(/transform/);
  });
});
