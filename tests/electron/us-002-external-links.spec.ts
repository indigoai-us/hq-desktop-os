import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchProductionApp } from './runtime';

type BridgeResult = { ok: boolean; error?: { code: string; message: string } };

const REVIEWED = 'https://github.com/indigoai-us/hq-desktop-os';

let app: ElectronApplication;
let appWindow: Page;

/**
 * `shell.openExternal` hands the URL to the host operating system — the real
 * external boundary. It is recorded instead of launching a browser; every
 * decision under test (allowlist, payload validation, window-open handler)
 * still runs in the production main process.
 */
async function recordExternalOpens(): Promise<void> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { __openedExternal: string[] }).__openedExternal = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
}

async function openedExternal(): Promise<string[]> {
  return app.evaluate(
    () => (globalThis as unknown as { __openedExternal: string[] }).__openedExternal ?? [],
  );
}

async function openExternal(url: unknown): Promise<BridgeResult> {
  return appWindow.evaluate(
    (target) =>
      (window as unknown as {
        hqDesktop: { invoke: (c: string, p?: unknown) => Promise<BridgeResult> };
      }).hqDesktop.invoke('hq:platform:openExternal', { url: target }),
    url,
  ) as Promise<BridgeResult>;
}

test.beforeAll(async () => {
  ({ app, window: appWindow } = await launchProductionApp());
  await recordExternalOpens();
});

test.afterAll(async () => {
  await app?.close();
});

test.describe('US-002 external link policy', () => {
  test('opens an exact reviewed HTTPS target through the host browser', async () => {
    const before = (await openedExternal()).length;
    const result = await openExternal(REVIEWED);
    expect(result.ok).toBe(true);
    expect((await openedExternal()).slice(before)).toEqual([REVIEWED]);
  });

  test.describe('refuses unsafe or unreviewed targets', () => {
    const refused: Array<[string, string]> = [
      ['javascript scheme', 'javascript:alert(1)'],
      ['file scheme', 'file:///etc/passwd'],
      ['data scheme', 'data:text/html,<h1>x</h1>'],
      ['smb scheme', 'smb://192.168.0.5/share'],
      ['plain http', 'http://github.com/indigoai-us/hq-desktop-os'],
      ['unreviewed https host', 'https://evil.example/indigoai-us/hq-desktop-os'],
      ['prefix lookalike host', 'https://github.com.evil.example/indigoai-us/hq-desktop-os'],
      ['trailing slash near miss', 'https://github.com/indigoai-us/hq-desktop-os/'],
      ['embedded credentials', 'https://user:pass@github.com/indigoai-us/hq-desktop-os'],
      ['fragment appended', 'https://github.com/indigoai-us/hq-desktop-os#x'],
      ['nested reviewed url', 'https://evil.example/?next=https://github.com/indigoai-us/hq-desktop-os'],
    ];

    for (const [name, url] of refused) {
      test(name, async () => {
        const before = await openedExternal();
        const result = await openExternal(url);
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('rejected_link');
        expect(await openedExternal()).toEqual(before);
      });
    }
  });

  test('denies window.open for unsafe targets and never spawns a window', async () => {
    const before = await openedExternal();
    const windowsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

    for (const url of ['https://evil.example', 'javascript:alert(1)', 'file:///etc/passwd']) {
      expect(await appWindow.evaluate((target) => window.open(target) === null, url)).toBe(true);
    }

    await appWindow.waitForTimeout(500);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(windowsBefore);
    expect(await openedExternal()).toEqual(before);
  });

  test('forwards a reviewed window.open target to the host browser without a new window', async () => {
    const before = (await openedExternal()).length;
    const windowsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

    expect(await appWindow.evaluate((target) => window.open(target) === null, REVIEWED)).toBe(true);
    await expect.poll(async () => (await openedExternal()).slice(before)).toEqual([REVIEWED]);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(windowsBefore);
  });

  test('blocks in-window navigation away from the packaged renderer', async () => {
    const currentUrl = () =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getURL());
    const isLoading = () =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.isLoading());
    const originalUrl = await currentUrl();

    for (const target of ['https://example.com/', 'file:///etc/passwd', 'about:blank']) {
      await appWindow.evaluate((url) => {
        window.location.href = url;
      }, target);
      // The main process is authoritative about what the window actually loaded.
      await expect.poll(isLoading, { timeout: 15_000 }).toBe(false);
      expect(await currentUrl(), `navigation to ${target} must be refused`).toBe(originalUrl);
      expect(await appWindow.evaluate(() => document.querySelector('h1')?.textContent)).toBe(
        'Your desktop companion',
      );
    }
  });

  test('opens the reviewed docs link from the application UI', async () => {
    const before = (await openedExternal()).length;
    await appWindow.getByTestId('open-docs').click();
    await expect(appWindow.getByTestId('platform-last-result')).toHaveText('Open docs → ok');
    expect((await openedExternal()).slice(before)).toEqual([REVIEWED]);
  });
});
