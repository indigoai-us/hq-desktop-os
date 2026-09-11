import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { productionRuntimePath } from '../electron/runtime';

/**
 * The window manager, not the app, has to honour a titlebar drag and an
 * edge-corner resize. Calling `setBounds()` proves only that Electron can
 * place a window; it says nothing about whether the OS frame is draggable or
 * resizable. So this spec injects real pointer input at real screen
 * coordinates through the X server and then measures the geometry the main
 * process reports afterwards.
 *
 * Limitations, stated rather than hidden:
 * - Linux only, and X11 only. The app is launched with
 *   ELECTRON_OZONE_PLATFORM_HINT=x11 so the window is an X11 window that the X
 *   server can be driven against; no security flag, sandbox setting or
 *   webPreference is changed. A native Wayland session is NOT covered.
 * - The helper is compiled on demand from tests/native/xtest-pointer.c. If a
 *   compiler or libXtst is missing, the spec skips instead of pretending.
 * - The XTEST extension can be present and answer every call successfully
 *   while the display server discards the events. So the helper is asked to
 *   prove it can actually move the pointer before any assertion is made; if it
 *   cannot, this spec skips with that reason rather than reporting a pass.
 */
const canDriveX11 =
  process.platform === 'linux' && Boolean(process.env.DISPLAY) && existsSync('/usr/include/X11/extensions/XTest.h');

let helperDir: string | null = null;

function compileHelper(): string | null {
  if (!canDriveX11) return null;
  try {
    helperDir = mkdtempSync(join(tmpdir(), 'hq-xtest-'));
    const out = join(helperDir, 'xtest-pointer');
    execFileSync('cc', ['-O2', '-o', out, join(__dirname, '..', 'native', 'xtest-pointer.c'), '-lX11', '-lXtst'], {
      stdio: 'pipe',
      timeout: 60_000,
    });
    return out;
  } catch {
    return null;
  }
}

/** Does this display actually apply injected pointer input? */
function injectionHonoured(binary: string | null): { ok: boolean; reason: string } {
  if (!binary) {
    return { ok: false, reason: 'no X11 display, C compiler or libXtst to build the pointer helper with' };
  }
  try {
    execFileSync(binary, ['selftest'], { stdio: 'pipe', timeout: 30_000 });
    return { ok: true, reason: 'injected pointer motion is applied by this display server' };
  } catch (error: unknown) {
    const output = (error as { stdout?: Buffer }).stdout?.toString().trim();
    return { ok: false, reason: output || 'the pointer helper could not drive this display' };
  }
}

const helper = compileHelper();
const injection = injectionHonoured(helper);

function pointer(...args: string[]): string {
  if (!helper) throw new Error('The pointer helper was not compiled');
  return execFileSync(helper, args, { encoding: 'utf8', timeout: 30_000 });
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

let app: ElectronApplication;
let appWindow: Page;
let pointerHome: [string, string] = ['0', '0'];

const bounds = (): Promise<Rect> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds());
const contentBounds = (): Promise<Rect> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds());

/** Drag the pointer and wait until the geometry stops changing. */
async function dragAndSettle(from: [number, number], to: [number, number]): Promise<Rect> {
  pointer('drag', String(from[0]), String(from[1]), String(to[0]), String(to[1]), '24');
  let previous = await bounds();
  for (let attempt = 0; attempt < 20; attempt++) {
    await appWindow.waitForTimeout(150);
    const current = await bounds();
    if (
      current.x === previous.x &&
      current.y === previous.y &&
      current.width === previous.width &&
      current.height === previous.height
    ) {
      return current;
    }
    previous = current;
  }
  return previous;
}

