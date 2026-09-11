import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { startFixtureServer, type FixtureServer } from '../helpers/renderer-dev-server';

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
  // Spacing and typography are token-backed too, so an edit must move layout
  // and text size, not only colour.
  space1: '3px',
  space2: '7px',
  space3: '11px',
  space6: '23px',
  textCanvas: '17px',
  textTitle: '29px',
};

test.describe.configure({ mode: 'serial' });

test.describe('US-003 development token HMR', () => {
  let fixture: string;
  let server: FixtureServer | undefined;
  let tokensPath: string;

  test.beforeAll(async () => {
    const scratch = join(process.cwd(), '.scratch');
    mkdirSync(scratch, { recursive: true });
    fixture = mkdtempSync(join(scratch, 'us-003-hmr-'));
    cpSync(join(process.cwd(), 'src'), join(fixture, 'src'), { recursive: true });
    const root = join(fixture, 'src', 'renderer');
    tokensPath = join(root, 'tokens.css');

    server = await startFixtureServer({
      repoRoot: process.cwd(),
      root,
      host: HOST,
      port: PORT,
      // Registered with the server, so it is deleted only after the process
      // that owned the watcher over it has exited.
      fixtureDir: fixture,
    });
  });

  test.afterAll(async () => {
    // The fixture tree is deleted only after the process that owned the watcher
    // over it has exited — removing a tree a live watcher is holding is how
    // teardown becomes the next run's mystery failure.
    const outcome = await server!.stop({ graceMs: 3_000 });
    expect(outcome.ownerAliveAtCleanup, 'owner still running at cleanup').toBe(false);
    expect(outcome.cacheRemoved, 'optimizer cache survived teardown').toBe(true);
    expect(outcome.fixtureRemoved, 'fixture copy survived teardown').toBe(true);
  });

  async function controlStyles(page: Page) {
    return page.evaluate(() => {
      const style = (selector: string) =>
        getComputedStyle(document.querySelector(selector)!);
      const selected = style('[data-testid="selected-sample"]');
      const themeOption = style('[data-testid="theme-option-light"]');
      return {
        selectedBackground: selected.backgroundColor,
        buttonBorder: style('[data-testid="selected-sample"]').borderTopColor,
        themeOptionBorder: themeOption.borderTopColor,
        bodyColor: getComputedStyle(document.body).color,
        // Spacing: the actions row gap, a control's padding, the page padding
        // and the utility-driven radiogroup gap.
        actionsGap: style('.companion-sidebar nav').gap,
        buttonPadding: style('[data-testid="selected-sample"]').paddingTop,
        pagePadding: style('.companion-main').paddingTop,
        radiogroupGap: style('[role="radiogroup"]').gap,
        // Typography.
        bodyFontSize: getComputedStyle(document.body).fontSize,
        titleFontSize: style('h1').fontSize,
      };
    });
  }

  test('updates every token-backed control without reloading the page', async ({ page }) => {
    await page.goto(ORIGIN);
    await page.waitForSelector('[data-testid="theme-control"]');
    // Pin an explicit theme so the edited light-theme tokens are the ones in use.
    await page.getByTestId('theme-option-light').click();

    const before = await controlStyles(page);
    const after = {
      selectedBackground: NEW_TOKENS.selection,
      buttonBorder: NEW_TOKENS.border,
      themeOptionBorder: NEW_TOKENS.border,
      bodyColor: NEW_TOKENS.foreground,
      actionsGap: NEW_TOKENS.space2,
      buttonPadding: NEW_TOKENS.space2,
      pagePadding: NEW_TOKENS.space6,
      radiogroupGap: NEW_TOKENS.space1,
      bodyFontSize: NEW_TOKENS.textCanvas,
      titleFontSize: NEW_TOKENS.textTitle,
    };
    for (const [property, updated] of Object.entries(after)) {
      expect(before[property as keyof typeof after], property).not.toBe(updated);
    }

    // Survives HMR, not a reload: a full navigation would clear these.
    await page.evaluate(() => {
      (globalThis as Record<string, unknown>).__hmrSentinel = 'alive';
      (globalThis as Record<string, unknown>).__navigations = 1;
    });

    const original = readFileSync(tokensPath, 'utf8');
    const edited = original
      .replaceAll('#dcd8e2', NEW_TOKENS.selection)
      .replaceAll('#d4d0d9', NEW_TOKENS.border)
      .replaceAll('#1a181e', NEW_TOKENS.foreground)
      .replace(/--space-1:[^;]+;/, `--space-1: ${NEW_TOKENS.space1};`)
      .replace(/--space-2:[^;]+;/, `--space-2: ${NEW_TOKENS.space2};`)
      .replace(/--space-3:[^;]+;/, `--space-3: ${NEW_TOKENS.space3};`)
      .replace(/--space-6:[^;]+;/, `--space-6: ${NEW_TOKENS.space6};`)
      .replace(/--text-canvas:[^;]+;/, `--text-canvas: ${NEW_TOKENS.textCanvas};`)
      .replace(/--text-title:[^;]+;/, `--text-title: ${NEW_TOKENS.textTitle};`);
    expect(edited).not.toBe(original);
    writeFileSync(tokensPath, edited, 'utf8');

    await expect.poll(async () => controlStyles(page), { timeout: 20_000 }).toEqual(after);

    expect(await page.evaluate(() => (globalThis as Record<string, unknown>).__hmrSentinel)).toBe(
      'alive',
    );
    await expect(page.getByTestId('theme-option-light')).toHaveAttribute('aria-checked', 'true');
  });
});
