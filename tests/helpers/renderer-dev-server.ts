import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, loadConfigFromFile, type UserConfig, type ViteDevServer } from 'vite';

/**
 * Load the app's real Vite configuration through Vite's own loader.
 *
 * Importing `vite.config.ts` directly makes the test runner's transpiler decide
 * the module format of a file it does not own, which fails under Playwright.
 * `loadConfigFromFile` is the supported entry point: Vite bundles and evaluates
 * the config itself, so the returned plugins and CSP transforms are the ones
 * the app ships with.
 */
export async function loadRendererConfig(repoRoot: string): Promise<UserConfig> {
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'development' },
    join(repoRoot, 'vite.config.ts'),
    repoRoot,
  );
  if (!loaded) throw new Error('vite.config.ts could not be loaded');
  return loaded.config;
}

/**
 * Serve the renderer with the app's real plugins on a caller-owned port.
 *
 * Each server gets its own dependency-optimizer cache directory. Vite's default
 * is `node_modules/.vite/deps`, which every server in this checkout would share:
 * the optimizer replaces that directory when it commits a new bundle, so two
 * suites running at once — or a suite and a long-lived preview another session
 * owns — can have their dependency bundles pulled out from under them and serve
 * a page whose modules never load. Distinct ports do not prevent that; distinct
 * cache directories do, and they keep this suite off the shared directory the
 * parent previews on 4173 and 4180 depend on.
 */
export async function startFixtureServer(options: {
  repoRoot: string;
  root: string;
  host: string;
  port: number;
}): Promise<ViteDevServer> {
  const config = await loadRendererConfig(options.repoRoot);
  const cacheDir = mkdtempSync(join(tmpdir(), 'hq-vite-cache-'));
  const server = await createServer({
    ...config,
    configFile: false,
    root: options.root,
    cacheDir,
    resolve: { alias: { '@': options.root } },
    server: { host: options.host, port: options.port, strictPort: true },
  });
  try {
    await server.listen();
  } catch (error) {
    // A failed listen still leaves watchers, a port claim and a cache directory
    // behind. Release them, but never let a teardown problem replace the real
    // failure.
    await stopFixtureServer(server).catch(() => undefined);
    throw error;
  }
  return server;
}

/**
 * Shut a fixture server down and prove its owned resources are gone.
 *
 * `close()` does not always settle promptly once the optimizer has run, so the
 * wait is bounded — but the cache directory is then removed and the removal is
 * verified, so cleanup is a checked outcome rather than an assumption. Returns
 * what actually happened so a caller can assert on it.
 */
export async function stopFixtureServer(
  server: ViteDevServer | undefined,
  timeoutMs = 15_000,
): Promise<{ closed: boolean; cacheDir: string | undefined; cacheRemoved: boolean }> {
  if (!server) return { closed: true, cacheDir: undefined, cacheRemoved: true };
  const cacheDir = server.config.cacheDir;
  let timer: NodeJS.Timeout | undefined;
  const closed = await Promise.race([
    server.close().then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);

  // Only ever remove a directory this helper created.
  const owned = Boolean(cacheDir && cacheDir.startsWith(join(tmpdir(), 'hq-vite-cache-')));
  if (owned && cacheDir) rmSync(cacheDir, { recursive: true, force: true });
  return {
    closed,
    cacheDir,
    cacheRemoved: owned && cacheDir ? !existsSync(cacheDir) : true,
  };
}
