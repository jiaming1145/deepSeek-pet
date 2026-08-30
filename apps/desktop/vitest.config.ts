import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'desktop',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Renderer tests need a DOM; main/preload tests must stay in node.
    // T0's tokens.test.ts is the one renderer test that must NOT get a DOM: it reads tokens.css
    // through `fileURLToPath(new URL('./tokens.css', import.meta.url))`, and under jsdom
    // `import.meta.url` is an http: URL, so that call throws "The URL must be of scheme file".
    // environmentMatchGlobs takes the first matching rule, so the narrower one is listed first.
    environmentMatchGlobs: [['src/renderer/shared/tokens.test.ts', 'node'], ['src/renderer/**', 'jsdom']],
    setupFiles: ['./src/renderer/test-setup.ts'],
  },
});
