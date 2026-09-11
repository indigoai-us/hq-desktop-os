import { expect, test, type Page } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import { openGallery, resolveTokenColor, startGalleryServer, stopGalleryServer } from '../helpers/dev-gallery';

/**
 * US-004 criterion 3: at 200% zoom, labels, errors, progress and tooltips stay
 * readable and unclipped, with visible focus.
 *
 * Two independent representations of 200%, because neither alone is the whole
 * truth:
 *
 *  1. The page's view of browser zoom — CSS pixels are twice as large, so the
 *     layout viewport halves and devicePixelRatio doubles. This is exactly what
 *     a document observes at 200% zoom on a 1x display, and it is checked as a
 *     magnification (text measured in device pixels doubles), not as a renamed
 *     viewport.
 *  2. Chromium's real `zoom` on the document element, which magnifies the laid
 *     out box tree the way the browser's own zoom does.
 *
 * Neither is an OS-level Ctrl+= keystroke in browser chrome; that stays with the
 * parent's interactive verification.
 */
const PORT = 4343;
const BASE_VIEWPORT = { width: 1280, height: 860 };
/** Half the CSS viewport: what 200% zoom leaves of the same window. */
const ZOOMED_VIEWPORT = { width: 640, height: 430 };

type Readability = {
  dpr: number;
  layoutWidth: number;
  horizontalOverflow: number;
  canvasFontDevicePx: number;
  titleFontDevicePx: number;
  clipped: string[];
  offscreen: string[];
  measured: number;
};

/**
 * Measure what a reader can actually see. `scrollWidth`/`scrollHeight` larger
 * than the client box means the element is cutting its own text off; a rect
 * outside the viewport means the text is off screen with no way to reach it.
 */
async function readability(page: Page): Promise<Readability> {
  return page.evaluate(() => {
    const subjects = [
      'gallery-email',
      'gallery-email-error',
      'gallery-progress',
      'gallery-tooltip-content',
      'gallery-region',
    ];
    const clipped: string[] = [];
    const offscreen: string[] = [];
    let measured = 0;
    const scale = window.devicePixelRatio;

    const labels = [...document.querySelectorAll<HTMLElement>('label')].map(
      (label, index) => ({ id: `label-${index}`, element: label }),
    );
    const byTestId = subjects
      .map((id) => ({ id, element: document.querySelector<HTMLElement>(`[data-testid="${id}"]`) }))
      .filter((entry): entry is { id: string; element: HTMLElement } => Boolean(entry.element));

    for (const { id, element } of [...labels, ...byTestId]) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        offscreen.push(`${id}:collapsed`);
        continue;
      }
      measured += 1;
      if (
        element.scrollWidth > Math.ceil(element.clientWidth) + 1 ||
        element.scrollHeight > Math.ceil(element.clientHeight) + 1
      ) {
        clipped.push(`${id}:${element.scrollWidth}x${element.scrollHeight}`);
      }
      // Vertical scrolling is fine; sideways loss is not. An element starting
      // left of the viewport or ending right of it cannot be read.
      if (rect.left < -1 || rect.right > window.innerWidth + 1 || rect.top < -1) {
        offscreen.push(`${id}:${Math.round(rect.left)},${Math.round(rect.right)}`);
      }
    }

    const root = document.documentElement;
    return {
      dpr: scale,
      layoutWidth: root.clientWidth,
      horizontalOverflow: root.scrollWidth - root.clientWidth,
      canvasFontDevicePx: parseFloat(getComputedStyle(document.body).fontSize) * scale,
      titleFontDevicePx:
        parseFloat(getComputedStyle(document.querySelector('h1')!).fontSize) * scale,
      clipped,
      offscreen,
      measured,
    };
  });
}

