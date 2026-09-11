import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchProductionApp,
  productionPreloadPath,
  productionRendererPath,
  repoRoot,
} from './runtime';

/**
 * The counterpart to "the renderer has no Node primitives": what the renderer
 * can still reach. On `file://` a packaged renderer could read any path on the
 * host through fetch or XHR — an unmediated filesystem read that bypasses the
 * PlatformClient boundary entirely. The app is served from a confined
 * `app://hq-desktop-os` origin instead, so this suite asserts both halves:
 * the app's own assets load, and everything else is refused.
 *
 * The bait file is created by this suite, contains a marker rather than any
 * real secret, and is removed afterwards.
 */
const MARKER = 'HQ-ISOLATED-REACHABILITY-MARKER-NOT-A-SECRET';

type FetchOutcome = { status: number; body: string } | { error: string };

let app: ElectronApplication;
let appWindow: Page;
let baitDir: string;
let baitFileUrl: string;

async function tryFetch(page: Page, url: string): Promise<FetchOutcome> {
  return page.evaluate(async (target) => {
    try {
      const response = await fetch(target);
      return { status: response.status, body: (await response.text()).slice(0, 4096) };
    } catch (error: unknown) {
      return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    }
  }, url);
}

function expectRefused(outcome: FetchOutcome, what: string): void {
  if ('error' in outcome) {
    expect(outcome.error, what).toBeTruthy();
    return;
  }
  expect(outcome.status, `${what} must not be served`).toBeGreaterThanOrEqual(400);
  expect(outcome.body, `${what} must leak no bytes`).toBe('');
}

test.beforeAll(async () => {
  baitDir = await mkdtemp(join(tmpdir(), 'hq-reachability-'));
  const bait = join(baitDir, 'bait.txt');
  await writeFile(bait, `${MARKER}\n`);
  baitFileUrl = pathToFileURL(bait).href;
  ({ app, window: appWindow } = await launchProductionApp());
});

test.afterAll(async () => {
  await app?.close();
  if (baitDir) await rm(baitDir, { recursive: true, force: true });
});

