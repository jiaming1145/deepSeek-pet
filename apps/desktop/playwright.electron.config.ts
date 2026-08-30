import { defineConfig } from '@playwright/test';

/**
 * The Electron lane. Separate from `playwright.config.ts` (the Phase 1 browser harness, which
 * starts a vite server at :5174 and must stay untouched): these specs launch the built app with
 * `_electron.launch` and drive the real four-window shell.
 *
 * `workers: 1` and `fullyParallel: false` are not a performance choice — two Electron apps on one
 * desktop would fight over the screen the composited captures read from.
 */
export default defineConfig({
  testDir: './tests-e2e',
  timeout: 600_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '../../docs/evidence/phase2/e2e-report.json' }]],
});
