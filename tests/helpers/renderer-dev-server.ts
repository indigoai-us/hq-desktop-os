import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { fork, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigFromFile, type UserConfig } from 'vite';

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


export type StopOutcome = {
  /** How shutdown was established before anything was deleted. */
  shutdown: 'graceful' | 'forced';
  /** Exit status of the owner process, which is always awaited. */
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  /** Proven false before any path is removed. */
  ownerAliveAtCleanup: boolean;
  cacheDir: string;
  cacheRemoved: boolean;
  fixtureDir: string | undefined;
  fixtureRemoved: boolean;
  /** Set when Vite's own close() rejected; rethrown to the caller. */
  closeError: string | undefined;
};

export type FixtureServer = {
  url: string;
  port: number;
  /** Exact owned path, registered at start and removed only after owner exit. */
  cacheDir: string;
  fixtureDir: string | undefined;
  pid: number;
  /**
   * Ask the owner to close gracefully, then dispose of the exact registered
   * paths. Rejects when Vite's close() rejected, so a teardown failure is never
   * reported as a pass.
   */
  stop: (options?: { graceMs?: number }) => Promise<StopOutcome>;
};

/** Is this exact pid still running? No process scanning, no signals sent. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Remove an exact registered path and confirm it is gone. */
function removePath(path: string | undefined): boolean {
  if (!path) return true;
  rmSync(path, { recursive: true, force: true });
  return !existsSync(path);
}

/**
 * Start the renderer on a caller-owned port, inside a process that owns every
 * resource Vite allocates for it.
 *
 * Two problems are solved by the process boundary, and neither has an in-process
 * answer on the installed Vite:
 *
 *  - `close()` can stay pending after the optimizer has run. Vite shuts the
 *    watcher, WebSocket server, environments and HTTP listener down
 *    concurrently, and environment shutdown separately awaits plugin shutdown,
 *    optimizer cancellation and pending transforms. A released HTTP listener
 *    therefore says nothing about whether any of that finished, and must never
 *    be read as cleanup having completed.
 *  - `createServer()` can throw after Vite has already allocated a watcher and
 *    environments, so "it never returned a handle" does not mean "nothing was
 *    allocated".
 *
 * In both cases the owner process is terminated and its exit awaited, which is
 * an observable fact about every resource it held, before the exact registered
 * cache and fixture paths are removed.
 *
 * Each server also gets its own optimizer cache directory. Vite's default is
 * `node_modules/.vite/deps`, which every server in this checkout would share:
 * the optimizer replaces that directory when it commits, so two suites at once —
 * or a suite and a long-lived preview another session owns on 4173 or 4180 —
 * can have their dependency bundles pulled out from under them.
 */