test.describe('US-002 native pointer input against the OS frame', () => {
  // This suite is only ever run by `pnpm test:host-acceptance` on a host that
  // was provisioned for it. An incapable host FAILS here with the measured
  // reason instead of skipping, so an unproven titlebar drag can never be
  // read as a pass. The default suites do not contain this spec at all.
  test.beforeAll(() => {
    if (!injection.ok) {
      throw new Error(
        `UNSUPPORTED ACCEPTANCE HOST: real pointer input cannot be driven here — ${injection.reason}. ` +
          'Titlebar drag and edge resize are unproven on this host. Run this suite on a provisioned ' +
          'isolated X11 acceptance host (or under Xvfb); it must never run against a live user desktop.',
      );
    }
  });

  test.beforeAll(async () => {
    app = await electron.launch({
      executablePath: productionRuntimePath(),
      args: [],
      timeout: 120_000,
      env: { ...process.env, ELECTRON_OZONE_PLATFORM_HINT: 'x11' } as Record<string, string>,
    });
    appWindow = await app.firstWindow();
    await appWindow.waitForLoadState('domcontentloaded');
    await appWindow.waitForSelector('[data-testid="platform-availability"]');

    // Put the window somewhere predictable and keep it on top for the duration,
    // so the injected pointer lands on this window's own frame and cannot
    // disturb anything else on the desktop. Only stacking is affected.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.setAlwaysOnTop(true);
      win.setBounds({ x: 120, y: 120, width: 900, height: 620 });
      win.focus();
    });
    await appWindow.waitForTimeout(600);

    const [x, y] = pointer('pos').trim().split(/\s+/);
    pointerHome = [x ?? '0', y ?? '0'];
  });

  test.afterAll(async () => {
    if (helper) {
      try {
        pointer('move', pointerHome[0], pointerHome[1]);
      } catch {
        // The display went away; nothing left to restore.
      }
    }
    if (app) {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setAlwaysOnTop(false);
      }).catch(() => undefined);
      await app.close();
    }
    if (helperDir) rmSync(helperDir, { recursive: true, force: true });
  });

  test('the OS titlebar can be dragged with the pointer and the window follows', async () => {
    const before = await bounds();
    const content = await contentBounds();
    const titlebarHeight = content.y - before.y;
    expect(titlebarHeight, 'the window manager must be drawing a titlebar to grab').toBeGreaterThan(0);

    const grabX = before.x + Math.round(before.width / 2);
    const grabY = before.y + Math.round(titlebarHeight / 2);
    const delta = { x: 96, y: 64 };

    const after = await dragAndSettle([grabX, grabY], [grabX + delta.x, grabY + delta.y]);

    expect(Math.abs(after.x - (before.x + delta.x)), `x moved from ${before.x} to ${after.x}`).toBeLessThanOrEqual(12);
    expect(Math.abs(after.y - (before.y + delta.y)), `y moved from ${before.y} to ${after.y}`).toBeLessThanOrEqual(12);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
  });

  test('the OS frame corner can be dragged with the pointer and the window resizes', async () => {
    const before = await bounds();
    const delta = { x: 110, y: 80 };
    const corner: [number, number] = [before.x + before.width - 1, before.y + before.height - 1];

    let after = await dragAndSettle(corner, [corner[0] + delta.x, corner[1] + delta.y]);
    if (after.width === before.width && after.height === before.height) {
      // Mutter's grab region for a corner extends a little outside the visible
      // frame; retry once on that band before calling it a failure.
      const outer: [number, number] = [corner[0] + 3, corner[1] + 3];
      after = await dragAndSettle(outer, [outer[0] + delta.x, outer[1] + delta.y]);
    }

    expect(Math.abs(after.width - (before.width + delta.x)), `width ${before.width} -> ${after.width}`).toBeLessThanOrEqual(16);
    expect(Math.abs(after.height - (before.height + delta.y)), `height ${before.height} -> ${after.height}`).toBeLessThanOrEqual(16);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(4);
  });

  test('the resized window keeps its packaged origin and security settings', async () => {
    // A resize must not have re-created the window with different preferences.
    const state = await app.evaluate(({ BrowserWindow, app: electronApp }) => {
      const contents = BrowserWindow.getAllWindows()[0]!.webContents as unknown as {
        getLastWebPreferences(): Record<string, unknown> | null;
        getURL(): string;
      };
      const prefs = contents.getLastWebPreferences() ?? {};
      return {
        packaged: electronApp.isPackaged,
        url: contents.getURL(),
        sandbox: prefs.sandbox,
        contextIsolation: prefs.contextIsolation,
        nodeIntegration: prefs.nodeIntegration,
      };
    });
    expect(state).toEqual({
      packaged: true,
      url: 'app://hq-desktop-os/index.html',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
  });
});
