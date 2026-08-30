// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// The .tsx collection guard.
//
// T8's 24 React tests live in `.tsx` files, which vitest only collects because
// `apps/desktop/vitest.config.ts` says `include: ['src/**/*.test.{ts,tsx}']`. That file is T7's
// (contracts.md 1.4) and reached this branch through the disposable bootstrap commit a145f03.
// If an integrator drops a145f03 while merging T8's own commit and T7 has not landed, `include`
// reverts to Phase 1's `src/**/*.test.ts`, every .tsx suite is silently never collected, and
// `pnpm test` still prints green — an invisible regression.
//
// THIS FILE IS THE ALARM. It is a `.ts` file, so it is collected under both the narrow and the
// widened `include`, and it fails loudly the moment the .tsx lane stops working. a145f03 is a
// HARD PREREQUISITE of T8's commit: never merge one without the other, or land T7 first and
// rebase T8 onto it. It runs in `node` by an explicit docblock so it keeps working whichever
// shape contracts.md 1.5's environment rule finally takes.
// ---------------------------------------------------------------------------

const DESKTOP = new URL('../../../', import.meta.url);
const CONFIG = fileURLToPath(new URL('vitest.config.ts', DESKTOP));

/** Every suite whose tests exist only if the .tsx lane is collected, and which needs a DOM. */
const TSX_SUITES = [
  'src/renderer/chat/Composer.test.tsx',
  'src/renderer/chat/History.test.tsx',
  'src/renderer/key/App.test.tsx',
];

describe('tsx test lane', () => {
  it("vitest's include collects .tsx test files", () => {
    const config = readFileSync(CONFIG, 'utf8');
    const include = /include:\s*\[([^\]]*)\]/.exec(config);
    expect(include, `no include: [...] in ${CONFIG}`).not.toBeNull();
    // Phase 1's 'src/**/*.test.ts' does not match, '{ts,tsx}' and '*.test.tsx' both do.
    expect(include?.[1]).toMatch(/tsx/);
  });

  it('every .tsx suite is still on disk', () => {
    for (const rel of TSX_SUITES) {
      expect(existsSync(fileURLToPath(new URL(rel, DESKTOP))), `${rel} is missing`).toBe(true);
    }
  });

  it('every .tsx suite opts into jsdom on line 1', () => {
    for (const rel of TSX_SUITES) {
      const first = readFileSync(fileURLToPath(new URL(rel, DESKTOP)), 'utf8').split('\n', 1)[0];
      expect(first.trim(), `${rel} line 1`).toBe('// @vitest-environment jsdom');
    }
  });
});
