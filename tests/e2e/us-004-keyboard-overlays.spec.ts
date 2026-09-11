import { expect, test, type Page } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import { openGallery, startGalleryServer, stopGalleryServer } from '../helpers/dev-gallery';

/**
 * US-004 criterion 2: dialogs and selects are operable by keyboard alone, with
 * accessible names, Escape dismissal, focus containment and focus restoration —
 * including the case where the control that opened the dialog unmounts first.
 *
 * No mouse is used anywhere in this spec. Every interaction is a key press, so
 * a regression that only works with a pointer fails here.
 */
const PORT = 4342;

/** Tab from the document until the wanted control holds focus. */
async function tabTo(page: Page, testId: string, limit = 25): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.focus();
  });
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    if (focused === testId) return;
  }
  throw new Error(`keyboard focus never reached ${testId} within ${limit} tabs`);
}

const focusedTestId = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);

test.describe.configure({ mode: 'serial' });

test.describe('US-004 keyboard-only dialog and select', () => {
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

  test('opens the dialog from the keyboard with an accessible name', async ({ page }) => {
    await tabTo(page, 'gallery-dialog-open');
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Named by its title, described by its description — both announced.
    await expect(dialog).toHaveAccessibleName('Confirm action');
    await expect(dialog).toHaveAccessibleDescription(/Press Escape or Close/);
    // Focus moved into the dialog rather than staying behind it.
    expect(
      await page.evaluate(() => {
        const content = document.querySelector('[data-slot="dialog-content"]')!;
        return content.contains(document.activeElement);
      }),
    ).toBe(true);
  });

  test('contains focus inside the open dialog', async ({ page }) => {
    await tabTo(page, 'gallery-dialog-open');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();

    // Tab forwards past the end and backwards past the start: focus must wrap
    // within the dialog both ways and never reach the page behind it.
    const visited = new Set<string>();
    for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      const inside = await page.evaluate(() => {
        const content = document.querySelector('[data-slot="dialog-content"]')!;
        const active = document.activeElement;
        return {
          contained: content.contains(active) || active === content,
          label: active?.getAttribute('data-testid') ?? active?.tagName ?? 'none',
        };
      });
      expect(inside.contained, `focus escaped the dialog to ${inside.label}`).toBe(true);
      visited.add(inside.label);
    }
    // Focus genuinely moved between controls rather than being pinned to one.
    expect(visited.size).toBeGreaterThan(1);
  });

  test('dismisses the dialog with Escape and returns focus to the opener', async ({ page }) => {
    await tabTo(page, 'gallery-dialog-open');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The opener still exists, so focus belongs on it — not on <body>.
    await expect.poll(() => focusedTestId(page)).toBe('gallery-dialog-open');
  });

  test('restores focus to the fallback when the opener unmounts while open', async ({ page }) => {
    await tabTo(page, 'gallery-dialog-open');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();

    // Activate the control that removes the opener, from the keyboard.
    const unmount = page.getByTestId('gallery-unmount-opener');
    await unmount.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('gallery-dialog-open')).toHaveCount(0);
    // The opener is gone. Focus must land on the declared fallback control, so
    // a keyboard user is never stranded on <body> with nowhere to tab from.
    await expect.poll(() => focusedTestId(page)).toBe('gallery-dialog-fallback');
    await expect(page.getByText('Opener unmounted while dialog was open')).toBeVisible();
  });

  test('operates the select with the keyboard only, including Escape', async ({ page }) => {
    const trigger = page.getByRole('combobox', { name: 'Region' });
    await expect(trigger).toHaveText(/US East/);

    await tabTo(page, 'gallery-region');
    await page.keyboard.press('Enter');
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    // Focus is inside the open listbox, and the active option is announced.
    await expect(page.getByRole('option', { name: 'US East' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Escape closes without committing a change, and focus returns to the trigger.
    await page.keyboard.press('Escape');
    await expect(listbox).toHaveCount(0);
    await expect(trigger).toHaveText(/US East/);
    await expect.poll(() => focusedTestId(page)).toBe('gallery-region');

    // Reopen and commit a different option with the keyboard.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(trigger).toHaveText(/EU West/);
    // Selection is predictable: the committed value is the one that was active.
    await expect.poll(() => focusedTestId(page)).toBe('gallery-region');
  });

  test('shows the tooltip on keyboard focus and hides it on Escape', async ({ page }) => {
    await tabTo(page, 'gallery-tooltip-trigger');

    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText(/Readable helper text/);
    // The trigger points at the visible tooltip, so it is announced too.
    await expect(page.getByTestId('gallery-tooltip-trigger')).toHaveAccessibleDescription(
      /Readable helper text/,
    );

    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    // Escape dismisses the tooltip without moving focus off the trigger.
    await expect.poll(() => focusedTestId(page)).toBe('gallery-tooltip-trigger');
  });
});
