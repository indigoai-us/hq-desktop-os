import { join } from 'node:path';
import type { Page, ViteDevServer } from './dev-gallery-types';
import { startFixtureServer } from './renderer-dev-server';
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
 * Vite's close awaits the dependency optimizer, which can outlive a spec.
 * Bound the wait so a slow teardown never masks or replaces a real failure.
 */
export async function stopGalleryServer(server: ViteDevServer | undefined): Promise<void> {
  await Promise.race([
    server?.close(),
    new Promise((resolve) => setTimeout(resolve, 15_000)),
  ]);
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
