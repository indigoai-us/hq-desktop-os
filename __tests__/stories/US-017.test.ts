import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  backgroundLifecycleMode,
  closeBehavior,
  windowsClosedBehavior,
} from '../../src/main/lifecycle';
import { isWslEnvironment, launchAtLoginSupported } from '../../src/main/autostart';
import { buildTrayMenuTemplate } from '../../src/main/tray';
import { snapshotForScenario } from '../../src/renderer/dev/scenarios';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function readJson<T>(rel: string): T {
  return JSON.parse(read(rel)) as T;
}

describe('US-017 Tray lifecycle and opt-in start at login', () => {
  it('ships the PRD tray / autostart / lifecycle modules', () => {
    for (const rel of [
      'src/main/tray.ts',
      'src/main/autostart.ts',
      'src/main/lifecycle.ts',
      'tests/native/background.test.ts',
    ]) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }

    const tray = read('src/main/tray.ts');
    expect(tray).toContain('TrayController');
    expect(tray).toContain('buildTrayMenuTemplate');
    expect(tray).toContain('Quit HQ');

    const autostart = read('src/main/autostart.ts');
    expect(autostart).toContain('applyLaunchAtLogin');
    expect(autostart).toContain('setLinuxAutostart');
    expect(autostart).toContain('isWslEnvironment');
    expect(autostart).toContain('launchAtLoginSupported');

    const lifecycle = read('src/main/lifecycle.ts');
    expect(lifecycle).toContain('closeBehavior');
    expect(lifecycle).toContain('windowsClosedBehavior');
    expect(lifecycle).toContain('window-required');
  });

  it('keeps sync discoverable via tray while Quit stops owned runtimes', () => {
    expect(closeBehavior({ quitting: false, trayAvailable: true, closeToTray: true })).toBe('hide-to-tray');
    expect(closeBehavior({ quitting: true, trayAvailable: true, closeToTray: true })).toBe('quit');
    expect(windowsClosedBehavior({ platform: 'linux', trayAvailable: true, closeToTray: true })).toBe('keep-running');

    const labels = buildTrayMenuTemplate({
      showWindow: () => undefined,
      pauseSync: () => undefined,
      syncRunning: () => true,
      quit: () => undefined,
    }).map((item) => ('label' in item ? item.label : item.type));
    expect(labels).toContain('Open HQ');
    expect(labels).toContain('Quit HQ');

    const index = read('src/main/index.ts');
    expect(index).toContain('ShutdownGate');
    expect(index).toContain('TrayController');
    expect(index).toContain('closeBehavior');
    expect(index).toContain('quit: () => app.quit()');
  });

  it('makes start-at-login opt-in, idempotent, and bounded for WSL', () => {
    expect(launchAtLoginSupported({
      packaged: true,
      platform: 'linux',
      env: {},
      osRelease: 'Linux version 6.8.0',
    }).supported).toBe(true);
    expect(launchAtLoginSupported({ packaged: false, platform: 'linux', env: {}, osRelease: 'Linux version 6.8.0' }).supported).toBe(false);
    expect(isWslEnvironment({ WSL_DISTRO_NAME: 'Ubuntu' }, { platform: 'linux' })).toBe(true);
    expect(launchAtLoginSupported({
      packaged: true,
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
    }).supported).toBe(false);

    const companion = read('src/main/companion.ts');
    expect(companion).toContain('applyLaunchAtLogin');
    expect(companion).not.toMatch(/setLinuxAutostart\(app\.getPath/);

    const settings = read('src/renderer/screens/settings.tsx');
    expect(settings).toContain('launchAtLoginSupported');
    expect(settings).toContain('trayAvailable');
    expect(settings).toContain('no admin privileges');
  });

  it('retains window-required lifecycle when Linux has no tray', () => {
    expect(backgroundLifecycleMode({ trayAvailable: false, closeToTray: true })).toBe('window-required');
    const noTray = snapshotForScenario('no-tray');
    expect(noTray.trayAvailable).toBe(false);
    expect(noTray.preferences.closeToTray).toBe(false);
    const wsl = snapshotForScenario('wsl-startup');
    expect(wsl.launchAtLoginSupported).toBe(false);

    const settings = read('src/renderer/screens/settings.tsx');
    expect(settings).toContain('Keep this window open to continue syncing');
  });

  it('records Linux background coverage and defers Windows/WSL native acceptance', () => {
    const manifest = readJson<{
      platformEvidence: {
        linux: { background?: string; notes?: string };
        windows: { background?: string };
        wsl2: { background?: string };
      };
    }>('runtime/manifest.json');
    expect(manifest.platformEvidence.linux.background).toBe('covered');
    expect(manifest.platformEvidence.windows.background).toBe('deferred');
    expect(manifest.platformEvidence.wsl2.background).toBe('deferred');
    expect(manifest.platformEvidence.linux.notes).toMatch(/US-017/);

    const docs = read('docs/platform-boundary.md');
    expect(docs).toContain('Tray lifecycle and opt-in start at login (US-017 Linux slice)');
    expect(docs).toContain('window-required');
    expect(docs).toContain('Linux XDG');
  });
});
