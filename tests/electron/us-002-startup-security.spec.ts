import { readFile } from 'node:fs/promises';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchProductionApp,
  productionPreloadPath,
  productionRendererPath,
  readWebPreferences,
} from './runtime';
import { REQUIRED_CSP_DIRECTIVES, cspFromHtml, parseCsp } from '../helpers/csp';
import { collectViolations, installViolationRecorder } from '../helpers/csp-violations';

let app: ElectronApplication;
let appWindow: Page;

test.beforeAll(async () => {
  ({ app, window: appWindow } = await launchProductionApp());
  await installViolationRecorder(appWindow);
  await appWindow.reload();
  await appWindow.waitForSelector('.companion-shell');
});

test.afterAll(async () => {
  await app?.close();
});

test.describe('US-002 packaged startup and security preferences', () => {
  test('runs as a real production app serving the local built renderer', async () => {
    expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(true);
    // Served from a confined custom origin, never from the file: scheme —
    // see us-002-renderer-reachability.spec.ts for what that buys.
    expect(appWindow.url()).toBe('app://hq-desktop-os/index.html');
    await expect(appWindow.locator('h1')).toHaveText('Your work, right here.');
  });

  test('enforces sandbox, context isolation and no renderer Node integration', async () => {
    expect(await readWebPreferences(app)).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    });

    // The renderer must have no Node primitives at all, in any world.
    expect(
      await appWindow.evaluate(() =>
        ['require', 'process', 'module', 'Buffer', 'global', '__dirname'].filter(
          (name) => typeof (globalThis as Record<string, unknown>)[name] !== 'undefined',
        ),
      ),
    ).toEqual([]);
  });

  test('does not weaken the Chromium sandbox through launch switches', async () => {
    const switches = await app.evaluate(({ app: electronApp }) =>
      ['no-sandbox', 'disable-gpu-sandbox', 'disable-site-isolation-trials', 'disable-web-security']
        .filter((name) => electronApp.commandLine.hasSwitch(name)),
    );
    expect(switches).toEqual([]);
    expect(await app.evaluate(() => process.argv.slice(1))).not.toContain('--no-sandbox');
  });

  test('refuses inline and foreign script through the shipped CSP', async () => {
    const policy = cspFromHtml(await readFile(productionRendererPath(), 'utf8'));
    expect(policy).toBeTruthy();
    const directives = parseCsp(policy!);
    for (const [name, sources] of Object.entries(REQUIRED_CSP_DIRECTIVES)) {
      expect(directives[name], `CSP ${name}`).toEqual(sources);
    }
    expect(policy).not.toContain('unsafe-eval');

    const violations = await collectViolations(appWindow, async () => {
      expect(
        await appWindow.evaluate(async () => {
          const inline = document.createElement('script');
          inline.textContent = 'globalThis.__cspInline = true;';
          document.body.appendChild(inline);
          const foreign = document.createElement('script');
          foreign.src = 'https://cdn.evil.example/payload.js';
          document.body.appendChild(foreign);
          await new Promise((resolve) => setTimeout(resolve, 300));
          return (globalThis as Record<string, unknown>).__cspInline === true;
        }),
      ).toBe(false);
    });

    expect(violations.map((violation) => violation.blockedURI)).toEqual(
      expect.arrayContaining(['inline', 'https://cdn.evil.example/payload.js']),
    );
  });

  test('ships a preload the Electron sandbox can actually load', async () => {
    // A sandboxed preload only gets a polyfilled require; a relative require
    // here silently drops the bridge and the app can never reach native mode.
    const bundle = await readFile(productionPreloadPath(), 'utf8');
    const required = [...bundle.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
    expect(new Set(required)).toEqual(new Set(['electron']));

    const bridge = await appWindow.evaluate(() => {
      const exposed = (window as unknown as { hqDesktop?: Record<string, unknown> }).hqDesktop;
      return exposed
        ? { kind: exposed.kind, version: exposed.version, keys: Object.keys(exposed).sort() }
        : null;
    });
    expect(bridge).toEqual({
      kind: 'electron',
      version: '0.1.0',
      keys: ['invoke', 'kind', 'version'],
    });
    expect(await appWindow.evaluate(() => window.hqDesktop?.invoke('hq:platform:getInfo'))).toMatchObject({ ok: true, value: { electron: true } });
  });

  test('exposes no raw Electron or IPC primitives to the renderer', async () => {
    expect(
      await appWindow.evaluate(() =>
        ['ipcRenderer', 'electron', 'electronAPI', 'contextBridge'].filter(
          (name) => typeof (window as unknown as Record<string, unknown>)[name] !== 'undefined',
        ),
      ),
    ).toEqual([]);
  });

  test('refuses permission requests and webview attachment by default', async () => {
    expect(
      await appWindow.evaluate(async () => {
        try {
          const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
          return status.state;
        } catch {
          return 'query-failed';
        }
      }),
    ).not.toBe('granted');

    expect((await readWebPreferences(app)).webviewTag).toBe(false);
  });
});
