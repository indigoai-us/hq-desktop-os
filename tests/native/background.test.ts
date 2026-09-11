import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyLaunchAtLogin,
  autostartEntry,
  isWslEnvironment,
  launchAtLoginSupported,
  setLinuxAutostart,
  startupExecutable,
} from '../../src/main/autostart';
import {
  backgroundLifecycleMode,
  closeBehavior,
  quitStopsOwnedRuntimes,
  windowsClosedBehavior,
} from '../../src/main/lifecycle';
import { buildTrayMenuTemplate, trayIconPath } from '../../src/main/tray';
import { PreferenceStore } from '../../src/main/preferences';
import { ShutdownGate } from '../../src/main/shutdown';

describe('tray lifecycle decisions', () => {
  it('hides to tray only when opted in and a tray exists; Quit never hides', () => {
    expect(closeBehavior({ quitting: false, trayAvailable: true, closeToTray: true })).toBe('hide-to-tray');
    expect(closeBehavior({ quitting: true, trayAvailable: true, closeToTray: true })).toBe('quit');
    expect(closeBehavior({ quitting: false, trayAvailable: false, closeToTray: true })).toBe('quit');
    expect(closeBehavior({ quitting: false, trayAvailable: true, closeToTray: false })).toBe('quit');
  });

  it('keeps Linux/Windows alive only with tray + close-to-tray; otherwise quits', () => {
    expect(windowsClosedBehavior({ platform: 'linux', trayAvailable: true, closeToTray: true })).toBe('keep-running');
    expect(windowsClosedBehavior({ platform: 'linux', trayAvailable: false, closeToTray: true })).toBe('quit');
    expect(windowsClosedBehavior({ platform: 'win32', trayAvailable: true, closeToTray: false })).toBe('quit');
    expect(windowsClosedBehavior({ platform: 'darwin', trayAvailable: false, closeToTray: false })).toBe('keep-running');
  });

  it('requires an accessible window when Linux has no tray', () => {
    expect(backgroundLifecycleMode({ trayAvailable: false, closeToTray: false })).toBe('window-required');
    expect(backgroundLifecycleMode({ trayAvailable: true, closeToTray: true })).toBe('hide-to-tray');
    expect(backgroundLifecycleMode({ trayAvailable: true, closeToTray: false })).toBe('quit-on-close');
  });

  it('exposes a discoverable Open / Pause / Quit tray menu and Quit stops owned runtimes', () => {
    const clicks: string[] = [];
    const template = buildTrayMenuTemplate({
      showWindow: () => clicks.push('open'),
      pauseSync: () => clicks.push('pause'),
      syncRunning: () => true,
      quit: () => clicks.push('quit'),
    });
    expect(template.map((item) => ('label' in item ? item.label : item.type))).toEqual([
      'Open HQ',
      'Pause sync',
      'separator',
      'Quit HQ',
    ]);
    expect(template[1]).toMatchObject({ enabled: true });
    expect(trayIconPath('/opt/hq-desktop-os')).toBe('/opt/hq-desktop-os/build/icon.png');
    expect(quitStopsOwnedRuntimes()).toBe(true);

    let stopped = false;
    let quitCalled = false;
    const gate = new ShutdownGate(async () => { stopped = true; }, () => { quitCalled = true; });
    const event = { preventDefault() { /* owned cleanup must run first */ } };
    gate.handle(event);
    expect(gate.started).toBe(true);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(stopped).toBe(true);
        expect(quitCalled).toBe(true);
        resolve();
      }, 0);
    });
  });
});

