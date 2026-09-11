import { expect, test } from '@playwright/test';
import { startGalleryServer, stopGalleryServer } from '../helpers/dev-gallery';
import type { FixtureServer } from '../helpers/renderer-dev-server';
let server: FixtureServer;
let url: string;
test.beforeAll(async () => { const fixture = await startGalleryServer(4348); server = fixture.server; url = server.url; });
test.afterAll(async () => { await stopGalleryServer(server); });
test('preview exercises workspace selection, tools, removal and reset without claiming native sync', async ({ page }) => {
  await page.goto(`${url}/dev/companion`);
  await expect(page.getByText('Development preview · Simulated workspace data.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Attach existing HQ' }).click();
  await expect(page.getByRole('button', { name: 'Remove My HQ from app' })).toBeVisible();
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Terminal', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect(page.getByText('Not yet synced by this app')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export this report' })).toBeEnabled();
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await page.getByRole('button', { name: 'Remove My HQ from app' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove My HQ from app' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove My HQ from app' }).click();
  await page.getByRole('button', { name: 'Remove from app', exact: true }).click();
  await expect(page.getByText('Choose your HQ folder', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Attach existing HQ' }).click();
  await expect(page.getByRole('button', { name: 'Remove My HQ from app' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Choose your HQ folder', { exact: true })).toBeVisible();
});
test('production ignores the preview route and cannot simulate workspace attachment', async ({ page }) => {
  await page.goto('/dev/companion?scenario=connected');
  await expect(page.getByTestId('platform-unavailable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attach existing HQ' })).toBeDisabled();
  await expect(page.getByText('Development preview', { exact: false })).toHaveCount(0);
});
test('narrow preview keeps all navigation and panel controls within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 512, height: 350 });
  await page.goto(`${url}/dev/companion`);
  for (const section of ['Setup', 'Sync', 'Tools', 'Settings']) {
    await page.getByRole('button', { name: section, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
});
