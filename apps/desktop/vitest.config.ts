import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'desktop',
    // Widened from Phase 1's 'src/**/*.test.ts' so the .tsx renderer tests are collected at all.
    include: ['src/**/*.test.{ts,tsx}'],
    // Default environment stays `node`: the main-process tests poke Electron/koffi seams, and
    // src/renderer/shared/tokens.test.ts reads tokens.css through
    // `fileURLToPath(new URL('./tokens.css', import.meta.url))`, which throws under jsdom because
    // `import.meta.url` is an http: URL there. A renderer test that needs a document opts in per
    // file with a `// @vitest-environment jsdom` docblock on line 1 (see
    // src/renderer/pet/debug-panel.test.ts, and the three React Testing Library suites). That is
    // Phase 1's documented pattern and contracts.md 1.5's own named replacement for
    // `environmentMatchGlobs`, which is deprecated in vitest 3.2.7 and warns on every run.
    environment: 'node',
    setupFiles: ['./src/renderer/test-setup.ts'],
  },
});
