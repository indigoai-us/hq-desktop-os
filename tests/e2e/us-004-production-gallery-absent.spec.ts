import { expect, test } from '@playwright/test';

/**
 * The component gallery is a development surface. The production renderer this
 * suite's web server builds and serves must not expose it by any route, and its
 * code must not be in the shipped bundles at all.
 */
test.describe('US-004 production renderer excludes the development gallery', () => {
  test('does not render the gallery at its development route', async ({ page }) => {
    const response = await page.goto('/dev/components');
    // Whatever the SPA fallback answers with, it is not the gallery.
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByTestId('dev-component-gallery')).toHaveCount(0);
    await expect(page.getByText('Component gallery')).toHaveCount(0);
    await expect(page.getByTestId('gallery-button-pending')).toHaveCount(0);
  });

  test('serves the application shell at the root, not the gallery', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your work, right here.');
    await expect(page.getByTestId('dev-component-gallery')).toHaveCount(0);
  });

  test('ships no gallery code in the production bundles', async ({ page }) => {
    await page.goto('/');
    const scripts = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLScriptElement>('script[src]')].map(
        (script) => script.src,
      ),
    );
    expect(scripts.length).toBeGreaterThan(0);

    for (const src of scripts) {
      const body = await (await page.request.get(src)).text();
      expect(body, src).not.toContain('dev-component-gallery');
      expect(body, src).not.toContain('Component gallery');
      expect(body, src).not.toContain('gallery-button-pending');
    }

    // The module itself is not reachable as a standalone asset either.
    for (const path of ['/dev/components.tsx', '/dev/components.js']) {
      const response = await page.request.get(path);
      if (response.ok()) {
        expect(await response.text(), path).not.toContain('DevComponentGallery');
      }
    }
  });
});