/** Focus the tooltip trigger from the keyboard so its content is on screen. */
async function revealTooltip(page: Page): Promise<void> {
  await page.getByTestId('gallery-tooltip-trigger').focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.describe('US-004 readability at 200% zoom', () => {
  let server: ViteDevServer | undefined;
  let url = '';

  test.beforeAll(async () => {
    ({ server, url } = await startGalleryServer(PORT));
  });

  test.afterAll(async () => {
    await stopGalleryServer(server);
  });

  test('magnifies text and keeps every label, error, progress and tooltip usable', async ({
    browser,
  }) => {
    const baselineContext = await browser.newContext({
      viewport: BASE_VIEWPORT,
      deviceScaleFactor: 1,
    });
    const zoomedContext = await browser.newContext({
      viewport: ZOOMED_VIEWPORT,
      deviceScaleFactor: 2,
    });
    try {
      const baselinePage = await baselineContext.newPage();
      const zoomedPage = await zoomedContext.newPage();
      await openGallery(baselinePage, url);
      await openGallery(zoomedPage, url);
      await revealTooltip(baselinePage);
      await revealTooltip(zoomedPage);

      const baseline = await readability(baselinePage);
      const zoomed = await readability(zoomedPage);

      // This really is 200%: the same text occupies twice the device pixels.
      expect(baseline.dpr).toBe(1);
      expect(zoomed.dpr).toBe(2);
      expect(zoomed.canvasFontDevicePx).toBeCloseTo(baseline.canvasFontDevicePx * 2, 1);
      expect(zoomed.titleFontDevicePx).toBeCloseTo(baseline.titleFontDevicePx * 2, 1);
      // And the layout really did reflow into half the CSS width.
      expect(zoomed.layoutWidth).toBeLessThanOrEqual(baseline.layoutWidth / 2);

      // Reflow: content fits the narrower viewport without sideways scrolling.
      expect(zoomed.horizontalOverflow).toBeLessThanOrEqual(1);

      // Nothing a user must read is cut off or pushed out of reach.
      expect(zoomed.measured).toBeGreaterThanOrEqual(4);
      expect(zoomed.clipped).toEqual([]);
      expect(zoomed.offscreen).toEqual([]);
      // The error text is still the full sentence, not an ellipsis.
      await expect(zoomedPage.getByTestId('gallery-email-error')).toHaveText(
        /Enter an email that includes @\. Color is not the only signal/,
      );
      await expect(zoomedPage.getByRole('progressbar')).toBeVisible();
      await expect(zoomedPage.getByRole('tooltip')).toBeVisible();
    } finally {
      await zoomedContext.close();
      await baselineContext.close();
    }
  });

  test('keeps focus visible at 200% zoom', async ({ browser }) => {
    const context = await browser.newContext({ viewport: ZOOMED_VIEWPORT, deviceScaleFactor: 2 });
    try {
      const page = await context.newPage();
      await openGallery(page, url);
      const ring = await resolveTokenColor(page, '--ring');

      for (const testId of ['gallery-email', 'gallery-region', 'gallery-dialog-open']) {
        const target = page.getByTestId(testId);
        // Arrive by key press, so `:focus-visible` is the state under test.
        await target.focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        await expect(target).toBeFocused();
        const focus = await target.evaluate((element: HTMLElement) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return {
            outlineStyle: style.outlineStyle,
            outlineWidth: parseFloat(style.outlineWidth),
            outlineOffset: parseFloat(style.outlineOffset),
            outlineColor: style.outlineColor,
            withinViewport:
              rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.height > 0,
          };
        });
        expect(focus.outlineStyle, testId).not.toBe('none');
        expect(focus.outlineWidth, testId).toBeGreaterThanOrEqual(2);
        expect(focus.outlineOffset, testId).toBeGreaterThanOrEqual(1);
        expect(focus.outlineColor, testId).toBe(ring);
        expect(focus.withinViewport, testId).toBe(true);
      }
    } finally {
      await context.close();
    }
  });

  test('stays unclipped under the browser zoom property as well', async ({ browser }) => {
    const context = await browser.newContext({ viewport: BASE_VIEWPORT, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      await openGallery(page, url);
      const before = await page
        .getByTestId('gallery-email-error')
        .evaluate((element) => element.getBoundingClientRect().height);

      // Chromium's own zoom on the root element: the box tree is magnified.
      await page.evaluate(() => {
        document.documentElement.style.zoom = '2';
      });
      await revealTooltip(page);
      const after = await page
        .getByTestId('gallery-email-error')
        .evaluate((element) => element.getBoundingClientRect().height);
      expect(after).toBeGreaterThan(before * 1.8);

      const measured = await readability(page);
      expect(measured.horizontalOverflow).toBeLessThanOrEqual(1);
      expect(measured.clipped).toEqual([]);
      await expect(page.getByTestId('gallery-email-error')).toBeVisible();
      await expect(page.getByRole('tooltip')).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
