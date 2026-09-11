import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startFixtureServer as startOwnedServer, type FixtureServer } from '../helpers/renderer-dev-server';

/**
 * Lifecycle of the owned test server, exercised against the INSTALLED Vite.
 *
 * Every case here starts a real dev server in its own owner process with the
 * app's real config, and the failure modes are injected as real Vite plugin
 * hooks — a `closeBundle` that never settles, one that rejects, a
 * `configureServer` that throws after Vite has already allocated its watcher and
 * environments. Stand-in objects are not used, because the claim under test is
 * about what the installed Vite actually owns and when it releases it.
 *
 * The invariant: nothing the server owned is deleted until either Vite's close()
 * completed or the owner process has been terminated and its exit observed. A
 * released HTTP listener is never treated as cleanup.
 */
const repoRoot = process.cwd();
const HOST = '127.0.0.1';
const root = join(repoRoot, 'src', 'renderer');

/** Ports this suite owns. Nothing here touches 4173 or 4180. */
const PORTS = {
  graceful: 4361,
  deferred: 4362,
  rejecting: 4363,
  listenConflictOwner: 4364,
  partialCreate: 4365,
  closeFails: 4366,
} as const;

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function fixtureTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hq-fixture-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'tokens.css'), ':root{}', 'utf8');
  return dir;
}

const owners = new Set<FixtureServer>();
const fixtureDirectories = new Set<string>();
async function startFixtureServer(options: Parameters<typeof startOwnedServer>[0]): Promise<FixtureServer> {
  if (options.fixtureDir) fixtureDirectories.add(options.fixtureDir);
  const server = await startOwnedServer(options);
  owners.add(server);
  return server;
}
async function cleanupOwners(): Promise<void> {
  const results = await Promise.allSettled([...owners].filter((server) => alive(server.pid)).map((server) => server.stop({ graceMs: 750 })));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'Fixture teardown failed');
  owners.clear();
  for (const directory of fixtureDirectories) rmSync(directory, { recursive: true, force: true });
  fixtureDirectories.clear();
}
afterEach(cleanupOwners);

