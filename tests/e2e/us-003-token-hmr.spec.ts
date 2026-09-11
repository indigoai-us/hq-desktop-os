import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createServer, type UserConfig, type ViteDevServer } from 'vite';
import baseConfig from '../../vite.config';

/**
 * Token hot-module replacement, proven on an isolated copy of the renderer.
 *
 * The fixture is a throwaway checkout copy served on a port this suite owns, so
 * no shared preview is touched and no live source file is edited to manufacture
 * an update. The real vite.config plugins are reused, so what is exercised is
 * the shipped development setup rather than a test-only approximation.
 */
const HOST = '127.0.0.1';
const PORT = 4331;
const ORIGIN = `http://${HOST}:${PORT}`;

const NEW_TOKENS = {
  selection: 'rgb(0, 128, 64)',
  border: 'rgb(128, 0, 64)',
  foreground: 'rgb(0, 64, 128)',
};

test.describe.configure({ mode: 'serial' });

test.describe('US-003 development token HMR', () => {
  let fixture: string;
  let server: ViteDevServer | undefined;
  let tokensPath: string;

  test.beforeAll(async () => {
    const scratch = join(process.cwd(), '.scratch');
    mkdirSync(scratch, { recursive: true });
    fixture = mkdtempSync(join(scratch, 'us-003-hmr-'));
    cpSync(join(process.cwd(), 'src'), join(fixture, 'src'), { recursive: true });
    const root = join(fixture, 'src', 'renderer');
    tokensPath = join(root, 'tokens.css');

    server = await createServer({
      ...(baseConfig as UserConfig),
      configFile: false,
      root,
      resolve: { alias: { '@': root } },
      server: { host: HOST, port: PORT, strictPort: true },
    });
    await server.listen();
  });

  test.afterAll(async () => {
    try {
      await server?.close();
    } finally {
      if (fixture) rmSync(fixture, { recursive: true, force: true });
    }
  });

  async function controlStyles(page: Page) {
    return page.evaluate(() => ({
      selectedBackground: getComputedStyle(
        document.querySelector('[data-testid="selected-sample"]')!,
      ).backgroundColor,
      buttonBorder: getComputedStyle(document.querySelector('[data-testid="check-native"]')!)
        .borderTopColor,
      themeOptionBorder: getComputedStyle(
        document.querySelector('[data-testid="theme-option-light"]')!,
      ).borderTopColor,
      bodyColor: getComputedStyle(document.body).color,
    }));
  }

  test('updates every token-backed control without reloading the page', async ({ page }) => {
    await page.goto(ORIGIN);
    await page.waitForSelector('[data-testid="theme-control"]');
    // Pin an explicit theme so the edited light-theme tokens are the ones in use.
    await page.getByTestId('theme-option-light').click();

    const before = await controlStyles(page);
    expect(before.selectedBackground).not.toBe(NEW_TOKENS.selection);
    expect(before.buttonBorder).not.toBe(NEW_TOKENS.border);
    expect(before.bodyColor).not.toBe(NEW_TOKENS.foreground);

    // Survives HMR, not a reload: a full navigation would clear these.
    await page.evaluate(() => {
      (globalThis as Record<string, unknown>).__hmrSentinel = 'alive';
      (globalThis as Record<string, unknown>).__navigations = 1;
    });

    const original = readFileSync(tokensPath, 'utf8');
    const edited = original
      .replaceAll('#dcd8e2', NEW_TOKENS.selection)
      .replaceAll('#d4d0d9', NEW_TOKENS.border)
      .replaceAll('#1a181e', NEW_TOKENS.foreground);
    expect(edited).not.toBe(original);
    writeFileSync(tokensPath, edited, 'utf8');

    await expect
      .poll(async () => controlStyles(page), { timeout: 20_000 })
      .toEqual({
        selectedBackground: NEW_TOKENS.selection,
        buttonBorder: NEW_TOKENS.border,
        themeOptionBorder: NEW_TOKENS.border,
        bodyColor: NEW_TOKENS.foreground,
      });

    expect(await page.evaluate(() => (globalThis as Record<string, unknown>).__hmrSentinel)).toBe(
      'alive',
    );
    await expect(page.getByTestId('theme-option-light')).toHaveAttribute('aria-checked', 'true');
  });
});
