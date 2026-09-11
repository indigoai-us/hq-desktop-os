import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchProductionApp, runningRuntimePids, terminateRuntimePids } from './runtime';

type BridgeResult = { ok: boolean; error?: { code: string; message: string } };

/**
 * AC-3 is anchored on the platform boundary and on real main-process window
 * state, not on in-app buttons. The window's own minimize / maximize / close
 * affordances are the native OS titlebar controls (see
 * us-002-window-chrome.spec.ts); the IPC channels exercised here stay part of
 * the typed boundary for later stories. Window state is always read from the
 * main process, never from the DOM.
 */
async function invoke(page: Page, channel: string): Promise<BridgeResult> {
  return page.evaluate(
    (ch) =>
      (window as unknown as {
        hqDesktop: { invoke: (c: string, p?: unknown) => Promise<BridgeResult> };
      }).hqDesktop.invoke(ch),
    channel,
  ) as Promise<BridgeResult>;
}

function windowState(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    return {
      minimized: win.isMinimized(),
      maximized: win.isMaximized(),
      visible: win.isVisible(),
      bounds: win.getBounds(),
    };
  });
}

test.describe('US-002 native window lifecycle', () => {
  test('minimizes, maximizes and restores real OS window state through the boundary', async () => {
    const { app, window: appWindow } = await launchProductionApp();
    try {
      expect((await windowState(app)).minimized).toBe(false);

      expect(await invoke(appWindow, 'hq:platform:windowMinimize')).toMatchObject({ ok: true });
      await expect.poll(async () => (await windowState(app)).minimized).toBe(true);

      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.restore());
      await expect.poll(async () => (await windowState(app)).minimized).toBe(false);

      expect(await invoke(appWindow, 'hq:platform:windowMaximizeToggle')).toMatchObject({ ok: true });
      await expect.poll(async () => (await windowState(app)).maximized).toBe(true);

      expect(await invoke(appWindow, 'hq:platform:windowMaximizeToggle')).toMatchObject({ ok: true });
      await expect.poll(async () => (await windowState(app)).maximized).toBe(false);
    } finally {
      await app.close();
    }
  });

  test('closes on request and reopens as a working app', async () => {
    const first = await launchProductionApp();
    const closed = first.app.waitForEvent('close');
    // The window goes away while the invoke is still in flight, so the result
    // never comes back; the close event from the main process is the evidence.
    void invoke(first.window, 'hq:platform:windowClose').catch(() => undefined);
    await closed;
    // window-all-closed quits the app on Windows and Linux.
    expect(first.app.windows()).toHaveLength(0);

    const second = await launchProductionApp();
    try {
      await expect(second.window.locator('h1')).toHaveText('Your work, right here.');
      expect(await invoke(second.window, 'hq:platform:getInfo')).toMatchObject({ ok: true, value: { electron: true } });
      await expect(second.window.getByRole('button', { name: 'Set up HQ', exact: true })).toBeEnabled();
    } finally {
      await second.app.close();
    }
  });

  test('relaunches into a replacement process', async () => {
    const before = new Set(await runningRuntimePids());
    const { app, window: appWindow } = await launchProductionApp();
    const closed = app.waitForEvent('close');

    // The relaunch handler exits the process, so the invoke never resolves.
    void invoke(appWindow, 'hq:platform:appRelaunch').catch(() => undefined);
    await closed;

    let replacements: number[] = [];
    await expect
      .poll(
        async () => {
          replacements = (await runningRuntimePids()).filter((pid) => !before.has(pid));
          return replacements.length;
        },
        { timeout: 60_000, intervals: [500] },
      )
      .toBeGreaterThan(0);

    // Only processes started by this test are terminated.
    await terminateRuntimePids(replacements);
  });

  test('quits the whole app through the boundary', async () => {
    const { app, window: appWindow } = await launchProductionApp();
    const closed = app.waitForEvent('close');
    void invoke(appWindow, 'hq:platform:appQuit').catch(() => undefined);
    await closed;
    expect(app.windows()).toHaveLength(0);
  });
});
