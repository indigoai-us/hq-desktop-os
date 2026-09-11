import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ViteDevServer } from 'vite';
import { startFixtureServer } from '../helpers/renderer-dev-server';
import { DEV_COMPONENT_GALLERY_PATH } from '../../src/renderer/dev/gallery-path';

/**
 * The development gallery route has to answer with the application document.
 *
 * `/dev/components` also names a source module below the renderer root, so
 * Vite's transform middleware will happily answer the route with compiled
 * JavaScript and a browser opening the documented URL sees source, never the
 * gallery. This starts the app's real dev server — same vite.config, same
 * plugins — on a port this suite owns and asks it what the route returns.
 * No shared preview on 4173 or 4180 is touched.
 */
const HOST = '127.0.0.1';
const PORT = 4352;
const ORIGIN = `http://${HOST}:${PORT}`;
const repoRoot = process.cwd();

describe('development gallery route', () => {
  let server: ViteDevServer | undefined;

  beforeAll(async () => {
    server = await startFixtureServer({
      repoRoot,
      root: join(repoRoot, 'src', 'renderer'),
      host: HOST,
      port: PORT,
    });
  }, 120_000);

  afterAll(async () => {
    // Vite's close awaits the dependency optimizer, which can outlive a short
    // suite. Bound the wait so a slow teardown cannot be read as a failure;
    // the http listener and the owned port are released by close() itself.
    await Promise.race([
      server?.close(),
      new Promise((resolve) => setTimeout(resolve, 15_000)),
    ]);
  }, 60_000);

  it('serves the HTML entry for the gallery path, with and without a trailing slash', async () => {
    for (const path of [DEV_COMPONENT_GALLERY_PATH, `${DEV_COMPONENT_GALLERY_PATH}/`]) {
      const response = await fetch(`${ORIGIN}${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type'), path).toContain('text/html');
      const body = await response.text();
      // The real entry document: it boots main.tsx, which mounts the gallery.
      expect(body, path).toContain('id="root"');
      expect(body, path).toContain('main.tsx');
      // Regression: the module source must not be what the route returns.
      expect(body, path).not.toContain('DevComponentGallery');
    }
  }, 60_000);

  it('still serves real modules, so the rewrite is scoped to the route', async () => {
    const module = await fetch(`${ORIGIN}/dev/components.tsx`);
    expect(module.status).toBe(200);
    expect(module.headers.get('content-type')).toContain('javascript');
    expect(await module.text()).toContain('DevComponentGallery');
  }, 60_000);
});