test.describe('US-002 renderer reachability', () => {
  test('runs on a confined app origin, not on the whole file scheme', async () => {
    expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(true);
    expect(appWindow.url()).toBe('app://hq-desktop-os/index.html');
    expect(await appWindow.evaluate(() => location.origin)).toBe('app://hq-desktop-os');
    expect(await appWindow.evaluate(() => location.protocol)).toBe('app:');
    // window.isSecureContext is what gates the platform's own restrictions.
    expect(await appWindow.evaluate(() => window.isSecureContext)).toBe(true);
  });

  test('loads its own bundled assets', async () => {
    const entry = await tryFetch(appWindow, './index.html');
    expect(entry).toMatchObject({ status: 200 });
    expect('body' in entry && entry.body).toContain('<div id="root">');

    const assets = await appWindow.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('script[src], link[href]')].map(
        (element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '',
      ),
    );
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      const outcome = await tryFetch(appWindow, new URL(asset, 'app://hq-desktop-os/').href);
      expect(outcome, `own asset ${asset}`).toMatchObject({ status: 200 });
    }
    // The UI actually rendered from those assets.
    await expect(appWindow.locator('h1')).toHaveText('Your work, right here.');
  });

  test('cannot read a local file through fetch', async () => {
    const outcome = await tryFetch(appWindow, baitFileUrl);
    expectRefused(outcome, 'a local file read');
    expect(JSON.stringify(outcome)).not.toContain(MARKER);
  });

  test('cannot read a local file through XMLHttpRequest', async () => {
    const outcome = await appWindow.evaluate(
      (target) =>
        new Promise<{ status?: number; body?: string; error?: string }>((resolve) => {
          try {
            const request = new XMLHttpRequest();
            request.open('GET', target);
            request.onload = () => resolve({ status: request.status, body: request.responseText });
            request.onerror = () => resolve({ error: 'refused' });
            request.send();
          } catch (error: unknown) {
            resolve({ error: error instanceof Error ? error.message : String(error) });
          }
        }),
      baitFileUrl,
    );
    expect(outcome.body ?? '').not.toContain(MARKER);
    expect(outcome.status ?? 0).not.toBe(200);
  });

  test('cannot reach the app own main, preload or source files', async () => {
    const unreachable = [
      pathToFileURL(productionPreloadPath()).href,
      pathToFileURL(join(repoRoot, 'dist-runtime', 'resources', 'app', 'dist', 'main', 'index.js')).href,
      pathToFileURL(join(repoRoot, 'package.json')).href,
      pathToFileURL(join(repoRoot, 'src', 'main', 'index.ts')).href,
      // Same targets addressed through the app scheme rather than file:.
      'app://hq-desktop-os/../main/index.js',
      'app://hq-desktop-os/../preload/index.js',
      'app://hq-desktop-os/../../package.json',
      'app://hq-desktop-os/%2e%2e/main/index.js',
      'app://hq-desktop-os/..%2fmain%2findex.js',
    ];
    for (const target of unreachable) {
      expectRefused(await tryFetch(appWindow, target), target);
    }
    // The renderer's own document is reachable; its neighbours are not.
    expect(await tryFetch(appWindow, pathToFileURL(productionRendererPath()).href)).toHaveProperty(
      'error',
    );
  });

  test('refuses foreign hosts, query strings and credentials on its own scheme', async () => {
    for (const target of [
      'app://evil.example/index.html',
      'app://hq-desktop-os.evil.example/index.html',
      'app://hq-desktop-os/index.html?x=1',
    ]) {
      expectRefused(await tryFetch(appWindow, target), target);
    }

    // Chromium strips userinfo from a standard-scheme URL before the handler
    // ever sees it, so a credentialed URL cannot address anything the bare one
    // could not. The handler refuses credentials anyway if they ever arrive —
    // see the resolver cases in tests/unit/app-protocol.test.ts.
    const credentialed = await tryFetch(appWindow, 'app://user:pass@hq-desktop-os/index.html');
    expect(credentialed).toMatchObject({ status: 200 });
    const bare = await tryFetch(appWindow, 'app://hq-desktop-os/index.html');
    expect('body' in credentialed && 'body' in bare && credentialed.body === bare.body).toBe(true);
  });

  test('has no network egress', async () => {
    for (const target of ['https://example.com/', 'http://127.0.0.1:4173/', 'ws://example.com/']) {
      expectRefused(await tryFetch(appWindow, target), target);
    }
  });

  test('does not expose File System Access as a second route to the host', async () => {
    // Decided explicitly: the File System Access API is out of the
    // PlatformClient boundary, so it is disabled at the Blink level rather
    // than left present and merely awkward to reach.
    expect(
      await appWindow.evaluate(() =>
        [
          'showOpenFilePicker',
          'showDirectoryPicker',
          'showSaveFilePicker',
          'getOriginPrivateDirectory',
        ].filter((name) => typeof (window as unknown as Record<string, unknown>)[name] !== 'undefined'),
      ),
    ).toEqual([]);

    // The Origin Private File System remains, deliberately: it is per-origin
    // sandboxed storage that can name no host path and hold no user file, so
    // it is not a route around PlatformClient. Assert that it really is empty
    // and origin-private rather than assuming it.
    expect(
      await appWindow.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const names: string[] = [];
        for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
          names.push(name);
        }
        return { names, hasPathAccessor: 'path' in root, name: root.name };
      }),
    ).toEqual({ names: [], hasPathAccessor: false, name: '' });
  });

  test('denies permission-gated native capabilities at the session level too', async () => {
    // Defence in depth behind the Blink switch: the session denies every
    // permission request, so a capability that asks the user is refused
    // outright rather than prompting inside a sandboxed shell.
    expect(
      await appWindow.evaluate(async () => {
        try {
          await navigator.mediaDevices.getUserMedia({ video: true });
          return 'granted';
        } catch (error: unknown) {
          return error instanceof Error ? error.name : 'refused';
        }
      }),
    ).not.toBe('granted');

    expect(
      await appWindow.evaluate(async () => {
        try {
          const status = await navigator.permissions.query({
            name: 'geolocation' as PermissionName,
          });
          return status.state;
        } catch {
          return 'query-failed';
        }
      }),
    ).not.toBe('granted');
  });
});
