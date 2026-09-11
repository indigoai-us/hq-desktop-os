import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ViteDevServer } from 'vite';
import { startFixtureServer, stopFixtureServer } from '../helpers/renderer-dev-server';

/**
 * Lifecycle of the helper every owned test server uses.
 *
 * These exercise the real module through its own seams — an injected
 * `createServer` and a server object whose `close()` resolves late, rejects, or
 * never settles — rather than asserting anything about its source. What matters
 * is the ordering guarantee: owned directories are removed only after shutdown
 * is confirmed, and a shutdown that fails or overruns reaches the caller.
 */
const repoRoot = process.cwd();

/** A stand-in dev server whose shutdown the test controls. */
function fakeServer(options: {
  cacheDir: string;
  close: () => Promise<void>;
  listening?: boolean;
}): ViteDevServer {
  return {
    config: { cacheDir: options.cacheDir },
    close: options.close,
    httpServer: { listening: options.listening ?? false },
  } as unknown as ViteDevServer;
}

function ownedCacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hq-vite-cache-'));
  writeFileSync(join(dir, 'deps.json'), '{}', 'utf8');
  return dir;
}

describe('fixture server teardown', () => {
  it('removes the owned cache only after shutdown has settled', async () => {
    const cacheDir = ownedCacheDir();
    const order: string[] = [];

    const outcome = await stopFixtureServer(
      fakeServer({
        cacheDir,
        close: async () => {
          // Shutdown takes a few turns, as a real optimizer commit does.
          await new Promise((resolve) => setTimeout(resolve, 25));
          // The cache must still be on disk while the server is stopping.
          order.push(existsSync(cacheDir) ? 'cache-present-at-close' : 'cache-deleted-early');
          order.push('closed');
        },
      }),
    );

    expect(order).toEqual(['cache-present-at-close', 'closed']);
    expect(outcome.shutdownConfirmedBy).toBe('close-resolved');
    expect(outcome.cacheRemoved).toBe(true);
    expect(existsSync(cacheDir)).toBe(false);
  });

  it('removes a fixture tree too, and only after shutdown', async () => {
    const cacheDir = ownedCacheDir();
    const fixtureDir = mkdtempSync(join(tmpdir(), 'hq-fixture-'));
    mkdirSync(join(fixtureDir, 'src'), { recursive: true });
    writeFileSync(join(fixtureDir, 'src', 'tokens.css'), ':root{}', 'utf8');
    let fixturePresentAtClose = false;

    const outcome = await stopFixtureServer(
      fakeServer({
        cacheDir,
        close: async () => {
          fixturePresentAtClose = existsSync(fixtureDir);
        },
      }),
      { fixtureDir },
    );

    expect(fixturePresentAtClose).toBe(true);
    expect(outcome.fixtureRemoved).toBe(true);
    expect(existsSync(fixtureDir)).toBe(false);
    expect(existsSync(cacheDir)).toBe(false);
  });

  it('fails the caller when shutdown rejects, and keeps the files', async () => {
    const cacheDir = ownedCacheDir();

    await expect(
      stopFixtureServer(
        fakeServer({ cacheDir, close: async () => Promise.reject(new Error('watcher stuck')) }),
      ),
    ).rejects.toThrow(/watcher stuck/);
    // Nothing was deleted, because nothing was confirmed shut down.
    expect(existsSync(cacheDir)).toBe(true);
    // The helper correctly refused to delete it, so this test disposes of the
    // directory it created. Nothing was ever listening on this stand-in.
    rmSync(cacheDir, { recursive: true, force: true });
    // This test asked the helper to leave it; the test owns it now.
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('fails the caller when the server is still listening after the bound', async () => {
    const cacheDir = ownedCacheDir();
    let settle: (() => void) | undefined;
    const never = new Promise<void>((resolve) => {
      settle = resolve;
    });

    await expect(
      stopFixtureServer(fakeServer({ cacheDir, close: () => never, listening: true }), {
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/still listening/);
    // The cache a live server may still hold is left alone.
    expect(existsSync(cacheDir)).toBe(true);
    rmSync(cacheDir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });

    // Release the pending close so the test leaves nothing running. The helper
    // must already have attached a handler, or this would be an unhandled
    // rejection rather than a resolved promise.
    settle?.();
    await never;
  });

  it('confirms shutdown from the released listener when close stays pending', async () => {
    const cacheDir = ownedCacheDir();
    let settle: (() => void) | undefined;
    const never = new Promise<void>((resolve) => {
      settle = resolve;
    });

    // Vite's close() can stay pending on this installation. The listener being
    // down is observable, so it is what gets checked — the pending promise is
    // neither trusted nor silently ignored.
    const outcome = await stopFixtureServer(
      fakeServer({ cacheDir, close: () => never, listening: false }),
      { timeoutMs: 50 },
    );
    expect(outcome.shutdownConfirmedBy).toBe('listener-released');
    expect(outcome.cacheRemoved).toBe(true);
    expect(existsSync(cacheDir)).toBe(false);

    settle?.();
    await never;
  });

  it('treats a missing server as nothing to shut down', async () => {
    const outcome = await stopFixtureServer(undefined);
    expect(outcome.cacheDir).toBeUndefined();
    expect(outcome.cacheRemoved).toBe(true);
  });

  it('never deletes a cache directory it does not own', async () => {
    const foreign = mkdtempSync(join(tmpdir(), 'someone-elses-cache-'));
    const outcome = await stopFixtureServer(
      fakeServer({ cacheDir: foreign, close: async () => undefined }),
    );
    expect(outcome.cacheRemoved).toBe(true);
    expect(existsSync(foreign)).toBe(true);
  });
});

describe('fixture server startup failures', () => {
  it('leaves no cache directory behind when createServer fails', async () => {
    const seen: string[] = [];

    await expect(
      startFixtureServer({
        repoRoot,
        root: join(repoRoot, 'src', 'renderer'),
        host: '127.0.0.1',
        port: 4399,
        createServerImpl: (async (config: { cacheDir?: string }) => {
          if (config.cacheDir) seen.push(config.cacheDir);
          throw new Error('createServer refused');
        }) as never,
      }),
    ).rejects.toThrow(/createServer refused/);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('hq-vite-cache-');
    expect(existsSync(seen[0])).toBe(false);
  });

  it('releases the cache directory when listen fails', async () => {
    let cacheDir = '';

    await expect(
      startFixtureServer({
        repoRoot,
        root: join(repoRoot, 'src', 'renderer'),
        host: '127.0.0.1',
        port: 4399,
        createServerImpl: (async (config: { cacheDir?: string }) => {
          cacheDir = config.cacheDir ?? '';
          return {
            config,
            listen: async () => Promise.reject(new Error('EADDRINUSE')),
            close: async () => undefined,
          };
        }) as never,
      }),
    ).rejects.toThrow(/EADDRINUSE/);

    expect(cacheDir).toContain('hq-vite-cache-');
    expect(existsSync(cacheDir)).toBe(false);
  });
});
