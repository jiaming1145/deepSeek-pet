import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { name: '@ds/behaviors', environment: 'node', include: ['src/**/*.test.ts'] },
});