export async function startFixtureServer(options: {
  repoRoot: string;
  root: string;
  host: string;
  port: number;
  /** Removed with the cache, after confirmed owner exit. */
  fixtureDir?: string;
  /** Reproduce a real Vite lifecycle edge case; tests only. */
  inject?:
    | 'deferred-close-bundle'
    | 'rejecting-close-bundle'
    | 'configure-server-throw'
    | 'close-rejects';
}): Promise<FixtureServer> {
  const cacheDir = mkdtempSync(join(tmpdir(), 'hq-vite-cache-'));
  const child = fork(
    join(options.repoRoot, 'tests/helpers/fixture-server-child.mjs'),
    [
      JSON.stringify({
        repoRoot: options.repoRoot,
        root: options.root,
        host: options.host,
        port: options.port,
        cacheDir,
        inject: options.inject,
      }),
    ],
    {
      // Its own process group, so termination can reach anything the owner
      // spawns without ever touching a process this helper does not own.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  const pid = child.pid;
  if (!pid) {
    removePath(cacheDir);
    throw new Error('fixture server owner process could not be forked');
  }

  let stderr = '';
  child.stdout?.resume();
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-16_384);
  });

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  const ready = await new Promise<{ url: string } | { error: string }>((resolve) => {
    const timer = setTimeout(() => resolve({ error: 'startup exceeded 30 seconds' }), 30_000);
    const finish = (result: { url: string } | { error: string }) => {
      clearTimeout(timer);
      resolve(result);
    };
    child.on('message', (message: { type: string; url?: string; message?: string }) => {
      if (message.type === 'ready') finish({ url: message.url! });
      if (message.type === 'error') finish({ error: message.message ?? 'unknown startup failure' });
    });
    child.once('error', (error) => finish({ error: error.message }));
    child.once('exit', (code, signal) =>
      finish({ error: `owner exited before becoming ready (code ${code}, signal ${signal})` }),
    );
  });

  if ('error' in ready) {
    // Whatever Vite allocated before failing — watcher, environments — belonged
    // to this process. Await its exit, then dispose of the registered paths.
    await terminate(child, pid, 5_000);
    const status = await exited;
    if (isAlive(pid)) {
      throw new Error(`fixture server owner ${pid} survived termination after startup failure`);
    }
    removePath(cacheDir);
    throw new Error(
      `fixture server failed to start: ${ready.error}` +
        ` (owner exit code ${status.code}, signal ${status.signal})` +
        (stderr ? `\n${stderr.trim()}` : ''),
    );
  }

  const stop = async ({ graceMs = 10_000 }: { graceMs?: number } = {}): Promise<StopOutcome> => {
    let closeError: string | undefined;
    let shutdown: StopOutcome['shutdown'] = 'graceful';

    const closed = new Promise<'closed' | 'close-failed'>((resolve) => {
      child.on('message', (message: { type: string; message?: string }) => {
        if (message.type === 'closed') resolve('closed');
        if (message.type === 'close-failed') {
          closeError = message.message ?? 'close() rejected';
          resolve('close-failed');
        }
      });
    });

    if (isAlive(pid)) child.send({ type: 'close' });

    let timer: NodeJS.Timeout | undefined;
    const graceful = await Promise.race([
      closed.then(() => true),
      exited.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), graceMs);
      }),
    ]);
    if (timer) clearTimeout(timer);

    if (!graceful) {
      // Vite's close() has not completed. Terminate only this owner and its own
      // process group, then wait for the exit that proves its resources are gone.
      shutdown = 'forced';
      await terminate(child, pid, 5_000);
    }

    const status = await exited;
    const ownerAliveAtCleanup = isAlive(pid);
    if (ownerAliveAtCleanup) {
      throw new Error(
        `fixture server owner ${pid} is still running; refusing to delete ${cacheDir}`,
      );
    }

    const outcome: StopOutcome = {
      shutdown,
      exitCode: status.code,
      exitSignal: status.signal,
      ownerAliveAtCleanup,
      cacheDir,
      cacheRemoved: removePath(cacheDir),
      fixtureDir: options.fixtureDir,
      fixtureRemoved: removePath(options.fixtureDir),
      closeError,
    };
    if (closeError) {
      throw Object.assign(
        new Error(`fixture server shutdown failed: ${closeError}`),
        { outcome },
      );
    }
    return outcome;
  };

  return {
    url: ready.url,
    port: options.port,
    cacheDir,
    fixtureDir: options.fixtureDir,
    pid,
    stop,
  };
}

/**
 * Terminate one owned process group and wait for the exit to be observed.
 * SIGTERM first, SIGKILL only if the group is still alive at the bound.
 */
async function terminate(child: ChildProcess, pid: number, boundMs: number): Promise<void> {
  if (!isAlive(pid)) return;
  const exited = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    child.once('exit', () => resolve());
  });

  signalGroup(pid, 'SIGTERM');
  let timer: NodeJS.Timeout | undefined;
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), boundMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (stopped) return;

  signalGroup(pid, 'SIGKILL');
  await exited;
}

/** Signal the owned group, falling back to the owner alone. */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone; the awaited exit is the authority either way.
    }
  }
}
