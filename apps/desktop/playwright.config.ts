import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5174',
    headless: true,
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'pnpm dev:browser',
    url: 'http://localhost:5174/pet.html?test=1',
    // Locally, reuse whatever `pnpm dev:browser` is already serving; on CI a stray listener on 5174
    // would silently test something other than this checkout, so fail instead.
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
