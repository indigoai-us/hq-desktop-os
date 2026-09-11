import { expect, test, type Page } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import {
  openGallery,
  resolveTokenColor,
  startGalleryServer,
  stopGalleryServer,
  tabToTestId,
} from '../helpers/dev-gallery';

/**
 * US-004 criterion 3: at 200% zoom, labels, errors, progress and tooltips stay
 * readable and unclipped, with visible focus.
 *
 * Both representations of 200% used here are SURROGATES, deliberately labelled
 * as such:
 *
 *  1. A halved CSS layout viewport with deviceScaleFactor 2 — what a document
 *     observes at 200% zoom on a 1x display. To keep that from being a mere
 *     renamed viewport, magnification is measured against a real 100% baseline
 *     context, and the device-pixel figure is only ever used alongside the
 *     layout and clipping checks, never as visual proof on its own.
 *  2. Chromium's `zoom` on the document element, which magnifies the laid out
 *     box tree the way browser zoom does.
 *
 * Neither is a Ctrl+= in browser chrome, an OS display-scaling change, or a
 * sighted reading of the result. The 200% criterion is not closed by this file
 * alone; the parent's interactive verification closes it.
 */
const PORT = 4343;
const BASE_VIEWPORT = { width: 1280, height: 860 };
/** Half the CSS viewport: what 200% zoom leaves of the same window. */
const ZOOMED_VIEWPORT = { width: 640, height: 430 };

/** Everything a user must be able to read on this surface, including feedback. */
const REQUIRED_SUBJECTS = [
  'gallery-email',
  'gallery-email-error',
  'gallery-pending',
  'gallery-progress',
  'gallery-region',
] as const;

/**
 * The tooltip is measured on its own, while open. An open tooltip legitimately
 * overlaps the content near its trigger, so folding it into the same pass would
 * turn normal overlay behaviour into a false clipping failure.
 */
const TOOLTIP_SUBJECT = ['gallery-tooltip-content'] as const;

type Readability = {
  dpr: number;
  layoutWidth: number;
  horizontalOverflow: number;
  canvasFontDevicePx: number;
  titleFontDevicePx: number;
  missing: string[];
  selfClipped: string[];
  outsideViewport: string[];
  occluded: string[];
  measured: number;
};

/**
 * Measure what a reader can actually reach.
 *
 * Each subject is scrolled to first — vertical scrolling is allowed, losing
 * content sideways is not — then three separate ways of being unreadable are
 * checked: the element clipping its own text, the element sitting outside the
 * viewport horizontally or above it, and an ancestor or overlay covering it.
 * `elementFromPoint` is what catches ancestor `overflow` clipping, which a
 * bounding box alone cannot see.
 */
async function readability(page: Page, subjects: readonly string[]): Promise<Readability> {
  return page.evaluate((wanted) => {
    const missing: string[] = [];
    const selfClipped: string[] = [];
    const outsideViewport: string[] = [];
    const occluded: string[] = [];
    let measured = 0;

    const targets: { id: string; element: HTMLElement }[] = [
      ...[...document.querySelectorAll<HTMLElement>('label')].map((element, index) => ({
        id: `label-${index}`,
        element,
      })),
    ];
    for (const id of wanted) {
      const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      if (!element) {
        missing.push(id);
        continue;
      }
      targets.push({ id, element });
    }

    for (const { id, element } of targets) {
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        missing.push(`${id}:collapsed`);
        continue;
      }
      measured += 1;

      if (
        element.scrollWidth > Math.ceil(element.clientWidth) + 1 ||
        element.scrollHeight > Math.ceil(element.clientHeight) + 1
      ) {
        selfClipped.push(`${id}:${element.scrollWidth}x${element.scrollHeight}`);
      }
      if (
        rect.left < -1 ||
        rect.right > window.innerWidth + 1 ||
        rect.bottom < -1 ||
        rect.top > window.innerHeight + 1
      ) {
        outsideViewport.push(
          `${id}:${Math.round(rect.left)},${Math.round(rect.right)},${Math.round(rect.top)}`,
        );
        continue;
      }
      // Ancestor overflow or an overlay hiding the subject: ask the document
      // what is actually painted at the subject's midpoint.
      const x = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1);
      const y = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(element.contains(hit) || hit.contains(element))) {
        occluded.push(`${id}:${hit?.tagName ?? 'none'}`);
      }
    }

    const root = document.documentElement;
    return {
      dpr: window.devicePixelRatio,
      layoutWidth: root.clientWidth,
      horizontalOverflow: root.scrollWidth - root.clientWidth,
      canvasFontDevicePx:
        parseFloat(getComputedStyle(document.body).fontSize) * window.devicePixelRatio,
      titleFontDevicePx:
        parseFloat(getComputedStyle(document.querySelector('h1')!).fontSize) *
        window.devicePixelRatio,
      missing,
      selfClipped,
      outsideViewport,
      occluded,
      measured,
    };
  }, subjects);
}

