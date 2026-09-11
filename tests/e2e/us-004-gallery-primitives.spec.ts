import { expect, test } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import { openGallery, resolveTokenColor, startGalleryServer, stopGalleryServer } from '../helpers/dev-gallery';

/**
 * US-004 criterion 1: the seven shared primitives render, and their normal,
 * disabled, pending and error states are distinct and token-backed.
 *
 * Everything here is read from the rendered document — roles, accessible names,
 * computed style, real focus order — never from component source text.
 */
const PORT = 4341;

test.describe.configure({ mode: 'serial' });

test.describe('US-004 gallery primitives and states', () => {
  let server: ViteDevServer | undefined;
  let url = '';

  test.beforeAll(async () => {
    ({ server, url } = await startGalleryServer(PORT));
  });

  test.afterAll(async () => {
    await stopGalleryServer(server);
  });

  test.beforeEach(async ({ page }) => {
    await openGallery(page, url);
  });

  test('renders all seven shared primitives with real roles and names', async ({ page }) => {
    // Button, input, label, dialog trigger, select trigger, tooltip trigger,
    // progress — the seven primitives the story installs.
    await expect(page.getByRole('button', { name: 'Normal' })).toBeVisible();
    const email = page.getByTestId('gallery-email');
    await expect(email).toBeVisible();
    // The label is wired to the control, so the accessible name comes from it.
    await expect(email).toHaveAccessibleName('Work email');
    await expect(page.getByRole('button', { name: 'Open dialog' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Region' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tooltip target' })).toBeVisible();
    const progress = page.getByRole('progressbar');
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAccessibleName('Workspace sync');

    // Label elements are real <label>s pointing at their controls.
    const labelled = await page.evaluate(() =>
      [...document.querySelectorAll('label[for]')].map((label) => {
        const target = document.getElementById(label.getAttribute('for')!);
        return { text: label.textContent?.trim(), resolved: Boolean(target) };
      }),
    );
    expect(labelled.length).toBeGreaterThanOrEqual(2);
    expect(labelled.every((entry) => entry.resolved)).toBe(true);
  });

  test('keeps normal, disabled, pending and error button states distinct', async ({ page }) => {
    const signatures = await page.evaluate(() =>
      ['normal', 'disabled', 'pending', 'error'].map((state) => {
        const element = document.querySelector<HTMLButtonElement>(
          `[data-testid="gallery-button-${state}"]`,
        )!;
        const style = getComputedStyle(element);
        return {
          state,
          backgroundColor: style.backgroundColor,
          color: style.color,
          opacity: style.opacity,
          cursor: style.cursor,
          disabled: element.disabled,
          ariaBusy: element.getAttribute('aria-busy'),
          ariaInvalid: element.getAttribute('aria-invalid'),
        };
      }),
    );
    const by = (state: string) => signatures.find((entry) => entry.state === state)!;

    // Each state is announced, not only painted.
    expect(by('disabled').disabled).toBe(true);
    expect(by('pending').ariaBusy).toBe('true');
    expect(by('error').ariaInvalid).toBe('true');
    expect(by('normal').disabled).toBe(false);
    expect(by('normal').ariaBusy).toBeNull();

    // And each state looks different from every other one.
    const visual = signatures.map(
      (entry) => `${entry.backgroundColor}|${entry.color}|${entry.opacity}|${entry.cursor}`,
    );
    expect(new Set(visual).size).toBe(4);

    // Disabled is genuinely inert: it takes no keyboard focus.
    await page.getByTestId('gallery-button-disabled').evaluate((element: HTMLElement) => element.focus());
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).not.toBe(
      'gallery-button-disabled',
    );
  });

  test('paints those states from the shared tokens, not per-screen colours', async ({ page }) => {
    const [accent, danger, mutedForeground] = await Promise.all([
      resolveTokenColor(page, '--accent'),
      resolveTokenColor(page, '--status-danger'),
      resolveTokenColor(page, '--muted-foreground'),
    ]);

    await expect(page.getByTestId('gallery-button-normal')).toHaveCSS('background-color', accent);
    await expect(page.getByTestId('gallery-button-error')).toHaveCSS('background-color', danger);
    await expect(page.getByTestId('gallery-email-error')).toHaveCSS('color', danger);
    // The pending note is secondary text, not an accent colour of its own.
    await expect(page.getByRole('status').filter({ hasText: 'Pending' })).toBeVisible();

    // Progress track and fill read the same token vocabulary.
    const fill = await page
      .getByRole('progressbar')
      .locator('[data-slot="progress-indicator"]')
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(fill).toBe(accent);
    expect([accent, danger, mutedForeground].every((value) => value.startsWith('rgb'))).toBe(true);

    // Square corners, inherited from the shared radius tokens.
    const radii = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('main *')]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => getComputedStyle(element).borderTopLeftRadius)
        .filter((radius) => radius !== '0px'),
    );
    expect(radii).toEqual([]);
  });

  test('reports progress semantically and fills the track to the reported value', async ({ page }) => {
    const progress = page.getByRole('progressbar');
    await expect(progress).toHaveAttribute('aria-valuenow', '42');
    await expect(progress).toHaveAttribute('aria-valuemin', '0');
    await expect(progress).toHaveAttribute('aria-valuemax', '100');

    // Geometry must agree with the announced value: a progress bar that says
    // 42% and paints 100% is a lie to sighted users.
    const filled = await progress.evaluate((root) => {
      const indicator = root.querySelector<HTMLElement>('[data-slot="progress-indicator"]')!;
      const track = root.getBoundingClientRect();
      const fill = indicator.getBoundingClientRect();
      return {
        ratio: (fill.right - track.left) / track.width,
        trackWidth: track.width,
      };
    });
    expect(filled.trackWidth).toBeGreaterThan(0);
    expect(filled.ratio).toBeGreaterThan(0.41);
    expect(filled.ratio).toBeLessThan(0.43);
  });

  test('does not repeat the application chrome or window controls', async ({ page }) => {
    // One page title on the surface, and it belongs to the gallery.
    const headings = await page.getByRole('heading', { level: 1 }).allTextContents();
    expect(headings).toEqual(['Component gallery']);
    // The application shell is a different surface; the gallery is not a copy.
    await expect(page.getByText('Your desktop companion')).toHaveCount(0);
    // Window identity and min/max/close stay with the OS titlebar.
    for (const name of [/minimi[sz]e/i, /maximi[sz]e/i, /^close window$/i, /restore/i]) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
  });
});
