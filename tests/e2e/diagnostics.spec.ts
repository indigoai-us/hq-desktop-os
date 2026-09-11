import { expect, test } from '@playwright/test';
import { startGalleryServer, stopGalleryServer } from '../helpers/dev-gallery';
import type { FixtureServer } from '../helpers/renderer-dev-server';

let server: FixtureServer;
let url: string;

test.beforeAll(async () => {
  const fixture = await startGalleryServer(4351);
  server = fixture.server;
  url = server.url;
});

test.afterAll(async () => {
  await stopGalleryServer(server);
});

test.describe('US-016 redacted diagnostics and recovery guidance', () => {
  test('failing runtime is distinguishable from missing with retry and repair guidance', async ({ page }) => {
    await page.goto(`${url}/dev/companion?scenario=runtime-failed`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByTestId('diagnostics-panel')).toBeVisible();
    await expect(page.getByTestId('diagnostics-repair')).toContainText('Runtime failed');
    await expect(page.getByTestId('diagnostics-repair')).toContainText('different from a missing install');
    await expect(page.getByRole('button', { name: 'Retry checks' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Repair runtime' })).toBeEnabled();

    await page.goto(`${url}/dev/companion?scenario=runtime-missing`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByTestId('diagnostics-repair')).toContainText('Runtime missing');
    await expect(page.getByTestId('diagnostics-repair')).not.toContainText('different from a missing install');
  });

  test('support export preview omits workspace roots and opens before save', async ({ page }) => {
    await page.goto(`${url}/dev/companion?scenario=connected`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Preview support report' }).click();
    const preview = page.getByTestId('diagnostics-preview');
    await expect(preview).toBeVisible();
    const text = await preview.innerText();
    expect(text).toContain('hq-desktop-os');
    expect(text).not.toContain('/home/example/HQ');
    expect(text).not.toContain('installationId');
    await expect(page.getByRole('button', { name: 'Save report' })).toBeVisible();
  });

  test('repair restores runtime guidance without claiming workspace mutation', async ({ page }) => {
    await page.goto(`${url}/dev/companion?scenario=runtime-missing`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Repair runtime' }).click();
    await expect(page.getByTestId('diagnostics-repair-result')).toContainText('workspace files were not changed');
  });
});
