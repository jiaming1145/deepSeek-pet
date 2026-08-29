import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// The vendored Cubism Framework is reached through the same @framework/* alias the renderer build
// uses (apps/desktop/vite.browser.config.ts), so unit tests can exercise the real Framework classes
// that need no Cubism Core (motion queue manager, updater base class) instead of re-describing them.
export default defineConfig({
  test: { name: '@ds/stage', include: ['src/**/*.test.ts'] },
  resolve: {
    alias: { '@framework': resolve(__dirname, '../../vendor/CubismWebFramework/src') },
  },
});
