import { defineConfig } from '@playwright/test';

/**
 * us-002-external-handoff.spec.ts records the real `xdg-open` handoff, which
 * only exists on Linux. It is selected here by platform instead of skipped at
 * runtime, so a non-Linux run reports no test for it rather than a passing
 * skip. The Windows equivalent is still outstanding — see
 * docs/platform-boundary.md.
 */
const linuxOnlySpecs = ['**/us-002-external-handoff.spec.ts'];

/**
 * Native acceptance against the staged production Electron runtime.
 * Serial by design: the specs drive real window lifecycle, quit and relaunch.
 */
export default defineConfig({
  testDir: './tests/electron',
  testMatch: '**/*.spec.ts',
  testIgnore: process.platform === 'linux' ? [] : linuxOnlySpecs,
  globalSetup: './tests/electron/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  outputDir: 'test-results/electron',
  reporter: [['list'], ['json', { outputFile: 'test-results/electron-results.json' }]],
  use: { trace: 'retain-on-failure' },
});