describe('opt-in start at login', () => {
  it('defaults off and restores only explicit boolean choices', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-preferences-'));
    try {
      const store = new PreferenceStore(directory);
      await store.load();
      expect(store.state).toEqual({ closeToTray: false, launchAtLogin: false });
      await store.save({ closeToTray: true, launchAtLogin: true });
      const restored = new PreferenceStore(directory);
      await restored.load();
      expect(restored.state).toEqual({ closeToTray: true, launchAtLogin: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('quotes desktop Exec paths and refuses injection', () => {
    expect(autostartEntry('/opt/My HQ/bin')).toContain('Exec="/opt/My HQ/bin"');
    expect(autostartEntry('/opt/HQ%F')).toContain('HQ%%F');
    for (const path of ['hq', '/opt/HQ\nExec=other', '/opt/HQ\0other']) {
      expect(() => autostartEntry(path)).toThrow();
    }
    expect(startupExecutable('/tmp/.mount_HQ/AppRun', {
      APPDIR: '/tmp/.mount_HQ',
      APPIMAGE: '/home/example/HQ.AppImage',
    })).toBe('/home/example/HQ.AppImage');
  });

  it('writes and clears only its own XDG entry idempotently without touching others', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-autostart-'));
    try {
      await setLinuxAutostart(directory, '/opt/HQ', true);
      await setLinuxAutostart(directory, '/opt/HQ', true);
      const own = join(directory, '.config/autostart/hq-desktop-os.desktop');
      const other = join(directory, '.config/autostart/other.desktop');
      await writeFile(other, 'another app');
      const first = await readFile(own, 'utf8');
      expect(first).toContain('Name=HQ');
      expect(first).toContain('Exec="/opt/HQ"');
      await setLinuxAutostart(directory, '/opt/HQ', true);
      expect(await readFile(own, 'utf8')).toBe(first);
      await setLinuxAutostart(directory, '/opt/HQ', false);
      await setLinuxAutostart(directory, '/opt/HQ', false);
      await expect(readFile(own)).rejects.toThrow();
      expect(await readFile(other, 'utf8')).toBe('another app');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses unpackaged and WSL enablement while still allowing disable', async () => {
    expect(isWslEnvironment({ WSL_DISTRO_NAME: 'Ubuntu' }, { platform: 'linux' })).toBe(true);
    expect(isWslEnvironment({}, { platform: 'linux', osRelease: 'Linux version 5.15.0-microsoft-standard-WSL2' })).toBe(true);
    expect(isWslEnvironment({}, { platform: 'linux', osRelease: 'Linux version 6.8.0' })).toBe(false);
    expect(isWslEnvironment({ WSL_DISTRO_NAME: 'Ubuntu' }, { platform: 'win32' })).toBe(false);

    expect(launchAtLoginSupported({ packaged: false, platform: 'linux' }).supported).toBe(false);
    expect(launchAtLoginSupported({
      packaged: true,
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
    }).supported).toBe(false);

    const calls: Array<{ openAtLogin: boolean; path: string }> = [];
    await expect(applyLaunchAtLogin({
      enabled: true,
      packaged: true,
      platform: 'linux',
      home: '/tmp',
      execPath: '/opt/HQ',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      setLoginItemSettings: (settings) => calls.push(settings),
    })).rejects.toThrow(/WSL/i);
    expect(calls).toEqual([]);

    const directory = await mkdtemp(join(tmpdir(), 'hq-wsl-autostart-'));
    try {
      await setLinuxAutostart(directory, '/opt/HQ', true);
      await applyLaunchAtLogin({
        enabled: false,
        packaged: true,
        platform: 'linux',
        home: directory,
        execPath: '/opt/HQ',
        env: { WSL_DISTRO_NAME: 'Ubuntu' },
        setLoginItemSettings: (settings) => calls.push(settings),
      });
      await expect(readFile(join(directory, '.config/autostart/hq-desktop-os.desktop'))).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses platform login-item settings on non-Linux hosts', async () => {
    const calls: Array<{ openAtLogin: boolean; path: string }> = [];
    await applyLaunchAtLogin({
      enabled: true,
      packaged: true,
      platform: 'darwin',
      home: '/Users/example',
      execPath: '/Applications/HQ.app/Contents/MacOS/HQ',
      env: {},
      setLoginItemSettings: (settings) => calls.push(settings),
    });
    expect(calls).toEqual([{
      openAtLogin: true,
      path: '/Applications/HQ.app/Contents/MacOS/HQ',
    }]);
  });
});
