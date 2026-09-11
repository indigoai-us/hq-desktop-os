import { defineConfig } from '@playwright/test';

/**
 * Physical-host acceptance. Never part of `pnpm test:acceptance`.
 *
 * These specs inject real pointer input at real screen coordinates, so they
 * must only be run on an isolated host provisioned for acceptance — never
 * against a live user desktop. On a host that cannot apply injected input the
 * suite FAILS with the measured reason rather than skipping, so an unproven
 * titlebar drag or edge resize can never be reported as a pass.
 *
 * Run with: pnpm test:host-acceptance
 */
export default defineConfig({
  testDir: './tests/host-acceptance',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/electron/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  outputDir: 'test-results/host-acceptance',
  reporter: [['list'], ['json', { outputFile: 'test-results/host-acceptance-results.json' }]],
  use: { trace: 'retain-on-failure' },
});
