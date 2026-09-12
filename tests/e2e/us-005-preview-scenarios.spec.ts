import { expect, test } from '@playwright/test';
import { startGalleryServer, stopGalleryServer } from '../helpers/dev-gallery';
import type { FixtureServer } from '../helpers/renderer-dev-server';

let server: FixtureServer;
let url: string;

test.beforeAll(async () => {
  const fixture = await startGalleryServer(4355);
  server = fixture.server;
  url = server.url;
});

test.afterAll(async () => {
  await stopGalleryServer(server);
});

test.describe('US-005 development preview scenarios', () => {
  test('marks the adapter as simulated and resets to signed-out', async ({ page }) => {
    await page.goto(`${url}/dev/companion?scenario=conflict`);
    await expect(page.getByTestId('preview-simulated-banner')).toBeVisible();
    await expect(page.getByText('Preview · Changes here are not saved.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Sync', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'One file needs your attention' })).toBeVisible();

    await page.getByTestId('preview-reset').click();
    await expect(page.getByRole('heading', { name: 'Your work, right here.' })).toBeVisible();
    await expect(page.getByTestId('preview-simulated-banner')).toBeVisible();
    expect(page.url()).toContain('/dev/companion');
    expect(page.url()).not.toContain('scenario=');
  });

  test('renders signed-out, setup, syncing, offline, conflict and failure fixtures', async ({
    page,
  }) => {
    await page.goto(`${url}/dev/companion?scenario=signed-out`);
    await expect(page.getByRole('heading', { name: 'Your work, right here.' })).toBeVisible();

    await page.goto(`${url}/dev/companion?scenario=setup`);
    await expect(page.getByRole('heading', { name: 'Getting HQ ready' })).toBeVisible();

    await page.goto(`${url}/dev/companion?scenario=syncing`);
    await page.getByRole('button', { name: 'Sync', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Connecting your files' })).toBeVisible();

    await page.goto(`${url}/dev/companion?scenario=offline`);
    await page.getByRole('button', { name: 'Sync', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Waiting for a connection' })).toBeVisible();

    await page.goto(`${url}/dev/companion?scenario=conflict`);
    await page.getByRole('button', { name: 'Sync', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'One file needs your attention' })).toBeVisible();

    await page.goto(`${url}/dev/companion?scenario=failure`);
    await page.getByRole('button', { name: 'Sync', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Sync could not finish. Check your connection and try again.' }),
    ).toBeVisible();
  });
});