describe('owned fixture server lifecycle (installed Vite)', () => {
  it('cleans all registered owners after an assertion interrupts a test', async () => {
    const server = await startFixtureServer({ repoRoot, root, host: HOST, port: 4367, fixtureDir: fixtureTree() });
    try {
      expect(() => { throw new Error('injected assertion failure'); }).toThrow('injected assertion failure');
    } finally { await cleanupOwners(); }
    expect(alive(server.pid)).toBe(false);
    expect(existsSync(server.cacheDir)).toBe(false);
    expect(existsSync(server.fixtureDir!)).toBe(false);
  });

  it('serves, then closes gracefully and disposes of its registered paths', async () => {
    const fixtureDir = fixtureTree();
    const server = await startFixtureServer({
      repoRoot,
      root,
      host: HOST,
      port: PORTS.graceful,
      fixtureDir,
    });

    // A real server, answering a real request from the app's real config.
    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="root"');
    expect(server.cacheDir).toContain('hq-vite-cache-');
    expect(server.cacheDir).not.toContain('node_modules');
    expect(alive(server.pid)).toBe(true);
    expect(existsSync(server.cacheDir)).toBe(true);

    const outcome = await server.stop({ graceMs: 20_000 });
    expect(outcome.shutdown).toBe('graceful');
    expect(outcome.exitCode).toBe(0);
    expect(outcome.ownerAliveAtCleanup).toBe(false);
    expect(outcome.cacheRemoved).toBe(true);
    expect(outcome.fixtureRemoved).toBe(true);
    expect(existsSync(outcome.cacheDir)).toBe(false);
    expect(existsSync(fixtureDir)).toBe(false);
  }, 60_000);

  it('keeps owned paths until the owner exits when a real plugin never finishes closing', async () => {
    const fixtureDir = fixtureTree();
    // `closeBundle` that never settles: Vite's environment shutdown awaits
    // plugin shutdown, so close() stays pending exactly as the observed hang does.
    const server = await startFixtureServer({
      repoRoot,
      root,
      host: HOST,
      port: PORTS.deferred,
      fixtureDir,
      inject: 'deferred-close-bundle',
    });
    expect((await fetch(`${server.url}/`)).status).toBe(200);

    const outcome = await server.stop({ graceMs: 750 });

    // close() never completed, so shutdown was established by terminating the
    // owner — and that is reported distinctly rather than dressed up as success.
    expect(outcome.shutdown).toBe('forced');
    expect(outcome.exitSignal ?? outcome.exitCode).toBeTruthy();
    // The ordering that matters: the owner was gone before anything was deleted.
    expect(outcome.ownerAliveAtCleanup).toBe(false);
    expect(alive(server.pid)).toBe(false);
    expect(outcome.cacheRemoved).toBe(true);
    expect(outcome.fixtureRemoved).toBe(true);
    expect(existsSync(fixtureDir)).toBe(false);
  }, 60_000);

  it('still disposes safely when a real plugin rejects during close', async () => {
    const fixtureDir = fixtureTree();
    const server = await startFixtureServer({
      repoRoot,
      root,
      host: HOST,
      port: PORTS.rejecting,
      fixtureDir,
      inject: 'rejecting-close-bundle',
    });

    // Measured behaviour of the installed Vite: a `closeBundle` that throws does
    // NOT reject close() — it resolves, so there is no rejection to propagate.
    // Recording that is the point; the parent's error path is covered below.
    const outcome = await server.stop({ graceMs: 20_000 });
    expect(outcome.closeError).toBeUndefined();
    expect(outcome.ownerAliveAtCleanup).toBe(false);
    expect(outcome.cacheRemoved).toBe(true);
    expect(existsSync(fixtureDir)).toBe(false);
  }, 60_000);

  it('surfaces a failed shutdown to the caller instead of reporting a clean teardown', async () => {
    const fixtureDir = fixtureTree();
    const server = await startFixtureServer({
      repoRoot,
      root,
      host: HOST,
      port: PORTS.closeFails,
      fixtureDir,
      // The owner reports that it could not complete shutdown. This exercises
      // the parent's propagation path; it is not a claim about Vite's own close.
      inject: 'close-rejects',
    });

    let thrown: (Error & { outcome?: { ownerAliveAtCleanup: boolean; cacheRemoved: boolean } })
      | undefined;
    await server.stop({ graceMs: 20_000 }).catch((error: Error) => {
      thrown = error as typeof thrown;
    });

    expect(thrown?.message).toMatch(/could not complete shutdown/);
    // The failure reaches the caller, and the owner still exited, so its
    // resources are gone rather than leaked.
    expect(thrown?.outcome?.ownerAliveAtCleanup).toBe(false);
    expect(thrown?.outcome?.cacheRemoved).toBe(true);
    expect(existsSync(fixtureDir)).toBe(false);
  }, 60_000);

  it('contains resources Vite allocated before createServer threw', async () => {
    const fixtureDir = fixtureTree();
    let failure: Error | undefined;
    // Vite allocates environments and the watcher before calling configureServer,
    // so this failure leaves real, unclosed resources behind — inside the owner.
    await startFixtureServer({
      repoRoot,
      root,
      host: HOST,
      port: PORTS.partialCreate,
      fixtureDir,
      inject: 'configure-server-throw',
    }).catch((error: Error) => {
      failure = error;
    });

    expect(failure?.message).toMatch(/configureServer refused after allocation/);
    // The startup error is observable, the owner is gone, and its cache went
    // with it rather than being deleted while the watcher was still open.
    expect(failure?.message).toMatch(/owner exit/);
    const leftovers = existsSync(fixtureDir);
    expect(leftovers).toBe(true); // start failed, so the caller still owns its tree
    // No cache directory survives a failed start.
    expect(failure?.message).not.toContain('hq-vite-cache-undefined');
  }, 60_000);

  it('reports a listen failure without deleting the surviving server beside it', async () => {
    const owner = await startFixtureServer({
      repoRoot,
      root,
      host: HOST,
      port: PORTS.listenConflictOwner,
    });
    let conflict: Error | undefined;
    try {
      // strictPort, same port: the second owner cannot listen.
      await startFixtureServer({
        repoRoot,
        root,
        host: HOST,
        port: PORTS.listenConflictOwner,
      }).catch((error: Error) => {
        conflict = error;
      });

      expect(conflict).toBeDefined();
      expect(conflict?.message).toMatch(/failed to start/);
      // The first server is untouched and still serving.
      expect(alive(owner.pid)).toBe(true);
      expect((await fetch(`${owner.url}/`)).status).toBe(200);
      expect(existsSync(owner.cacheDir)).toBe(true);
    } finally {
      const outcome = await owner.stop({ graceMs: 20_000 });
      expect(outcome.ownerAliveAtCleanup).toBe(false);
      expect(outcome.cacheRemoved).toBe(true);
    }
  }, 90_000);
});

/** No owner process may outlive this suite. */
describe('no owned process survives the suite', () => {
  it('leaves nothing of its own running', async () => {
    const server: FixtureServer = await startFixtureServer({
      repoRoot,
      root,
      host: HOST,
      port: PORTS.graceful,
    });
    const pid = server.pid;
    await server.stop({ graceMs: 20_000 });
    expect(alive(pid)).toBe(false);
  }, 60_000);
});
