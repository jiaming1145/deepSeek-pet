// @vitest-environment node
//
// Reads tokens.css off disk, so it needs the node lane for the same reason tokens.test.ts does:
// under R6's jsdom glob the `web` transform mode makes Vite rewrite
// `new URL('./x.css', import.meta.url)` into a dev-server URL and `fileURLToPath` throws. A
// `?raw` import is not an escape either — vitest stubs CSS modules by default and hands back ''.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EMOTIONS } from '@ds/protocol';

/**
 * Controller ruling (T7): the nine `[data-emotion='<e>']` rules in T0's tokens.css must BE the
 * `EMOTIONS` vocabulary from @ds/protocol — not a hand-kept copy of it.
 *
 * `tokens.test.ts` already checks that nine rules exist, but it re-declares the nine names locally,
 * so renaming one in @ds/protocol would leave both files internally consistent while the plate tint
 * went silently dead for the renamed emotion. `Bubble.setEmotion()` (bubble.test.ts) is the
 * consumer that would break, so the identity is asserted here against the one definition (D3).
 */
const CSS_PATH = fileURLToPath(new URL('../shared/tokens.css', import.meta.url));

const emotionRules = (css: string): string[] =>
  [...css.matchAll(/\[data-emotion='([a-z]+)'\]/g)].map((m) => m[1]);

describe('tokens.css emotion map', () => {
  it('carries exactly the nine EMOTIONS from @ds/protocol, one rule each', () => {
    const names = emotionRules(readFileSync(CSS_PATH, 'utf8'));
    expect(names).toHaveLength(9);
    expect(names).toHaveLength(EMOTIONS.length);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...EMOTIONS].sort());
  });
});
