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
    await page.waitForSelector('[data-testid="theme-control"]');
  });

  test('renders square corners and sans weights no heavier than 500', async ({ page }) => {
    const elements = await renderedElements(page);
    expect(elements.length).toBeGreaterThan(5);
    expect(
      elements.filter((element) => element.fontWeight > 500).map((element) => element.tag),
    ).toEqual([]);
    expect(
      elements
        .filter((element) => element.radii.some((radius) => radius !== '0px'))
        .map((element) => element.testId ?? element.tag),
    ).toEqual([]);
  });

  test('sizes canvas text at 13px and the page title at 20px', async ({ page }) => {
    expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe('13px');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '20px');
    const elements = await renderedElements(page);
    const canvas = elements.filter((element) => element.tag !== 'h1' && element.tag !== 'svg');
    expect(canvas.length).toBeGreaterThan(3);
    expect(canvas.every((element) => element.fontSize === '13px')).toBe(true);
  });

  test('marks the selected control with background only, never an accent bar', async ({ page }) => {
    const selected = page.getByTestId('selected-sample');
    const plain = page.getByTestId('check-native');
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

  test('draws theme icons as strokes and focus as a ring in the token colour', async ({ page }) => {
    const icons = await page.evaluate(() =>
      [...document.querySelectorAll('[role="radiogroup"] svg')].map((icon) => {
        const style = getComputedStyle(icon);
        return { fill: style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth };
      }),
    );
    expect(icons.length).toBe(3);
    for (const icon of icons) {
      expect(icon.fill).toBe('none');
      expect(icon.stroke).not.toBe('none');
      expect(Number.parseFloat(icon.strokeWidth)).toBeGreaterThan(0);
    }

    await page.getByTestId('check-native').focus();
    const focus = await page.getByTestId('check-native').evaluate((element) => {
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
    await expect(page.getByTestId('platform-availability')).toHaveText('Native bridge unavailable');
    await expect(page.getByTestId('open-docs')).toBeDisabled();
    for (const removed of ['window-minimize', 'window-maximize', 'window-close', 'app-relaunch']) {
      await expect(page.getByTestId(removed)).toHaveCount(0);
    }
    await expect(page.getByRole('region', { name: 'Window controls' })).toHaveCount(0);
    expect(await page.title()).toBe('HQ Desktop OS');
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
    await page.getByTestId('theme-option-dark').click();
    await page.reload();
    await page.waitForSelector('[data-testid="theme-control"]');

    await expect(page.getByTestId('theme-option-dark')).toHaveAttribute('aria-checked', 'true');
    expect(network.external).toEqual([]);
    expect(network.all.every((url) => url.startsWith(`http://${LOCAL_HOST}/`))).toBe(true);

    // No web font was loaded; the text still has a real, measurable box.
    expect(await page.evaluate(() => [...document.fonts].map((face) => face.family))).toEqual([]);
    const body = page.getByTestId('platform-availability');
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
