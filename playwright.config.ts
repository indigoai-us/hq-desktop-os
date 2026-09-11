import { defineConfig } from '@playwright/test';

/**
 * Browser acceptance for the production renderer with no Electron preload.
 * Port 4319 is dedicated to this suite so the shared 4173 dev preview owned by
 * another session is never reused, restarted or terminated.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  // Separate output dirs so one suite never clears the other's report.
  outputDir: 'test-results/e2e',
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4319',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm build:renderer && pnpm preview:prod',
    url: 'http://127.0.0.1:4319',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
