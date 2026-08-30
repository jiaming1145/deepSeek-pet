import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'desktop',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Renderer tests need a DOM; main/preload tests must stay in node.
    //
    // READ THIS BEFORE ADDING A src/renderer/** TEST THAT TOUCHES THE FILESYSTEM (T7 fix round 1).
    // This glob is R6/§1.5's literal and stays as written. Its one sharp edge: jsdom puts the file
    // through Vite's `web` transform, where `new URL('./x.css', import.meta.url)` is rewritten to a
    // dev-server `http://localhost:3000/...` URL and `fileURLToPath` throws "The URL must be of
    // scheme file"; `import '...?raw'` comes back as `''` for the same reason. Two files already
    // read a real file and therefore carry a `// @vitest-environment node` docblock — the per-file
    // lever §1.5 itself names, and the mirror image of pet/debug-panel.test.ts's jsdom docblock:
    // src/renderer/shared/tokens.test.ts and src/renderer/bubble/emotion-tokens.test.ts. §1.4's
    // "runs in the node environment on purpose, precisely so T0 does not have to touch this file"
    // is superseded by exactly that one docblock; no assertion in either file changed.
    environmentMatchGlobs: [['src/renderer/**', 'jsdom']],
    setupFiles: ['./src/renderer/test-setup.ts'],
  },
});
