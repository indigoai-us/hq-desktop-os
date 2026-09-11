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
    await page.waitForSelector('[data-testid="platform-availability"]');
  });

  test('reports an unavailable native platform instead of a native surface', async ({ page }) => {
    expect(await page.evaluate(() => typeof (window as unknown as { hqDesktop?: unknown }).hqDesktop)).toBe('undefined');
    await expect(page.getByTestId('platform-unavailable')).toBeVisible();
    await expect(page.getByTestId('platform-availability')).toHaveText('Native bridge unavailable');
    await expect(page.getByTestId('platform-unavailable')).toHaveAttribute('role', 'status');
  });

  test('disables every native action rather than offering a simulated one', async ({ page }) => {
    await expect(page.getByTestId('open-docs')).toBeDisabled();
    await expect(page.getByTestId('open-docs')).toHaveAttribute(
      'aria-describedby',
      'platform-unavailable-note',
    );
  });

  test('renders no in-app window-chrome bar duplicating the OS titlebar', async ({ page }) => {
    for (const removed of ['window-minimize', 'window-maximize', 'window-close', 'app-relaunch']) {
      await expect(page.getByTestId(removed)).toHaveCount(0);
    }
    await expect(page.getByRole('region', { name: 'Application actions' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Window controls' })).toHaveCount(0);
    // The document title is the only place the product name appears.
    expect(await page.title()).toBe('HQ Desktop OS');
    await expect(page.getByText('HQ Desktop OS', { exact: true })).toHaveCount(0);
  });

  test('answers a requested native action with an unavailable result, not success', async ({ page }) => {
    await expect(page.getByTestId('platform-last-result')).toHaveText('No native action yet');
    await page.getByTestId('check-native').click();
    await expect(page.getByTestId('platform-last-result')).toHaveText(
      'Check native → unavailable: Native platform bridge is unavailable.',
    );
    expect(await page.textContent('body')).not.toContain('→ ok');
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
