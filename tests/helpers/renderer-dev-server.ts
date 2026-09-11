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
  /** Injectable for lifecycle tests; defaults to Vite's own createServer. */
  createServerImpl?: typeof createServer;
}): Promise<ViteDevServer> {
  const config = await loadRendererConfig(options.repoRoot);
  const cacheDir = mkdtempSync(join(tmpdir(), 'hq-vite-cache-'));
  const create = options.createServerImpl ?? createServer;
  let server: ViteDevServer;
  try {
    server = await create({
      ...config,
      configFile: false,
      root: options.root,
      cacheDir,
      resolve: { alias: { '@': options.root } },
      server: { host: options.host, port: options.port, strictPort: true },
    });
  } catch (error) {
    // createServer never returned a server, so there is nothing to close — but
    // the cache directory it was given already exists and would leak.
    rmSync(cacheDir, { recursive: true, force: true });
    throw error;
  }

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

export type FixtureTeardown = {
  cacheDir: string | undefined;
  cacheRemoved: boolean;
  fixtureRemoved: boolean;
  /** How shutdown was established before anything was deleted. */
  shutdownConfirmedBy: 'close-resolved' | 'listener-released' | 'no-server';
};

/**
 * Shut a fixture server down, then remove what it owned.
 *
 * Ordering is the whole point: the optimizer cache and any fixture copy are
 * deleted only after `close()` has actually settled, because deleting files a
 * still-running watcher or optimizer is holding is how a teardown turns into a
 * mystery failure in the next suite. A close that rejects or outlives the bound
 * throws, so no caller can mistake "gave up waiting" for "shut down" — the
 * earlier version returned `closed: false` and callers ignored it.
 */
export async function stopFixtureServer(
  server: ViteDevServer | undefined,
  options: { timeoutMs?: number; fixtureDir?: string } = {},
): Promise<FixtureTeardown> {
  const { timeoutMs = 30_000, fixtureDir } = options;
  if (!server) {
    return {
      cacheDir: undefined,
      cacheRemoved: true,
      fixtureRemoved: removeDir(fixtureDir),
      shutdownConfirmedBy: 'no-server',
    };
  }
  const cacheDir = server.config.cacheDir;

  // Node keeps a listening server open while keep-alive sockets linger, and
  // `fetch()` keeps exactly those: a suite that made HTTP requests would wait
  // out the whole bound and report a shutdown failure that is really an idle
  // socket. Idle sockets are dropped — repeatedly, since one can go idle just
  // after close begins — while sockets with a request still in flight are left
  // alone, so this waits for real work rather than cutting it short.
  const httpServer = server.httpServer as
    | { closeIdleConnections?: () => void }
    | null
    | undefined;
  const sweeper = httpServer?.closeIdleConnections
    ? setInterval(() => httpServer.closeIdleConnections?.(), 50)
    : undefined;
  sweeper?.unref?.();
  httpServer?.closeIdleConnections?.();

  let timer: NodeJS.Timeout | undefined;
  const closing = server.close();
  // A rejected shutdown is a failure, so it is rethrown. The losing promise of
  // the race must never become an unhandled rejection either way.
  let rejection: unknown;
  const settled = closing.then(
    () => true,
    (error: unknown) => {
      rejection = error;
      return false;
    },
  );

  let resolvedInTime: boolean;
  try {
    resolvedInTime = await Promise.race([
      settled,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }).then(() => {
        // Distinguish "still pending" from "resolved exactly at the bound".
        return false;
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (sweeper) clearInterval(sweeper);
  }
  if (rejection) throw rejection;

  let shutdownConfirmedBy: FixtureTeardown['shutdownConfirmedBy'] = 'close-resolved';
  if (!resolvedInTime) {
    // `close()` has not resolved. Vite's own teardown can stay pending on this
    // installation, so rather than trusting or ignoring the promise, confirm
    // shutdown from something observable: the HTTP listener must be down and the
    // port released. Only then is deleting owned files safe. If the listener is
    // still up, the server really is running and nothing is deleted.
    const listener = server.httpServer as { listening?: boolean } | null | undefined;
    if (listener && listener.listening) {
      throw new Error(
        `vite dev server still listening ${timeoutMs}ms after close(); ` +
          `leaving ${cacheDir ?? 'its cache'} in place rather than deleting files it holds`,
      );
    }
    shutdownConfirmedBy = 'listener-released';
  }

  // Shutdown is confirmed from here on, so removal is safe.
  return {
    cacheDir,
    cacheRemoved: removeDir(isOwnedCache(cacheDir) ? cacheDir : undefined),
    fixtureRemoved: removeDir(fixtureDir),
    shutdownConfirmedBy,
  };
}

/** Only ever remove a cache directory this helper created. */
function isOwnedCache(cacheDir: string | undefined): boolean {
  return Boolean(cacheDir && cacheDir.startsWith(join(tmpdir(), 'hq-vite-cache-')));
}

/** Remove a directory and confirm it is gone. Absent counts as removed. */
function removeDir(dir: string | undefined): boolean {
  if (!dir) return true;
  rmSync(dir, { recursive: true, force: true });
  return !existsSync(dir);
}
