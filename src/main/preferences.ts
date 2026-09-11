import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, isAbsolute, relative } from 'node:path';
export interface Preferences { closeToTray: boolean; launchAtLogin: boolean }
export class PreferenceStore {
  state: Preferences = { closeToTray: false, launchAtLogin: false };
  constructor(private readonly directory: string) {}
  async load(): Promise<void> {
    try {
      const value = JSON.parse(await readFile(join(this.directory, 'preferences.json'), 'utf8')) as Preferences;
      if (typeof value.closeToTray !== 'boolean' || typeof value.launchAtLogin !== 'boolean') throw new Error('Your preferences could not be read.');
      this.state = { closeToTray: value.closeToTray, launchAtLogin: value.launchAtLogin };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  async save(next: Preferences): Promise<void> {
    const file = join(this.directory, 'preferences.json'); await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 }); await rename(`${file}.tmp`, file); this.state = next;
  }
}
export function startupExecutable(executable: string, environment: { APPIMAGE?: string; APPDIR?: string }): string {
  if (!environment.APPDIR || !isAbsolute(environment.APPDIR)) return executable;
  const within = relative(environment.APPDIR, executable);
  if (within.startsWith('..') || isAbsolute(within)) return executable;
  if (!environment.APPIMAGE || !isAbsolute(environment.APPIMAGE)) throw new Error('Install HQ in a permanent location before turning on automatic startup.');
  return environment.APPIMAGE;
}
export function autostartEntry(executable: string): string {
  if (!executable.startsWith('/') || /[\r\n\0]/.test(executable)) throw new Error('HQ’s install location could not be used for automatic startup.');
  const quoted = executable.replace(/[%]/g, '%%').replace(/[\\"`$]/g, '\\$&');
  return `[Desktop Entry]\nType=Application\nName=HQ\nExec="${quoted}"\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
}
export async function setLinuxAutostart(home: string, executable: string, enabled: boolean): Promise<void> {
  const file = join(home, '.config/autostart/hq-desktop-os.desktop');
  if (!enabled) { await rm(file, { force: true }); return; }
  const entry = autostartEntry(executable); await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, entry, { mode: 0o600 }); await rename(`${file}.tmp`, file);
}
