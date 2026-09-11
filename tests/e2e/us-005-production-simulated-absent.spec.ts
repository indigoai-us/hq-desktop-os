import { expect, test } from '@playwright/test';

/**
 * Production renderer (port 4319, no Electron preload) must never activate the
 * development simulated adapter — not via route, query, or localStorage.
 */
test.describe('US-005 production renderer excludes the simulated adapter', () => {
  test('ignores /dev/companion scenario selection and stays fail-closed', async ({ page }) => {
    await page.goto('/dev/companion?scenario=connected');
    await expect(page.getByTestId('preview-simulated-banner')).toHaveCount(0);
    await expect(page.getByText('Preview · Changes', { exact: false })).toHaveCount(0);
    await expect(page.getByTestId('preview-reset')).toHaveCount(0);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set up HQ', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'I already have an HQ folder' })).toBeDisabled();
  });

  test('localStorage and hash cannot unlock simulated success', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('hq-desktop-os:scenario', 'connected');
      window.localStorage.setItem('scenario', 'syncing');
      window.localStorage.setItem('hq-preview', '1');
      window.sessionStorage.setItem('scenario', 'conflict');
    });
    await page.goto('/?scenario=connected#scenario=syncing');
    await expect(page.getByTestId('preview-simulated-banner')).toHaveCount(0);
    await expect(page.getByText('Preview · Changes', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Set up HQ', exact: true })).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Your files are up to date' })).toHaveCount(0);
  });

  test('ships no preview adapter strings in production bundles', async ({ page }) => {
    await page.goto('/');
    const scripts = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLScriptElement>('script[src]')].map((script) => script.src),
    );
    expect(scripts.length).toBeGreaterThan(0);

    for (const src of scripts) {
      const body = await (await page.request.get(src)).text();
      expect(body, src).not.toContain('createPreviewClient');
      expect(body, src).not.toContain('preview-simulated-banner');
      expect(body, src).not.toContain('REQUIRED_PREVIEW_SCENARIOS');
      expect(body, src).not.toContain('Preview · Changes here are not saved.');
    }
  });
});
