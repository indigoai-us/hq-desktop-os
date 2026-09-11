import { join } from 'node:path';
import type { Page, ViteDevServer } from './dev-gallery-types';
import { startFixtureServer, stopFixtureServer } from './renderer-dev-server';
import { DEV_COMPONENT_GALLERY_PATH } from '../../src/renderer/dev/gallery-path';

/**
 * The component gallery is development-only, so it cannot be reached through
 * the production preview these suites otherwise use. Each gallery spec owns its
 * own dev server on its own strict port: the shared previews on 4173 and 4180
 * belong to another session and are never reused, restarted or stopped.
 */
export const GALLERY_HOST = '127.0.0.1';

export async function startGalleryServer(port: number): Promise<{
  server: ViteDevServer;
  url: string;
}> {
  const repoRoot = process.cwd();
  const server = await startFixtureServer({
    repoRoot,
    root: join(repoRoot, 'src', 'renderer'),
    host: GALLERY_HOST,
    port,
  });
  return { server, url: `http://${GALLERY_HOST}:${port}${DEV_COMPONENT_GALLERY_PATH}` };
}

/**
 * Shut the spec's server down and confirm its optimizer cache was removed.
 *
 * `stopFixtureServer` throws when the shutdown rejects or outlives its bound, so
 * that failure reaches the spec instead of being swallowed; a surviving cache
 * directory is raised here for the same reason.
 */
export async function stopGalleryServer(server: ViteDevServer | undefined): Promise<void> {
  const outcome = await stopFixtureServer(server);
  if (!outcome.cacheRemoved) {
    throw new Error(`gallery server left its optimizer cache behind: ${outcome.cacheDir}`);
  }
}

/**
 * Walk keyboard focus to a control the way a keyboard user would.
 *
 * This matters beyond tidiness: Radix opens a tooltip on focus only when the
 * trigger matches `:focus-visible`, which a programmatic `focus()` on a freshly
 * loaded page does not. Arriving by key press is both the honest interaction and
 * the one the component answers.
 */
export async function tabToTestId(page: Page, testId: string, limit = 30): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.focus();
  });
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? null,
    );
    if (focused === testId) return;
  }
  throw new Error(`keyboard focus never reached ${testId} within ${limit} tabs`);
}

/** Wait until the gallery has actually mounted, not merely until HTML arrived. */
export async function openGallery(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForSelector('[data-testid="dev-component-gallery"]');
}

/**
 * Resolve a design token to the value the browser computes for it. Comparing
 * against this instead of a copied hex keeps the assertion about the shared
 * token: retheme the token and the expectation moves with it.
 */
export async function resolveTokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, token);
}
