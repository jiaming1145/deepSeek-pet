import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: 'desktop',
    include: ['src/**/*.test.ts'],
    // Default environment stays `node`: the main-process tests poke Electron/koffi seams and a DOM
    // would only slow them down. A renderer test that needs a document opts in per file with a
    // `// @vitest-environment jsdom` docblock (see src/renderer/pet/debug-panel.test.ts) — the
    // config-level `environmentMatchGlobs` that would express the same rule is deprecated in
    // Vitest 3 and warns on every run.
  },
});
