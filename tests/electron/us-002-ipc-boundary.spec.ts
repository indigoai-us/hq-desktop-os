import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchProductionApp, productionPreloadPath } from './runtime';

type BridgeResult = { ok: boolean; value?: unknown; error?: { code: string; message: string } };

let app: ElectronApplication;
let appWindow: Page;

async function invoke(page: Page, channel: string, payload?: unknown): Promise<BridgeResult> {
  return page.evaluate(
    ([ch, body]) =>
      (window as unknown as {
        hqDesktop: { invoke: (c: string, p?: unknown) => Promise<BridgeResult> };
      }).hqDesktop.invoke(ch as string, body),
    [channel, payload] as const,
  ) as Promise<BridgeResult>;
}

test.beforeAll(async () => {
  ({ app, window: appWindow } = await launchProductionApp());
});

test.afterAll(async () => {
  await app?.close();
});

test.describe('US-002 validated IPC senders and payloads', () => {
  test('answers a well formed request from the application renderer', async () => {
    const result = await invoke(appWindow, 'hq:platform:getInfo');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      bridgeVersion: '0.1.0',
      platform: process.platform,
      electron: true,
    });
  });

  test.describe('rejects malformed openExternal payloads', () => {
    const malformed: Array<[string, unknown]> = [
      ['missing payload', undefined],
      ['null payload', null],
      ['bare string', 'https://github.com/indigoai-us/hq-desktop-os'],
      ['array', []],
      ['empty object', {}],
      ['wrong field', { href: 'https://github.com/indigoai-us/hq-desktop-os' }],
      ['non string url', { url: 42 }],
      ['empty url', { url: '' }],
      ['oversized url', { url: `https://github.com/${'a'.repeat(2100)}` }],
    ];

    for (const [name, payload] of malformed) {
      test(name, async () => {
        const result = await invoke(appWindow, 'hq:platform:openExternal', payload);
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('invalid_payload');
      });
    }
  });

  test('refuses channels outside the published platform boundary', async () => {
    for (const channel of ['hq:platform:runShell', 'hq:secret', '__proto__', 'hq:platform:getinfo']) {
      const result = await invoke(appWindow, channel);
      expect(result.ok, `channel ${channel} must be refused`).toBe(false);
      expect(result.error?.code).toBe('invalid_payload');
    }
  });

  test('keeps unimplemented native capabilities failing closed', async () => {
    for (const channel of [
      'hq:platform:filesystemSelectDirectory',
      'hq:platform:credentialsGetStatus',
      'hq:platform:processListManaged',
      'hq:platform:updaterGetStatus',
    ]) {
      const result = await invoke(appWindow, channel);
      expect(result.ok, `${channel} must not report native success`).toBe(false);
      expect(result.error?.code).toBe('not_implemented');
    }
  });

  test('rejects an untrusted frame that loads the same preload', async () => {
    const attackerDir = await mkdtemp(join(tmpdir(), 'hq-untrusted-'));
    const attackerPage = join(attackerDir, 'attacker.html');
    await writeFile(attackerPage, '<!doctype html><meta charset="utf-8"><title>untrusted</title><div id="ready"></div>');

    const attackerUrl = pathToFileURL(attackerPage).href;
    const openedPromise = app.waitForEvent('window');
    await app.evaluate(
      async ({ BrowserWindow }, { preload, url }) => {
        const rogue = new BrowserWindow({
          show: false,
          webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        await rogue.loadURL(url);
      },
      { preload: productionPreloadPath(), url: attackerUrl },
    );
    const rogue = await openedPromise;
    await rogue.waitForLoadState('domcontentloaded');

    // The rogue frame holds the genuine preload bridge, so only the main
    // process sender check can stop it.
    expect(await rogue.evaluate(() => typeof (window as unknown as { hqDesktop?: unknown }).hqDesktop)).toBe('object');

    for (const channel of ['hq:platform:getInfo', 'hq:platform:appQuit', 'hq:platform:windowClose']) {
      const result = await invoke(rogue, channel);
      expect(result.ok, `${channel} must reject an untrusted sender`).toBe(false);
      expect(result.error?.code).toBe('untrusted_sender');
    }

    // The app is still alive and its own window still works.
    expect((await invoke(appWindow, 'hq:platform:getInfo')).ok).toBe(true);
    await app.evaluate(({ BrowserWindow }) => {
      const [, extra] = BrowserWindow.getAllWindows();
      extra?.destroy();
    });
  });

  test('shows an unavailable state in production when the preload is absent', async () => {
    const openedPromise = app.waitForEvent('window');
    await app.evaluate(
      async ({ BrowserWindow }, entryUrl) => {
        const bare = new BrowserWindow({
          show: false,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        await bare.loadURL(entryUrl);
      },
      'app://hq-desktop-os/index.html',
    );
    const bare = await openedPromise;
    await bare.waitForSelector('[data-testid="platform-unavailable"]');

    expect(await bare.evaluate(() => typeof (window as unknown as { hqDesktop?: unknown }).hqDesktop)).toBe('undefined');
    await expect(bare.getByTestId('platform-availability')).toHaveText('Native bridge unavailable');
    await expect(bare.getByTestId('open-docs')).toBeDisabled();
    // Window controls are the OS titlebar's, so there is nothing in the page to
    // disable — and nothing that could quietly come back offering a fake one.
    for (const removed of ['window-minimize', 'window-maximize', 'window-close', 'app-relaunch']) {
      await expect(bare.getByTestId(removed)).toHaveCount(0);
    }

    await bare.getByTestId('check-native').click();
    await expect(bare.getByTestId('platform-last-result')).toHaveText(
      'Check native → unavailable: Native platform bridge is unavailable.',
    );
    expect(
      await bare.evaluate(() =>
        ['require', 'process', 'module', 'Buffer'].filter(
          (name) => typeof (globalThis as Record<string, unknown>)[name] !== 'undefined',
        ),
      ),
    ).toEqual([]);

    await app.evaluate(({ BrowserWindow }) => {
      const [, extra] = BrowserWindow.getAllWindows();
      extra?.destroy();
    });
  });
});
