import { expect, test, type Page } from '@playwright/test';
import { startGalleryServer, stopGalleryServer } from '../helpers/dev-gallery';
import type { FixtureServer } from '../helpers/renderer-dev-server';

const PORT = 4360;

let server: FixtureServer;
let url: string;

test.beforeAll(async () => {
  const fixture = await startGalleryServer(PORT);
  server = fixture.server;
  url = server.url;
});

test.afterAll(async () => {
  await stopGalleryServer(server);
});

async function openSync(page: Page, scenario: string): Promise<void> {
  await page.goto(`${url}/dev/companion?scenario=${scenario}`);
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect(page.getByTestId('screen-sync')).toBeVisible();
}

test.describe('US-013 live sync controls and conflict recovery', () => {
  test('reports truthful runtime states without equating connectivity with completed sync', async ({ page }) => {
    await openSync(page, 'reconciling');
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-sync-pass', 'reconciling');
    await expect(page.getByTestId('sync-transport')).toHaveText('Initial reconciliation');
    await expect(page.getByTestId('sync-last-success')).toHaveText('Not yet');
    await expect(page.getByTestId('sync-headline')).toHaveText('Checking your files');

    await openSync(page, 'pending');
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-sync-pass', 'pending');
    await expect(page.getByTestId('sync-pending-count')).toHaveText('3 files');
    await expect(page.getByTestId('sync-headline')).toHaveText('Updating 3 files');

    await openSync(page, 'connected');
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-sync-transport', 'realtime');
    await expect(page.getByTestId('sync-transport')).toHaveText('Connected · live updates');
    await expect(page.getByTestId('sync-last-success')).not.toHaveText('Not yet');

    await openSync(page, 'polling');
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-sync-transport', 'polling');
    await expect(page.getByTestId('sync-transport')).toHaveText('Connected · checking periodically');

    await openSync(page, 'offline');
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-sync-phase', 'offline');
    await expect(page.getByTestId('sync-transport')).toHaveText('Offline');

    await openSync(page, 'paused');
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-sync-phase', 'paused');
    await expect(page.getByTestId('sync-headline')).toHaveText('Sync is paused');

    await openSync(page, 'failure');
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-sync-phase', 'error');
    await expect(page.getByTestId('sync-error')).toHaveText('Needs attention');
  });

  test('scope controls stay pending-aware and refuse revoked memberships on retry', async ({ page }) => {
    await openSync(page, 'connected');
    await page.getByLabel('Keep these files on this computer').selectOption('cmp_example');
    await expect(page.getByTestId('sync-headline')).toHaveText('Ready when you are');
    await expect(page.getByTestId('sync-last-success')).toHaveText('Not yet');
    await expect(page.getByTestId('companion-pending')).toHaveCount(0);

    await page.getByTestId('sync-lifecycle').click();
    await expect(page.getByTestId('sync-headline')).toHaveText('Your files are up to date');
    await expect(page.getByTestId('sync-transport')).toHaveText('Connected · live updates');

    await page.getByRole('button', { name: 'Pause sync' }).click();
    await expect(page.getByTestId('sync-headline')).toHaveText('Sync is paused');

    // Fixture: selected company is no longer authorized — resume must not broaden sync.
    await openSync(page, 'revoked-scope');
    await page.getByRole('button', { name: 'Start syncing' }).click();
    await expect(page.getByTestId('companion-error')).toContainText('no longer available');
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-sync-phase', 'paused');
  });

  test('conflict recovery lists files and converges on an explicit keep choice', async ({ page }) => {
    await openSync(page, 'conflict');
    await expect(page.getByTestId('sync-headline')).toHaveText('One file needs your attention');
    await expect(page.getByRole('heading', { name: 'This file needs a choice' })).toBeVisible();
    await expect(page.getByText('notes/shared-draft.md', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use the cloud copy' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keep both versions' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep both versions' }).click();
    await expect(page.getByTestId('sync-headline')).toHaveText('Your files are up to date');
    await expect(page.getByTestId('sync-transport')).toHaveText('Connected · live updates');
    await expect(page.getByText('notes/shared-draft.md', { exact: true })).toHaveCount(0);
  });
});
