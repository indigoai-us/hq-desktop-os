import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchProductionApp } from './runtime';

/**
 * The window must carry exactly one identity layer and one set of window
 * controls, both supplied by the operating system. These assertions read the
 * real main-process window object and the real application menu, so they hold
 * on whichever platform the suite runs on.
 */
let app: ElectronApplication;
let appWindow: Page;

test.beforeAll(async () => {
  ({ app, window: appWindow } = await launchProductionApp());
});

test.afterAll(async () => {
  await app?.close();
});

test.describe('US-002 window chrome', () => {
  test('keeps a native OS frame that the platform decorates', async () => {
    const frame = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      const bounds = win.getBounds();
      const content = win.getContentBounds();
      return {
        title: win.getTitle(),
        chromeHeight: bounds.height - content.height,
        chromeWidth: bounds.width - content.width,
        resizable: win.isResizable(),
        movable: win.isMovable(),
        minimizable: win.isMinimizable(),
        maximizable: win.isMaximizable(),
        closable: win.isClosable(),
        fullScreenable: win.isFullScreenable(),
      };
    });

    expect(frame.title).toBe('HQ Desktop OS');
    // A frameless window has no chrome at all; a decorated one always costs
    // height for the titlebar the window manager draws.
    expect(frame.chromeHeight, 'the OS must be drawing a window frame').toBeGreaterThan(0);
    expect(frame).toMatchObject({
      resizable: true,
      movable: true,
      minimizable: true,
      maximizable: true,
      closable: true,
    });
  });

  test('is really resizable and really movable, not just flagged as such', async () => {
    const read = () =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds());
    const original = await read();

    // The window manager, not the app, decides whether a resize or a move is
    // honoured. Asking for one and seeing the geometry change is the evidence
    // that edge-drag resize and titlebar drag have something to act on.
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]!.setBounds(size);
    }, { ...original, width: original.width - 120, height: original.height - 90 });
    await expect.poll(async () => (await read()).width).toBe(original.width - 120);
    expect((await read()).height).toBe(original.height - 90);

    await app.evaluate(({ BrowserWindow }, position) => {
      BrowserWindow.getAllWindows()[0]!.setPosition(position.x, position.y);
    }, { x: original.x + 60, y: original.y + 40 });
    await expect.poll(async () => (await read()).x).toBe(original.x + 60);
    expect((await read()).y).toBe(original.y + 40);

    // The minimum size the window was created with is still enforced.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.setSize(100, 100);
    });
    await expect.poll(async () => (await read()).width).toBeGreaterThanOrEqual(640);

    await app.evaluate(({ BrowserWindow }, bounds) => {
      BrowserWindow.getAllWindows()[0]!.setBounds(bounds);
    }, original);
  });

  test('ships no reload or developer-tools menu surface in the packaged app', async () => {
    const menu = await app.evaluate(({ Menu }) => {
      const applicationMenu = Menu.getApplicationMenu();
      if (!applicationMenu) return null;
      const roles: string[] = [];
      const labels: string[] = [];
      const walk = (items: Electron.MenuItem[]) => {
        for (const item of items) {
          if (item.role) roles.push(String(item.role).toLowerCase());
          if (item.label) labels.push(item.label);
          if (item.submenu) walk(item.submenu.items);
        }
      };
      walk(applicationMenu.items);
      return { top: applicationMenu.items.map((item) => item.label), roles, labels };
    });

    expect(menu, 'the packaged app must ship an authored menu').not.toBeNull();
    for (const forbidden of ['reload', 'forcereload', 'toggledevtools']) {
      expect(menu!.roles, `menu must not expose ${forbidden}`).not.toContain(forbidden);
    }
    // Relaunch and Quit live in a semantic application menu, not in a second
    // window-chrome bar inside the page.
    expect(menu!.roles).toContain('quit');
    expect(menu!.labels).toContain('Relaunch');
    expect(menu!.labels.some((label) => label.includes('Documentation'))).toBe(true);
    // The menu bar must not repeat the app name the titlebar already shows.
    expect(menu!.top).not.toContain('HQ Desktop OS');
  });

  test('does not open DevTools from the usual accelerators', async () => {
    const devToolsOpen = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.webContents.isDevToolsOpened(),
      );
    expect(await devToolsOpen()).toBe(false);

    for (const accelerator of ['F12', 'Control+Shift+I', 'Control+Shift+J', 'Control+R', 'F5']) {
      await appWindow.keyboard.press(accelerator);
    }
    await appWindow.waitForTimeout(1_000);

    expect(await devToolsOpen()).toBe(false);
    // Reload accelerators must not have navigated the window away either.
    await expect(appWindow.locator('h1')).toHaveText('Your desktop companion');
  });

  test('renders no second app title and no second set of window controls', async () => {
    const title = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getTitle(),
    );

    const duplicates = await appWindow.evaluate((appTitle) => {
      const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
      const target = normalize(appTitle);
      const repeatsTitle = [...document.body.querySelectorAll<HTMLElement>('*')]
        .filter((element) => element.children.length === 0)
        .filter((element) => normalize(element.textContent ?? '') === target)
        .map((element) => element.tagName.toLowerCase());
      const controlWords = ['minimize', 'maximize', 'restore', 'close', 'unmaximize'];
      const controlButtons = [...document.querySelectorAll<HTMLElement>('button, [role="button"]')]
        .map((element) =>
          normalize(`${element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''}`),
        )
        .filter((label) => controlWords.some((word) => label.split(' ').includes(word)));
      const controlTestIds = [
        'window-minimize',
        'window-maximize',
        'window-close',
        'app-relaunch',
      ].filter((id) => document.querySelector(`[data-testid="${id}"]`) !== null);
      return { repeatsTitle, controlButtons, controlTestIds };
    }, title);

    expect(duplicates.repeatsTitle, 'the page must not restate the window title').toEqual([]);
    expect(duplicates.controlButtons, 'window controls belong to the OS titlebar').toEqual([]);
    expect(duplicates.controlTestIds).toEqual([]);
  });

  test('names its remaining region honestly and announces the external link', async () => {
    const region = appWindow.getByRole('region', { name: 'Application actions' });
    await expect(region).toBeVisible();
    await expect(region.getByRole('button')).toHaveCount(2);

    const docs = appWindow.getByTestId('open-docs');
    await expect(docs).toHaveAccessibleName(/in your browser/i);
    await expect(appWindow.getByTestId('check-native')).toHaveAccessibleName('Check native connection');
  });
});
