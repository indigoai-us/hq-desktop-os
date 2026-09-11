import { expect, test, type Page } from '@playwright/test';
import { forbidExternalNetwork } from '../helpers/theme-observation';

const LOCAL_HOST = '127.0.0.1:4319';

/** Computed styles of every element the production build actually renders. */
async function renderedElements(page: Page) {
  return page.evaluate(() =>
    [...document.body.querySelectorAll<HTMLElement>('*')]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const style = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          testId: element.getAttribute('data-testid'),
          fontWeight: Number(style.fontWeight),
          fontSize: style.fontSize,
          fontFamily: style.fontFamily,
          radii: [
            style.borderTopLeftRadius,
            style.borderTopRightRadius,
            style.borderBottomRightRadius,
            style.borderBottomLeftRadius,
          ],
          borderWidths: [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ],
          borderColors: [style.borderTopColor, style.borderLeftColor],
          backgroundColor: style.backgroundColor,
        };
      }),
  );
}

test.describe('US-003 rendered HQ styling contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
  });

  test('renders soft controls and sans weights no heavier than 500', async ({ page }) => {
    const elements = await renderedElements(page);
    expect(elements.length).toBeGreaterThan(5);
    expect(
      elements.filter((element) => element.fontWeight > 500).map((element) => element.tag),
    ).toEqual([]);
    await expect(page.getByRole('combobox', { name: 'Appearance' })).toHaveCSS('border-radius', '6px');

  });

  test('uses the readable HQ type ramp', async ({ page }) => {
    expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe('15px');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '24px');
    await expect(page.getByRole('combobox', { name: 'Appearance' })).toHaveCSS('font-size', '15px');
  });

  test('marks the selected control with background only, never an accent bar', async ({ page }) => {
    const selected = page.getByRole('button', { name: 'Settings', exact: true });
    const plain = page.getByRole('button', { name: 'Workspace', exact: true });
    const [selectedStyle, plainStyle] = await Promise.all([
      selected.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          borders: [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ],
          colors: [style.borderTopColor, style.borderLeftColor],
          boxShadow: style.boxShadow,
          before: getComputedStyle(element, '::before').content,
        };
      }),
      plain.evaluate((element) => getComputedStyle(element).backgroundColor),
    ]);

    expect(selectedStyle.background).not.toBe(plainStyle);
    expect(selectedStyle.background).not.toBe('rgba(0, 0, 0, 0)');
    // A left accent bar would show as a thicker or differently coloured left edge.
    expect(new Set(selectedStyle.borders).size).toBe(1);
    expect(selectedStyle.colors[0]).toBe(selectedStyle.colors[1]);
    expect(selectedStyle.boxShadow).toBe('none');
    expect(['none', 'normal']).toContain(selectedStyle.before);
  });

  test('draws navigation icons as strokes and focus as a ring in the token colour', async ({ page }) => {
    const icons = await page.evaluate(() =>
      [...document.querySelectorAll('nav svg')].map((icon) => {
        const style = getComputedStyle(icon);
        return { fill: style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth };
      }),
    );
    expect(icons.length).toBe(4);
    for (const icon of icons) {
      expect(icon.fill).toBe('none');
      expect(icon.stroke).not.toBe('none');
      expect(Number.parseFloat(icon.strokeWidth)).toBeGreaterThan(0);
    }

    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Workspace', exact: true }).focus();
    const focus = await page.getByRole('button', { name: 'Workspace', exact: true }).evaluate((element) => {
      const style = getComputedStyle(element);
      const ring = getComputedStyle(document.documentElement).getPropertyValue('--ring').trim();
      const probe = document.createElement('span');
      probe.style.color = ring;
      document.body.appendChild(probe);
      const ringRgb = getComputedStyle(probe).color;
      probe.remove();
      return {
        width: Number.parseFloat(style.outlineWidth),
        style: style.outlineStyle,
        color: style.outlineColor,
        ringRgb,
      };
    });
    expect(focus.width).toBeGreaterThan(0);
    expect(focus.style).toBe('solid');
    expect(focus.color).toBe(focus.ringRgb);
  });

  test('carries the US-002 fail-closed controls and no duplicate titlebar', async ({ page }) => {
    expect(
      await page.evaluate(() => typeof (window as unknown as { hqDesktop?: unknown }).hqDesktop),
    ).toBe('undefined');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
    await expect(page.getByTestId('open-docs')).toHaveCount(0);
    for (const removed of ['window-minimize', 'window-maximize', 'window-close', 'app-relaunch']) {
      await expect(page.getByTestId(removed)).toHaveCount(0);
    }
    await expect(page.getByRole('region', { name: 'Window controls' })).toHaveCount(0);
    expect(await page.title()).toBe('HQ');
    await expect(page.getByText('HQ Desktop OS', { exact: true })).toHaveCount(0);
  });
});

test.describe('US-003 offline browser launch of the built renderer', () => {
  /**
   * External network is blocked for the whole page lifetime while the locally
   * built assets are served from 127.0.0.1. This proves the browser renderer
   * needs nothing remote — it is not evidence about a packaged Windows or
   * Linux application launch, which needs native host acceptance.
   */
  test('restores the saved theme and legible bundled fonts with no remote fetch', async ({
    page,
  }) => {
    const network = await forbidExternalNetwork(page, LOCAL_HOST);
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Appearance' }).selectOption('dark');
    await page.reload();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();

    await expect(page.getByRole('combobox', { name: 'Appearance' })).toHaveValue('dark');
    expect(network.external).toEqual([]);
    expect(network.all.every((url) => url.startsWith(`http://${LOCAL_HOST}/`))).toBe(true);

    // No web font was loaded; the text still has a real, measurable box.
    expect(await page.evaluate(() => [...document.fonts].map((face) => face.family))).toEqual([]);
    const body = page.getByRole('heading', { level: 1 });
    await expect(body).toBeVisible();
    const metrics = await body.evaluate((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        family: style.fontFamily,
        color: style.color,
        width: box.width,
        height: box.height,
      };
    });
    expect(metrics.family).toContain('system-ui');
    expect(metrics.family).not.toMatch(/https?:/);
    expect(metrics.width).toBeGreaterThan(0);
    expect(metrics.height).toBeGreaterThan(0);
    expect(metrics.color).not.toBe('rgba(0, 0, 0, 0)');
  });
});
