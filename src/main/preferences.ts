import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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

/** Re-exports kept for older unit imports; prefer `./autostart.js`. */
export {
  autostartEntry,
  setLinuxAutostart,
  startupExecutable,
} from './autostart.js';
