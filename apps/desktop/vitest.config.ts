import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'desktop',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Renderer tests need a DOM; main/preload tests must stay in node.
    environmentMatchGlobs: [['src/renderer/**', 'jsdom']],
    setupFiles: ['./src/renderer/test-setup.ts'],
  },
});
