import { expect, test } from '@playwright/test';
import { THEME_STORAGE_KEY } from '../../src/renderer/lib/theme';
import { forbidExternalNetwork, hexLuminance, readThemeTimeline, recordThemeTimeline } from '../helpers/theme-observation';
const appearance = (page: import('@playwright/test').Page) => page.getByRole('combobox', { name: 'Appearance' });
const settings = async (page: import('@playwright/test').Page) => { await page.getByRole('button', { name: 'Settings', exact: true }).click(); };
const background = (page: import('@playwright/test').Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim());
test.beforeEach(async ({ page }) => { await recordThemeTimeline(page); });
test('offers one accessible appearance dropdown', async ({ page }) => {
  await page.goto('/'); await settings(page);
  await expect(appearance(page)).toHaveValue('system');
  await expect(appearance(page).locator('option')).toHaveCount(3);
  await expect(page.getByRole('radio')).toHaveCount(0);
});
test('changes theme and saves the choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' }); await page.goto('/'); await settings(page);
  const light = await background(page);
  await appearance(page).selectOption('dark');
  expect(hexLuminance(await background(page))).toBeLessThan(hexLuminance(light));
  expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe('dark');
});
test('supports native keyboard selection with one focus stop', async ({ page }) => {
  await page.goto('/'); await settings(page); await appearance(page).focus();
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await expect(appearance(page)).toHaveValue('dark'); await expect(appearance(page)).toBeFocused();
  await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(appearance(page)).toHaveValue('system');
});
test('restores the choice before first paint on reload', async ({ page }) => {
  await page.goto('/'); await settings(page); await appearance(page).selectOption('dark');
  const chosen = await background(page); await page.reload(); await settings(page);
  await expect(appearance(page)).toHaveValue('dark'); expect(await background(page)).toBe(chosen);
  const timeline = await readThemeTimeline(page);
  expect(timeline.applied.length).toBeGreaterThan(0);
  expect(timeline.applied[0]!.rootChildren).toBeLessThanOrEqual(0);
  expect([...new Set(timeline.applied.map((entry) => entry.dataTheme))]).toEqual(['dark']);
  expect(timeline.firstFrame?.dataTheme).toBe('dark');
  expect(timeline.firstFrame?.background).toBe(chosen);
});
test('follows the system until an explicit preference is selected', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' }); await page.goto('/'); await settings(page);
  const light = await background(page); await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => background(page)).not.toBe(light);
  await appearance(page).selectOption('light'); expect(await background(page)).toBe(light);
});
test('recovers from a corrupt preference', async ({ page }) => {
  await page.goto('/'); await page.evaluate((key) => localStorage.setItem(key, '{broken'), THEME_STORAGE_KEY);
  await page.reload(); await settings(page); await expect(appearance(page)).toHaveValue('system');
});
test('applies a temporary choice when storage is blocked', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Storage disabled', 'SecurityError'); } }); });
  await page.goto('/'); await settings(page); await appearance(page).selectOption('dark');
  await expect(appearance(page)).toHaveValue('dark'); await expect(page.getByTestId('theme-storage-warning')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark');
});
test('boots under the shipped CSP with no remote fonts or scripts', async ({ page }) => {
  const network = await forbidExternalNetwork(page, '127.0.0.1:4319'); const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error))); await page.goto('/'); await settings(page);
  await appearance(page).selectOption('dark'); await page.reload(); await settings(page);
  await expect(appearance(page)).toHaveValue('dark'); expect(network.external).toEqual([]); expect(errors).toEqual([]);
  expect(await page.evaluate(() => [...document.fonts].map(face => face.family))).toEqual([]);
});
