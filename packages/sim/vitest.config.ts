import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { name: '@ds/sim', environment: 'node', include: ['src/**/*.test.ts'] } });
