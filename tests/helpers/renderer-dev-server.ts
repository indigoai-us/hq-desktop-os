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

/** Serve a fixture copy of the renderer with the app's real plugins. */
export async function startFixtureServer(options: {
  repoRoot: string;
  root: string;
  host: string;
  port: number;
}): Promise<ViteDevServer> {
  const config = await loadRendererConfig(options.repoRoot);
  const server = await createServer({
    ...config,
    configFile: false,
    root: options.root,
    resolve: { alias: { '@': options.root } },
    server: { host: options.host, port: options.port, strictPort: true },
  });
  try {
    await server.listen();
  } catch (error) {
    // A failed listen still leaves watchers and a port claim behind. Release
    // them, but never let a teardown problem replace the real failure.
    await server.close().catch(() => undefined);
    throw error;
  }
  return server;
}
