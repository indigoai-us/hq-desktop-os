import { expect, test, type Page } from '@playwright/test';
import { openGallery, startGalleryServer, stopGalleryServer } from '../helpers/dev-gallery';
import type { FixtureServer } from '../helpers/renderer-dev-server';

/**
 * Reduced motion, proven from what the browser computes rather than from CSS
 * text. The same rendered gallery is loaded twice under the two media states,
 * and the progress fill's transition is read off the element.
 *
 * Nothing here waits on an animation frame or a wall clock, so there is no
 * timing race to be flaky about: the transition's declared duration and the
 * settled fill geometry are both deterministic.
 */
const PORT = 4344;

type Motion = {
  token: string;
  transitionProperty: string;
  transitionDurationSeconds: number;
  transitionTimingFunction: string;
  fillRatio: number;
  closeButtonDurationSeconds: number;
};

async function motion(page: Page): Promise<Motion> {
  // The dialog's close affordance is the only other transition in the story.
  await page.getByTestId('gallery-dialog-open').click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const measured = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-testid="gallery-progress"]')!;
    const indicator = root.querySelector<HTMLElement>('[data-slot="progress-indicator"]')!;
    const style = getComputedStyle(indicator);
    const track = root.getBoundingClientRect();
    const fill = indicator.getBoundingClientRect();
    const close = document.querySelector<HTMLElement>('[data-slot="dialog-close"]')!;
    return {
      token: getComputedStyle(document.documentElement).getPropertyValue('--motion-state').trim(),
      transitionProperty: style.transitionProperty,
      transitionDurationSeconds: parseFloat(style.transitionDuration),
      transitionTimingFunction: style.transitionTimingFunction,
      fillRatio: (fill.right - track.left) / track.width,
      closeButtonDurationSeconds: parseFloat(getComputedStyle(close).transitionDuration),
    };
  });

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return measured;
}

test.describe.configure({ mode: 'serial' });

test.describe('US-004 motion honours the reduced-motion preference', () => {
  let server: FixtureServer | undefined;
  let url = '';

  test.beforeAll(async () => {
    ({ server, url } = await startGalleryServer(PORT));
  });

  test.afterAll(async () => {
    await stopGalleryServer(server);
  });

  test('times the progress fill from the shared motion tokens', async ({ page }) => {
    // The media state is emulated on the page, so the query the stylesheet
    // asks about is the one the browser answers.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(
      await page.evaluate(
        () => matchMedia('(prefers-reduced-motion: reduce)').matches,
      ),
    ).toBe(false);
    await openGallery(page, url);
    const measured = await motion(page);

    // The fill moves, and it moves for exactly as long as the token says.
    expect(measured.token).toBe('220ms');
    expect(measured.transitionDurationSeconds).toBeCloseTo(0.22, 3);
    expect(measured.transitionProperty).toContain('transform');
    // Decelerating curve, no overshoot.
    expect(measured.transitionTimingFunction).toBe('cubic-bezier(0.25, 1, 0.5, 1)');
    // Compositor-only: nothing in the transition list moves layout.
    expect(measured.transitionProperty).not.toMatch(/\b(width|height|top|left|margin|all)\b/);
    expect(measured.closeButtonDurationSeconds).toBeGreaterThan(0);
    // The announced value and the painted fill agree.
    expect(measured.fillRatio).toBeGreaterThan(0.41);
    expect(measured.fillRatio).toBeLessThan(0.43);
  });

  test('removes the travel while the state still arrives', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await page.evaluate(
        () => matchMedia('(prefers-reduced-motion: reduce)').matches,
      ),
    ).toBe(true);
    await openGallery(page, url);
    const measured = await motion(page);

    // The token is untouched — the media query wins the cascade instead, so
    // this is a real preference override and not a retimed token.
    expect(measured.token).toBe('220ms');
    expect(measured.transitionDurationSeconds).toBeLessThan(0.001);
    expect(measured.closeButtonDurationSeconds).toBeLessThan(0.001);
    // Same end state: reduced motion removes movement, never information.
    expect(measured.fillRatio).toBeGreaterThan(0.41);
    expect(measured.fillRatio).toBeLessThan(0.43);
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    await expect(page.getByRole('status').filter({ hasText: 'Pending · 42%' })).toBeVisible();
  });
});
