import { expect, test } from '@playwright/test';
import { REQUIRED_CSP_DIRECTIVES, parseCsp } from '../helpers/csp';
import { collectViolations, installViolationRecorder } from '../helpers/csp-violations';

/**
 * A plain browser is the honest stand-in for "production renderer without the
 * Electron preload": no bridge is injected, so the app must fail closed.
 */
test.describe('US-002 production renderer without preload', () => {
  test.beforeEach(async ({ page }) => {
    await installViolationRecorder(page);
    await page.goto('/');
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('explains how to open HQ without displaying implementation details', async ({ page }) => {
    expect(await page.evaluate(() => typeof (window as unknown as { hqDesktop?: unknown }).hqDesktop)).toBe('undefined');
    await expect(page.getByRole('alert')).toContainText('Try reopening the app');
    await expect(page.getByText(/preload|native bridge|runtime|VS Code|documentation/i)).toHaveCount(0);
  });
  test('disables native setup instead of simulating success', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Set up HQ', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'I already have an HQ folder' })).toBeDisabled();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
  });
  test('keeps one native title bar and no duplicate window controls', async ({ page }) => {
    for (const removed of ['window-minimize', 'window-maximize', 'window-close', 'app-relaunch', 'open-docs', 'check-native']) await expect(page.getByTestId(removed)).toHaveCount(0);
    expect(await page.title()).toBe('HQ');
    await expect(page.getByText('HQ Desktop OS', { exact: true })).toHaveCount(0);
  });
  test('retry remains unavailable without the desktop bridge', async ({ page }) => {
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Open HQ on your computer');
    await expect(page.getByRole('button', { name: 'Set up HQ', exact: true })).toBeDisabled();
  });

  test('exposes no Node or Electron primitives to the page', async ({ page }) => {
    expect(
      await page.evaluate(() =>
        ['require', 'process', 'module', 'Buffer', '__dirname', 'ipcRenderer', 'electron'].filter(
          (name) => typeof (globalThis as Record<string, unknown>)[name] !== 'undefined',
        ),
      ),
    ).toEqual([]);
  });

  test('serves a production CSP that refuses inline and foreign script', async ({ page }) => {
    const policy = await page.evaluate(
      () =>
        document
          .querySelector('meta[http-equiv="Content-Security-Policy"]')
          ?.getAttribute('content') ?? '',
    );
    const directives = parseCsp(policy);
    for (const [name, sources] of Object.entries(REQUIRED_CSP_DIRECTIVES)) {
      expect(directives[name], `CSP ${name}`).toEqual(sources);
    }
    expect(policy).not.toContain('unsafe-eval');

    const violations = await collectViolations(page, async () => {
      expect(
        await page.evaluate(async () => {
          const inline = document.createElement('script');
          inline.textContent = 'globalThis.__cspInline = true;';
          document.body.appendChild(inline);
          const foreign = document.createElement('script');
          foreign.src = 'https://cdn.evil.example/payload.js';
          document.body.appendChild(foreign);
          await new Promise((resolve) => setTimeout(resolve, 300));
          return (globalThis as Record<string, unknown>).__cspInline === true;
        }),
      ).toBe(false);
    });

    expect(violations.map((violation) => violation.blockedURI)).toEqual(
      expect.arrayContaining(['inline', 'https://cdn.evil.example/payload.js']),
    );
    expect(new Set(violations.map((violation) => violation.effectiveDirective))).toEqual(
      new Set(['script-src-elem']),
    );
  });
});
