/**
 * Packaged builds ship an authored menu instead of Electron's default one.
 *
 * The default menu is an unreviewed chrome surface: it repeats the app name a
 * third time on screen and hands end users Reload plus Toggle Developer Tools
 * (F12, Ctrl+Shift+I) in a production build. Relaunch and Quit belong here —
 * a semantic application menu — rather than in a second in-app window-chrome
 * bar duplicating the native titlebar controls.
 */
import { Menu, app, type MenuItemConstructorOptions } from 'electron';

/** Menu roles that must never ship to end users in a packaged build. */
export const FORBIDDEN_PACKAGED_MENU_ROLES: readonly string[] = Object.freeze([
  'reload',
  'forcereload',
  'toggledevtools',
]);

export function packagedMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      // Labelled 'File', not the product name: the native titlebar already
      // carries the app name and a menu labelled the same would repeat it.
      label: 'File',
      submenu: [
        {
          label: 'Restart HQ',
          click: () => {
            app.relaunch();
            app.quit();
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },

  ];
}

/**
 * Development keeps Electron's default menu so contributors still have Reload
 * and DevTools against the localhost dev server.
 */
export function installApplicationMenu(isPackaged: boolean): void {
  if (!isPackaged) return;
  Menu.setApplicationMenu(Menu.buildFromTemplate(packagedMenuTemplate()));
}
