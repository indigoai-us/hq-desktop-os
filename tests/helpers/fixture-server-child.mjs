/**
 * Owner process for a test Vite dev server.
 *
 * Everything Vite allocates — watcher, WebSocket server, environments, plugin
 * containers, the dependency optimizer, pending transforms — is allocated inside
 * THIS process and nowhere else. That is the point: `server.close()` on the
 * installed Vite can stay pending indefinitely once the optimizer has run, and
 * no in-process signal (least of all `httpServer.listening`) tells the caller
 * that plugins, the optimizer and transforms have finished shutting down. A
 * process boundary does: when this process has exited, every resource it owned
 * is gone, and only then is it safe to delete the directories it was using.
 *
 * Protocol, over the IPC channel the parent opened:
 *   parent → child  {type:'close'}
 *   child  → parent {type:'ready', url, port, cacheDir}
 *                   {type:'closed'}                  close() resolved
 *                   {type:'close-failed', message}   close() rejected
 *                   {type:'error', phase, message}   startup failed
 *
 * The `inject` option exists so tests can reproduce real installed-Vite
 * shutdown and startup behaviour (a plugin hook that never settles, a
 * `configureServer` that throws after Vite has already allocated its watcher
 * and environments) rather than asserting against a hand-written stand-in.
 */
import { createServer, loadConfigFromFile } from 'vite';
import { join } from 'node:path';

// A test runner crash must not leave this detached owner alive.
process.once('disconnect', () => process.exit(1));
const options = JSON.parse(process.argv[2]);

function send(message) {
  process.send?.(message);
}

/** Plugins that reproduce real Vite lifecycle edge cases, on demand. */
function injectedPlugins(inject) {
  if (!inject || inject === 'close-rejects') return [];
  if (inject === 'deferred-close-bundle') {
    return [
      {
        name: 'test-deferred-close-bundle',
        // Vite's environment shutdown awaits plugin shutdown, so this keeps the
        // real close() pending exactly the way the observed hang does.
        closeBundle() {
          return new Promise(() => {});
        },
      },
    ];
  }
  if (inject === 'rejecting-close-bundle') {
    return [
      {
        name: 'test-rejecting-close-bundle',
        async closeBundle() {
          throw new Error('plugin refused to shut down');
        },
      },
    ];
  }
  if (inject === 'configure-server-throw') {
    return [
      {
        name: 'test-configure-server-throw',
        // Vite allocates environments and the watcher before calling this, so
        // the failure leaves real resources behind inside this process.
        configureServer() {
          throw new Error('configureServer refused after allocation');
        },
      },
    ];
  }
  throw new Error(`unknown injection ${inject}`);
}

async function main() {
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'development' },
    join(options.repoRoot, 'vite.config.ts'),
    options.repoRoot,
  );
  if (!loaded) throw new Error('vite.config.ts could not be loaded');

  // The app's real plugins and CSP transforms, plus any injected test plugin.
  const config = {
    ...loaded.config,
    configFile: false,
    root: options.root,
    cacheDir: options.cacheDir,
    resolve: { alias: { '@': options.root } },
    server: { host: options.host, port: options.port, strictPort: true },
    plugins: [...(loaded.config.plugins ?? []), ...injectedPlugins(options.inject)],
  };

  let server;
  try {
    server = await createServer(config);
  } catch (error) {
    send({ type: 'error', phase: 'create', message: error?.message ?? String(error) });
    // Resources Vite allocated before throwing die with this process.
    process.exit(1);
  }

  process.on('message', (message) => {
    if (message?.type !== 'close') return;
    if (options.inject === 'close-rejects') {
      // Exercises the parent's teardown-error path. Labelled honestly: this is
      // the owner reporting a failed shutdown, not a claim about Vite itself.
      send({ type: 'close-failed', message: 'owner could not complete shutdown' });
      process.exit(1);
      return;
    }
    server.close().then(
      () => {
        send({ type: 'closed' });
        process.exit(0);
      },
      (error) => {
        send({ type: 'close-failed', message: error?.message ?? String(error) });
        process.exit(1);
      },
    );
  });

  try {
    await server.listen();
  } catch (error) {
    send({ type: 'error', phase: 'listen', message: error?.message ?? String(error) });
    process.exit(1);
  }

  send({
    type: 'ready',
    url: `http://${options.host}:${options.port}`,
    port: options.port,
    cacheDir: options.cacheDir,
  });
}

main().catch((error) => {
  send({ type: 'error', phase: 'startup', message: error?.message ?? String(error) });
  process.exit(1);
});
