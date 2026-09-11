import { expect, test, type Page } from '@playwright/test';
import { startGalleryServer, stopGalleryServer } from '../helpers/dev-gallery';
import type { FixtureServer } from '../helpers/renderer-dev-server';

/**
 * US-006: companion navigation shell, screen states, supported sizes, and
 * 200% zoom operability against the development preview adapter.
 */
const PORT = 4356;

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

async function openCompanion(page: Page, query = ''): Promise<void> {
  await page.goto(`${url}/dev/companion${query}`);
  await expect(page.getByTestId('companion-shell')).toBeVisible();
}

async function essentialActionsReachable(page: Page): Promise<{
  horizontalOverflow: number;
  missingNav: string[];
  unreachable: string[];
}> {
  return page.evaluate(() => {
    const navNames = ['Workspace', 'Sync', 'Tools', 'Settings'];
    const missingNav = navNames.filter(
      (name) =>
        ![...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === name),
    );
    const subjects = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid="active-workspace"], [data-active-section] h1, [data-testid="screen-workspace"] button, [data-testid="screen-sync"] button, [data-testid="screen-tools"] button, [data-testid="screen-settings"] button, [data-testid="companion-pending"]',
      ),
    ].filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    const unreachable: string[] = [];
    for (const element of subjects) {
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (
        rect.left < -1 ||
        rect.right > window.innerWidth + 1 ||
        rect.top < -1
      ) {
        unreachable.push(
          `${element.getAttribute('data-testid') ?? element.tagName}:${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)}`,
        );
      }
    }
    return {
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      missingNav,
      unreachable,
    };
  });
}

test.describe('US-006 companion navigation and screen completeness', () => {
  test('navigates each screen with the active workspace and section clear', async ({ page }) => {
    await openCompanion(page, '?scenario=connected');
    await expect(page.getByTestId('active-workspace')).toContainText('My HQ');
    await expect(page.getByTestId('screen-workspace')).toHaveAttribute('data-screen-state', 'populated');

    for (const name of ['Sync', 'Tools', 'Settings', 'Workspace'] as const) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.locator('[data-focus-shell]')).toHaveAttribute('data-active-section', name);
      await expect(page.getByTestId(`screen-${name.toLowerCase()}`)).toBeVisible();
      await expect(page.getByTestId('active-workspace')).toContainText('My HQ');
    }
  });

  test('shows empty and error screen states from fixtures', async ({ page }) => {
    await openCompanion(page, '?scenario=signed-out');
    await expect(page.getByTestId('screen-workspace')).toHaveAttribute('data-screen-state', 'empty');
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect(page.getByTestId('screen-tools')).toHaveAttribute('data-screen-state', 'empty');
    await expect(page.getByTestId('tools-empty')).toBeVisible();

    await openCompanion(page, '?scenario=failure');
    await page.getByRole('button', { name: 'Sync', exact: true }).click();
    await expect(page.getByTestId('screen-sync')).toHaveAttribute('data-screen-state', 'error');
    await expect(
      page.getByRole('heading', { name: 'Sync could not finish. Check your connection and try again.' }),
    ).toBeVisible();

    await openCompanion(page, '?scenario=setup-error');
    await expect(page.getByTestId('screen-workspace')).toHaveAttribute('data-screen-state', 'error');
  });

  test('pending feedback appears immediately and blocks duplicate submissions', async ({ page }) => {
    await openCompanion(page, '?delay=900');
    const setup = page.getByTestId('action-create-workspace');
    await expect(setup).toBeEnabled();
    await setup.click();
    await expect(page.getByTestId('companion-pending')).toContainText('Preparing your workspace');
    await expect(setup).toBeDisabled();
    // Second activation while busy must not queue a second request path.
    await setup.click({ force: true });
    await expect(page.getByTestId('companion-pending')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Getting HQ ready' })).toBeVisible({
      timeout: 5000,
    });

    await openCompanion(page, '?fail=attach-workspace&delay=400');
    await page.getByRole('button', { name: 'I already have an HQ folder' }).click();
    await expect(page.getByTestId('companion-pending')).toBeVisible();
    await expect(page.getByTestId('companion-error')).toContainText('That did not finish');
  });

  test('shell stays operable at 1024x700 and 1440x900', async ({ browser }) => {
    for (const viewport of [
      { width: 1024, height: 700 },
      { width: 1440, height: 900 },
    ]) {
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        await openCompanion(page, '?scenario=connected');
        for (const name of ['Workspace', 'Sync', 'Tools', 'Settings'] as const) {
          await page.getByRole('button', { name, exact: true }).click();
          const measured = await essentialActionsReachable(page);
          expect(measured.missingNav, `${viewport.width}x${viewport.height}`).toEqual([]);
          expect(measured.horizontalOverflow, `${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
          expect(measured.unreachable, `${viewport.width}x${viewport.height}`).toEqual([]);
          await expect(page.getByTestId('active-workspace')).toBeVisible();
        }
      } finally {
        await context.close();
      }
    }
  });

  test('remains operable at a 200% zoom surrogate of the supported sizes', async ({ browser }) => {
    // Halved CSS viewport + deviceScaleFactor 2 approximates 200% zoom.
    for (const base of [
      { width: 1024, height: 700, label: '1024x700@200%' },
      { width: 1440, height: 900, label: '1440x900@200%' },
    ]) {
      const context = await browser.newContext({
        viewport: { width: Math.floor(base.width / 2), height: Math.floor(base.height / 2) },
        deviceScaleFactor: 2,
      });
      try {
        const page = await context.newPage();
        await openCompanion(page, '?scenario=connected');
        await expect(page.getByTestId('active-workspace')).toBeVisible();
        await expect(page.getByTestId('active-workspace')).toContainText('My HQ');
        for (const name of ['Sync', 'Tools', 'Settings', 'Workspace'] as const) {
          await page.getByRole('button', { name, exact: true }).click();
          const measured = await essentialActionsReachable(page);
          expect(measured.missingNav, base.label).toEqual([]);
          expect(measured.horizontalOverflow, base.label).toBeLessThanOrEqual(1);
          // Primary heading for the active section must stay reachable.
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        }

        // CSS zoom surrogate on the full layout size as a second check.
        await page.setViewportSize({ width: base.width, height: base.height });
        await page.evaluate(() => {
          document.documentElement.style.zoom = '2';
        });
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await expect(page.getByTestId('screen-settings')).toBeVisible();
        await expect(page.getByTestId('active-workspace')).toBeVisible();
        const zoomed = await essentialActionsReachable(page);
        expect(zoomed.missingNav, `${base.label} css-zoom`).toEqual([]);
        expect(zoomed.horizontalOverflow, `${base.label} css-zoom`).toBeLessThanOrEqual(1);
      } finally {
        await context.close();
      }
    }
  });
});