/**
 * Reveal the tooltip the way a keyboard user does. Radix opens on focus only
 * when the trigger matches `:focus-visible`, which a programmatic `focus()` on
 * a freshly loaded page does not — so arriving by key press is both the honest
 * interaction and the one the component answers.
 */
async function revealTooltip(page: Page): Promise<void> {
  await tabToTestId(page, 'gallery-tooltip-trigger');
  await expect(page.getByRole('tooltip')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.describe('US-004 readability at a 200% zoom surrogate', () => {
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

      const baseline = await readability(baselinePage, REQUIRED_SUBJECTS);
      const zoomed = await readability(zoomedPage, REQUIRED_SUBJECTS);

      // Every required subject was present to measure — a missing subject must
      // never read as "nothing was clipped".
      expect(zoomed.missing).toEqual([]);
      expect(zoomed.measured).toBeGreaterThanOrEqual(REQUIRED_SUBJECTS.length + 2);
      expect(baseline.missing).toEqual([]);

      // The surrogate behaves like magnification: the same text occupies twice
      // the device pixels, and the layout reflowed into half the CSS width.
      expect(baseline.dpr).toBe(1);
      expect(zoomed.dpr).toBe(2);
      expect(zoomed.canvasFontDevicePx).toBeCloseTo(baseline.canvasFontDevicePx * 2, 1);
      expect(zoomed.titleFontDevicePx).toBeCloseTo(baseline.titleFontDevicePx * 2, 1);
      expect(zoomed.layoutWidth).toBeLessThanOrEqual(baseline.layoutWidth / 2);

      // Reflow: no second scrolling direction.
      expect(zoomed.horizontalOverflow).toBeLessThanOrEqual(1);

      // Three independent ways of being unreadable, each asserted.
      expect(zoomed.selfClipped).toEqual([]);
      expect(zoomed.outsideViewport).toEqual([]);
      expect(zoomed.occluded).toEqual([]);

      // The tooltip, measured while it is actually open.
      await revealTooltip(zoomedPage);
      const tooltip = await readability(zoomedPage, TOOLTIP_SUBJECT);
      expect(tooltip.missing).toEqual([]);
      expect(tooltip.selfClipped).toEqual([]);
      expect(tooltip.outsideViewport).toEqual([]);
      expect(tooltip.occluded).toEqual([]);

      // The error is still the whole sentence, not an ellipsis.
      await expect(zoomedPage.getByTestId('gallery-email-error')).toHaveText(
        /Enter an email that includes @\. Color is not the only signal/,
      );
      await expect(zoomedPage.getByTestId('gallery-pending')).toHaveText(/Pending · 42% complete/);
      await expect(zoomedPage.getByRole('progressbar')).toBeVisible();
      await expect(zoomedPage.getByRole('tooltip')).toBeVisible();
    } finally {
      await zoomedContext.close();
      await baselineContext.close();
    }
  });

  test('keeps open overlay content readable at the zoom surrogate', async ({ browser }) => {
    const context = await browser.newContext({ viewport: ZOOMED_VIEWPORT, deviceScaleFactor: 2 });
    try {
      const page = await context.newPage();
      await openGallery(page, url);

      // Dialog: opened from the keyboard, measured while open.
      await tabToTestId(page, 'gallery-dialog-open');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toBeVisible();
      const dialog = await page.evaluate(() => {
        const content = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!;
        const rect = content.getBoundingClientRect();
        const title = content.querySelector<HTMLElement>('[data-slot="dialog-title"]')!;
        const description = content.querySelector<HTMLElement>('[data-slot="dialog-description"]')!;
        const overflows = (element: HTMLElement) =>
          element.scrollWidth > Math.ceil(element.clientWidth) + 1 ||
          element.scrollHeight > Math.ceil(element.clientHeight) + 1;
        return {
          withinViewport:
            rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.top >= -1,
          titleClipped: overflows(title),
          descriptionClipped: overflows(description),
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(dialog.withinViewport).toBe(true);
      expect(dialog.titleClipped).toBe(false);
      expect(dialog.descriptionClipped).toBe(false);
      expect(dialog.horizontalOverflow).toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      // Select: the popover content is portaled and positioned, so it is the
      // most likely thing to be pushed off a narrow viewport.
      await tabToTestId(page, 'gallery-region');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('listbox')).toBeVisible();
      const options = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => {
          const rect = option.getBoundingClientRect();
          return {
            text: option.textContent?.trim(),
            within: rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.height > 0,
            clipped: option.scrollWidth > Math.ceil(option.clientWidth) + 1,
          };
        }),
      );
      expect(options.length).toBe(3);
      expect(options.filter((option) => !option.within)).toEqual([]);
      expect(options.filter((option) => option.clipped)).toEqual([]);
      await page.keyboard.press('Escape');
    } finally {
      await context.close();
    }
  });

  test('keeps focus visible at the zoom surrogate', async ({ browser }) => {
    const context = await browser.newContext({ viewport: ZOOMED_VIEWPORT, deviceScaleFactor: 2 });
    try {
      const page = await context.newPage();
      await openGallery(page, url);
      const ring = await resolveTokenColor(page, '--ring');

      for (const testId of ['gallery-email', 'gallery-region', 'gallery-dialog-open']) {
        // Arrive by key press, so `:focus-visible` is the state under test.
        await tabToTestId(page, testId);
        const target = page.getByTestId(testId);
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

  test('stays unclipped under the CSS zoom surrogate as well', async ({ browser }) => {
    const context = await browser.newContext({ viewport: BASE_VIEWPORT, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      await openGallery(page, url);
      const before = await page
        .getByTestId('gallery-email-error')
        .evaluate((element) => element.getBoundingClientRect().height);

      // Chromium's own zoom on the document element: the box tree is magnified.
      await page.evaluate(() => {
        document.documentElement.style.zoom = '2';
      });
      const after = await page
        .getByTestId('gallery-email-error')
        .evaluate((element) => element.getBoundingClientRect().height);
      expect(after).toBeGreaterThan(before * 1.8);

      const measured = await readability(page, REQUIRED_SUBJECTS);
      expect(measured.missing).toEqual([]);
      expect(measured.horizontalOverflow).toBeLessThanOrEqual(1);
      expect(measured.selfClipped).toEqual([]);
      expect(measured.outsideViewport).toEqual([]);
      expect(measured.occluded).toEqual([]);
      await expect(page.getByTestId('gallery-email-error')).toBeVisible();
      await expect(page.getByTestId('gallery-pending')).toBeVisible();

      await revealTooltip(page);
      const tooltip = await readability(page, TOOLTIP_SUBJECT);
      expect(tooltip.missing).toEqual([]);
      expect(tooltip.selfClipped).toEqual([]);
      expect(tooltip.outsideViewport).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
