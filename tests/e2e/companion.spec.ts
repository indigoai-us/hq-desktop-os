import { expect, test } from '@playwright/test';
import { startGalleryServer, stopGalleryServer } from '../helpers/dev-gallery';
import type { FixtureServer } from '../helpers/renderer-dev-server';
let server: FixtureServer;
let url: string;
test.beforeAll(async () => { const fixture = await startGalleryServer(4348); server = fixture.server; url = server.url; });
test.afterAll(async () => { await stopGalleryServer(server); });
test('preview exercises workspace selection, tools, removal and reset without claiming native sync', async ({ page }) => {
  await page.goto(`${url}/dev/companion`);
  await expect(page.getByText('Preview · Changes here are not saved.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'I already have an HQ folder' }).click();
  await expect(page.getByRole('button', { name: 'Remove My HQ from app' })).toBeVisible();
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open terminal', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect(page.getByText('Not yet')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save support report' })).toBeEnabled();
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Remove My HQ from app' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove My HQ from app' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove My HQ from app' }).click();
  await page.getByRole('button', { name: 'Remove from app', exact: true }).click();
  await expect(page.getByText('Your work, right here.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'I already have an HQ folder' }).click();
  await expect(page.getByRole('button', { name: 'Remove My HQ from app' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Your work, right here.', { exact: true })).toBeVisible();
});
test('production ignores the preview route and cannot simulate workspace attachment', async ({ page }) => {
  await page.goto('/dev/companion?scenario=connected');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'I already have an HQ folder' })).toBeDisabled();
  await expect(page.getByText('Preview · Changes', { exact: false })).toHaveCount(0);
});
test('narrow preview keeps all navigation and panel controls within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 512, height: 350 });
  await page.goto(`${url}/dev/companion`);
  for (const section of ['Workspace', 'Sync', 'Tools', 'Settings']) {
    await page.getByRole('button', { name: section, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
});
test('setup failure offers a route back to choosing an existing folder', async ({ page }) => {
  await page.goto(`${url}/dev/companion?scenario=setup-error`);
  await expect(page.getByRole('alert')).toContainText('already an HQ folder');
  await page.getByRole('button', { name: 'Choose another folder' }).click();
  await page.getByRole('button', { name: 'I already have an HQ folder' }).click();
  await expect(page.getByRole('button', { name: 'Open your files' })).toBeEnabled();
});
test('guided setup announces progress, can cancel, and resumes to a workspace', async ({ page }) => {
  await page.goto(`${url}/dev/companion`);
  await page.getByRole('button', { name: 'Set up HQ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Getting HQ ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel setup' }).click();
  await expect(page.getByRole('alert')).toContainText('canceled');
  await page.getByRole('button', { name: 'Continue setup' }).click();
  await expect(page.getByRole('button', { name: 'Open your files' })).toBeEnabled();
});

test('shared work selection resets its status and offers explicit sync controls', async ({ page }) => {
  await page.goto(`${url}/dev/companion?scenario=connected`);
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  await page.getByLabel('Keep these files on this computer').selectOption('cmp_example');
  await expect(page.getByRole('heading', { name: 'Ready when you are' })).toBeVisible();
  await expect(page.getByText('Not yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create a company' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join with an invite' })).toBeVisible();
  await page.getByRole('button', { name: 'Start syncing' }).click();
  await expect(page.getByRole('heading', { name: 'Your files are up to date' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause sync' }).click();
  await expect(page.getByRole('heading', { name: 'Sync is paused' })).toBeVisible();
});
test('membership discovery failure shows an explicit retry state instead of zero companies', async ({ page }) => {
  await page.goto(`${url}/dev/companion?scenario=memberships-error`);
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect(page.getByTestId('memberships-error')).toContainText('could not be loaded');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByLabel('Keep these files on this computer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByLabel('Keep these files on this computer')).toBeVisible();
});
test('conflict preview lists the file and resolves with an explicit choice', async ({ page }) => {
  await page.goto(`${url}/dev/companion?scenario=conflict`);
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'One file needs your attention' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This file needs a choice' })).toBeVisible();
  await expect(page.getByText('notes/shared-draft.md', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use the cloud copy' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep both versions' }).click();
  await expect(page.getByRole('heading', { name: 'Your files are up to date' })).toBeVisible();
  await expect(page.getByText('notes/shared-draft.md', { exact: true })).toHaveCount(0);
});
test('background operation is an explicit preference and preview changes stay simulated', async ({ page }) => {
  await page.goto(`${url}/dev/companion`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Keep HQ running' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Keep HQ running' }).check();
  await expect(page.getByRole('checkbox', { name: 'Keep HQ running' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Open HQ when I sign in' })).not.toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Appearance' })).toHaveCount(1);
});

test('Linux without a tray keeps the window required and disables close-to-tray', async ({ page }) => {
  await page.goto(`${url}/dev/companion?scenario=no-tray`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const closeToTray = page.getByRole('checkbox', { name: 'Keep HQ running' });
  await expect(closeToTray).toBeDisabled();
  await expect(closeToTray).not.toBeChecked();
  await expect(page.getByText(/does not support a tray/i)).toBeVisible();
});

test('WSL startup control stays visible and disabled without enabling a loop', async ({ page }) => {
  await page.goto(`${url}/dev/companion?scenario=wsl-startup`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const launchAtLogin = page.getByRole('checkbox', { name: 'Open HQ when I sign in' });
  await expect(launchAtLogin).toBeDisabled();
  await expect(launchAtLogin).not.toBeChecked();
  await expect(page.getByText(/not available here/i)).toBeVisible();
});
