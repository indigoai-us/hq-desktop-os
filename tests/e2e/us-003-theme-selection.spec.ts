import { expect, test } from '@playwright/test';
import { THEME_STORAGE_KEY } from '../../src/renderer/lib/theme';
import {
  forbidExternalNetwork,
  hexLuminance,
  readThemeTimeline,
  recordThemeTimeline,
} from '../helpers/theme-observation';

const LOCAL_HOST = '127.0.0.1:4319';

/**
 * US-003 acceptance against the production renderer build.
 *
 * Every assertion reads the rendered document — computed styles, stored
 * preference, observed theme applications — never the source that produced it.
 */
test.describe('US-003 theme selection, persistence and failure paths', () => {
  test.beforeEach(async ({ page }) => {
    await recordThemeTimeline(page);
  });

  async function background(page: import('@playwright/test').Page): Promise<string> {
    return page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
    );
  }

  test('offers system, light and dark as one semantic radiogroup', async ({ page }) => {
    await page.goto('/');
    const group = page.getByRole('radiogroup', { name: 'Appearance' });
    await expect(group).toBeVisible();
    await expect(group.getByRole('radio')).toHaveCount(3);
    await expect(group.getByRole('radio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // The group is a single tab stop: only the checked option is tabbable.
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll('[role="radiogroup"] [role="radio"]')].map((radio) => ({
          checked: radio.getAttribute('aria-checked'),
          tabIndex: (radio as HTMLElement).tabIndex,
        })),
      ),
    ).toEqual([
      { checked: 'true', tabIndex: 0 },
      { checked: 'false', tabIndex: -1 },
      { checked: 'false', tabIndex: -1 },
    ]);
  });

  test('changes the rendered theme by click and stores the choice', async ({ page }) => {
    await page.goto('/');
    await page.emulateMedia({ colorScheme: 'light' });
    const light = await background(page);

    await page.getByTestId('theme-option-dark').click();
    await expect(page.getByTestId('theme-option-dark')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('theme-option-system')).toHaveAttribute('aria-checked', 'false');

    const dark = await background(page);
    expect(hexLuminance(dark)).toBeLessThan(hexLuminance(light));
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark');
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe('dark');
    await expect(page.getByTestId('theme-storage-warning')).toHaveCount(0);
  });

  test('moves selection and focus with the keyboard', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('theme-option-system').focus();

    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('theme-option-light')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('theme-option-light')).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('theme-option-dark')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('theme-option-dark')).toBeFocused();
    const dark = await background(page);

    // Wraps forward, then Home returns to the first option.
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('theme-option-system')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('theme-option-dark')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Home');
    await expect(page.getByTestId('theme-option-system')).toHaveAttribute('aria-checked', 'true');
    expect(await background(page)).not.toBe(dark);

    await page.keyboard.press('End');
    await expect(page.getByTestId('theme-option-dark')).toBeFocused();
    // Space on the focused option selects it rather than toggling it off.
    await page.keyboard.press(' ');
    await expect(page.getByTestId('theme-option-dark')).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe('dark');
  });

  test('restores the saved theme on reload with no flash of the wrong theme', async ({ page }) => {
    await page.goto('/');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.getByTestId('theme-option-dark').click();
    const chosen = await background(page);

    await page.reload();
    await page.waitForSelector('[data-testid="theme-control"]');

    await expect(page.getByTestId('theme-option-dark')).toHaveAttribute('aria-checked', 'true');
    expect(await background(page)).toBe(chosen);

    const timeline = await readThemeTimeline(page);
    // The bootstrap applied the saved theme before React had mounted anything.
    expect(timeline.applied.length).toBeGreaterThan(0);
    expect(timeline.applied[0]!.dataTheme).toBe('dark');
    expect(timeline.applied[0]!.rootChildren).toBeLessThanOrEqual(0);
    // No intermediate application ever showed a different theme.
    expect([...new Set(timeline.applied.map((entry) => entry.dataTheme))]).toEqual(['dark']);
    // What the browser was about to paint in its first frame was already dark.
    expect(timeline.firstFrame).not.toBeNull();
    expect(timeline.firstFrame!.dataTheme).toBe('dark');
    expect(timeline.firstFrame!.colorScheme).toBe('dark');
    expect(timeline.firstFrame!.background).toBe(chosen);
  });

  test('follows a system preference change while the choice is System', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await expect(page.getByTestId('theme-option-system')).toHaveAttribute('aria-checked', 'true');
    const light = await background(page);

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect
      .poll(async () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
        ),
      )
      .not.toBe(light);
    const dark = await background(page);
    expect(hexLuminance(dark)).toBeLessThan(hexLuminance(light));

    // An explicit choice must stop following the system.
    await page.getByTestId('theme-option-light').click();
    expect(await background(page)).toBe(light);
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await background(page)).toBe(light);
  });

  test('falls back to system when the stored preference is corrupt', async ({ page }) => {
    await page.goto('/');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(
      (key) => localStorage.setItem(key, '{"preference":"dark","v":2}'),
      THEME_STORAGE_KEY,
    );
    await page.reload();
    await page.waitForSelector('[data-testid="theme-control"]');

    await expect(page.getByTestId('theme-option-system')).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
      'system',
    );
    const systemDark = await background(page);
    await page.emulateMedia({ colorScheme: 'light' });
    expect(hexLuminance(systemDark)).toBeLessThan(hexLuminance(await background(page)));
    // The page still works rather than failing on the unreadable value.
    await expect(page.getByTestId('platform-availability')).toBeVisible();
  });

  test('still renders and warns when storage is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('Storage disabled by policy', 'SecurityError');
        },
      });
    });
    await page.goto('/');
    await page.waitForSelector('[data-testid="theme-control"]');

    await expect(page.getByTestId('theme-option-system')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('theme-storage-warning')).toHaveCount(0);

    await page.getByTestId('theme-option-dark').click();
    // The choice applies for the session and says plainly that it was not saved.
    await expect(page.getByTestId('theme-option-dark')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('theme-storage-warning')).toBeVisible();
    await expect(page.getByTestId('theme-storage-warning')).toHaveAttribute('role', 'status');
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark');

    const timeline = await readThemeTimeline(page);
    expect(timeline.firstFrame).not.toBeNull();
    expect(timeline.firstFrame!.dataTheme).toBe('system');
  });

  test('boots the theme under the shipped CSP with no inline or remote script', async ({ page }) => {
    const network = await forbidExternalNetwork(page, LOCAL_HOST);
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(String(error)));
    await page.goto('/');
    await page.waitForSelector('[data-testid="theme-control"]');

    const policy = await page.evaluate(
      () =>
        document
          .querySelector('meta[http-equiv="Content-Security-Policy"]')
          ?.getAttribute('content') ?? '',
    );
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);

    // The bootstrap is a real same-origin classic script the CSP allowed to run.
    const bootstrap = await page.evaluate(() =>
      [...document.querySelectorAll('script')].map((script) => ({
        src: script.getAttribute('src'),
        type: script.getAttribute('type'),
        inline: script.textContent!.trim().length > 0,
      })),
    );
    const themeScript = bootstrap.find((script) => script.src?.includes('theme-init'));
    expect(themeScript, 'theme bootstrap script').toBeTruthy();
    expect(themeScript!.type).toBeNull();
    expect(bootstrap.every((script) => !script.inline)).toBe(true);

    expect(failures).toEqual([]);
    expect(network.external).toEqual([]);
    expect(network.all.filter((url) => !url.startsWith(`http://${LOCAL_HOST}/`))).toEqual([]);
  });
});
