import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { autostartEntry, startupExecutable, PreferenceStore, setLinuxAutostart } from '../../src/main/preferences';
import { parseCompanionAction } from '../../src/shared/companion';
describe('opt-in background preferences', () => {
  it('starts disabled and restores only explicit saved choices', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-preferences-'));
    try {
      const store = new PreferenceStore(directory); await store.load(); expect(store.state).toEqual({ closeToTray: false, launchAtLogin: false });
      await store.save({ closeToTray: true, launchAtLogin: false }); const restored = new PreferenceStore(directory); await restored.load();
      expect(restored.state).toEqual({ closeToTray: true, launchAtLogin: false });
      await writeFile(join(directory, 'preferences.json'), '{"closeToTray":"true"}'); await expect(restored.load()).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('quotes desktop paths and refuses extra lines or relative commands', () => {
    expect(autostartEntry('/opt/My HQ/bin')).toContain('Exec="/opt/My HQ/bin"');
    expect(autostartEntry('/opt/HQ%F')).toContain('HQ%%F');
    for (const path of ['hq', '/opt/HQ\nExec=other', '/opt/HQ\0other']) expect(() => autostartEntry(path)).toThrow();
    expect(parseCompanionAction({ action: 'set-preference', preference: 'exec', enabled: true })).toBeNull();
    expect(parseCompanionAction({ action: 'set-preference', preference: 'closeToTray', enabled: 'true' })).toBeNull();
  });
  it('uses the durable AppImage path only when running inside its mount', () => {
    expect(startupExecutable('/tmp/.mount_HQ/AppRun', { APPDIR: '/tmp/.mount_HQ', APPIMAGE: '/home/example/HQ.AppImage' })).toBe('/home/example/HQ.AppImage');
    expect(startupExecutable('/opt/HQ/hq-desktop-os', { APPDIR: '/tmp/.mount_Parent', APPIMAGE: '/home/example/Parent.AppImage' })).toBe('/opt/HQ/hq-desktop-os');
  });
  it('removes only its own startup entry when disabled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-autostart-'));
    try {
      await setLinuxAutostart(directory, '/opt/HQ', true);
      const own = join(directory, '.config/autostart/hq-desktop-os.desktop'); const other = join(directory, '.config/autostart/other.desktop'); await writeFile(other, 'another app');
      expect(await readFile(own, 'utf8')).toContain('Name=HQ');
      await setLinuxAutostart(directory, '/opt/HQ', false);
      await expect(readFile(own)).rejects.toThrow(); expect(await readFile(other, 'utf8')).toBe('another app');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
