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
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
