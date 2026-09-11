import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';

export function trayIconPath(appPath: string): string {
  return join(appPath, 'build/icon.png');
}

export interface TrayMenuActions {
  showWindow: () => void;
  pauseSync: () => void;
  syncRunning: () => boolean;
  quit: () => void;
}

/** Discoverable tray/status menu: Open, Pause sync (when running), Quit. */
export function buildTrayMenuTemplate(actions: TrayMenuActions): MenuItemConstructorOptions[] {
  return [
    { label: 'Open HQ', click: actions.showWindow },
    {
      label: 'Pause sync',
      enabled: actions.syncRunning(),
      click: actions.pauseSync,
    },
    { type: 'separator' },
    { label: 'Quit HQ', click: actions.quit },
  ];
}

/**
 * Owns the status-tray icon. Creation failure leaves `available=false` so the
 * window remains the only lifecycle surface (Linux no-tray fallback).
 */
export class TrayController {
  available = false;
  private tray: Tray | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private actions: TrayMenuActions | undefined;

  install(iconFile: string, actions: TrayMenuActions): boolean {
    this.destroy();
    try {
      const icon = nativeImage.createFromPath(iconFile).resize({ width: 22, height: 22 });
      if (icon.isEmpty()) throw new Error('Tray icon is missing');
      this.tray = new Tray(icon);
      this.actions = actions;
      this.available = true;
      this.tray.setToolTip('HQ');
      this.tray.on('click', actions.showWindow);
      this.refreshMenu();
      this.timer = setInterval(() => this.refreshMenu(), 5000);
      return true;
    } catch (error) {
      this.destroy();
      console.error('HQ tray is unavailable', error instanceof Error ? error.name : 'unknown');
      return false;
    }
  }

  refreshMenu(): void {
    if (!this.tray || !this.actions) return;
    this.tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(this.actions)));
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.tray?.destroy();
    this.tray = undefined;
    this.actions = undefined;
    this.available = false;
  }
}
