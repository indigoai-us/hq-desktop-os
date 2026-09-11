import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { readFileSync } from 'node:fs';

/** Resolve the durable executable used for start-at-login (AppImage-aware). */
export function startupExecutable(executable: string, environment: { APPIMAGE?: string; APPDIR?: string }): string {
  if (!environment.APPDIR || !isAbsolute(environment.APPDIR)) return executable;
  const within = relative(environment.APPDIR, executable);
  if (within.startsWith('..') || isAbsolute(within)) return executable;
  if (!environment.APPIMAGE || !isAbsolute(environment.APPIMAGE)) {
    throw new Error('Install HQ in a permanent location before turning on automatic startup.');
  }
  return environment.APPIMAGE;
}

/** XDG desktop entry body for a single absolute Exec path. */
export function autostartEntry(executable: string): string {
  if (!executable.startsWith('/') || /[\r\n\0]/.test(executable)) {
    throw new Error('HQ’s install location could not be used for automatic startup.');
  }
  const quoted = executable.replace(/[%]/g, '%%').replace(/[\\"`$]/g, '\\$&');
  return `[Desktop Entry]\nType=Application\nName=HQ\nExec="${quoted}"\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
}

/**
 * Detect WSL so start-at-login stays visible and bounded (no invisible failed loops).
 * Full WSL host acceptance remains deferred with US-014.
 */
export function isWslEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: { platform?: NodeJS.Platform; osRelease?: string } = {},
): boolean {
  if ((options.platform ?? process.platform) !== 'linux') return false;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP || env.WSLENV) return true;
  const release = options.osRelease ?? readOsRelease();
  return /microsoft|wsl/i.test(release);
}

function readOsRelease(): string {
  try {
    return readFileSync('/proc/version', 'utf8');
  } catch {
    return '';
  }
}

export function launchAtLoginSupported(input: {
  packaged: boolean;
  platform: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  osRelease?: string;
}): { supported: boolean; detail: string } {
  if (!input.packaged) {
    return { supported: false, detail: 'Install HQ before turning on automatic startup.' };
  }
  if (isWslEnvironment(input.env ?? process.env, { platform: input.platform, osRelease: input.osRelease })) {
    return {
      supported: false,
      detail: 'Automatic startup is not available inside WSL. Open HQ from Windows after you sign in, or start it yourself when you need it.',
    };
  }
  return { supported: true, detail: 'Start HQ when you sign in to this computer.' };
}

/** Write or remove the per-user Linux XDG autostart entry (idempotent; no admin). */
export async function setLinuxAutostart(home: string, executable: string, enabled: boolean): Promise<void> {
  const file = join(home, '.config/autostart/hq-desktop-os.desktop');
  if (!enabled) {
    await rm(file, { force: true });
    return;
  }
  const entry = autostartEntry(executable);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, entry, { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}

export interface ApplyLaunchAtLoginInput {
  enabled: boolean;
  packaged: boolean;
  platform: NodeJS.Platform;
  home: string;
  execPath: string;
  env: { APPIMAGE?: string; APPDIR?: string } & NodeJS.ProcessEnv;
  osRelease?: string;
  setLoginItemSettings: (settings: { openAtLogin: boolean; path: string }) => void;
}

/**
 * Opt-in start-at-login via per-user platform facilities.
 * Enabling is refused when unsupported; disabling always clears owned entries.
 */
export async function applyLaunchAtLogin(input: ApplyLaunchAtLoginInput): Promise<void> {
  const gate = launchAtLoginSupported({
    packaged: input.packaged,
    platform: input.platform,
    env: input.env,
    osRelease: input.osRelease,
  });
  if (input.enabled && !gate.supported) throw new Error(gate.detail);

  if (input.platform === 'linux') {
    const executable = startupExecutable(input.execPath, {
      APPIMAGE: input.env.APPIMAGE,
      APPDIR: input.env.APPDIR,
    });
    await setLinuxAutostart(input.home, executable, input.enabled);
    return;
  }

  input.setLoginItemSettings({ openAtLogin: input.enabled, path: input.execPath });
}
