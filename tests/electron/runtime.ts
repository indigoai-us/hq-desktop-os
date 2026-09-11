import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const execFileAsync = promisify(execFile);

export const repoRoot = join(__dirname, '..', '..');
export const stageDir = join(repoRoot, 'dist-runtime');
export const productBinary = process.platform === 'win32' ? 'hq-desktop-os.exe' : 'hq-desktop-os';

/**
 * The staged runtime is a real production Electron app: the executable is not
 * named `electron`, so `app.isPackaged` is true and the app runs its production
 * branches. Tests never override webPreferences or launch flags to pass.
 */
export function productionRuntimePath(): string {
  const binary = join(stageDir, productBinary);
  if (!existsSync(binary)) {
    throw new Error(`Production runtime is missing. Run "pnpm build && pnpm stage:runtime" first (${binary}).`);
  }
  return binary;
}

export function productionRendererPath(): string {
  return join(stageDir, 'resources', 'app', 'dist', 'renderer', 'index.html');
}

export function productionPreloadPath(): string {
  return join(stageDir, 'resources', 'app', 'dist', 'preload', 'index.js');
}

export async function launchProductionApp(): Promise<{ app: ElectronApplication; window: Page }> {
  const profile = await mkdtemp(join(tmpdir(), 'hq-native-profile-'));
  const app = await electron.launch({
    executablePath: productionRuntimePath(),
    args: [`--user-data-dir=${profile}`],
    timeout: 120_000,
  });
  app.once('close', () => { void rm(profile, { recursive: true, force: true }).catch(error => console.error('Native test profile cleanup failed', error instanceof Error ? error.name : 'unknown')); });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('.companion-shell');
  return { app, window };
}

/** Process ids currently running the staged production executable. */
export async function runningRuntimePids(): Promise<number[]> {
  const binary = productionRuntimePath();
  if (process.platform === 'win32') {
    const script = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${binary.replaceAll("'", "''")}' } | ForEach-Object { $_.ProcessId }`;
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    return parsePids(stdout);
  }
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,args=']);
  return stdout
    .split('\n')
    .filter((line) => line.includes(binary))
    .map((line) => Number.parseInt(line.trim().split(/\s+/)[0] ?? '', 10))
    .filter((pid) => Number.isInteger(pid));
}

function parsePids(stdout: string): number[] {
  return stdout
    .split('\n')
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid));
}

/** Terminate only processes that belong to the staged runtime under test. */
export async function terminateRuntimePids(pids: readonly number[]): Promise<void> {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already exited.
    }
  }
}

/** The security preferences the window is actually running with. */
export interface EffectiveWebPreferences {
  readonly sandbox: boolean;
  readonly contextIsolation: boolean;
  readonly nodeIntegration: boolean;
  readonly nodeIntegrationInSubFrames: boolean;
  readonly webSecurity: boolean;
  readonly allowRunningInsecureContent: boolean;
  readonly webviewTag: boolean;
}

/**
 * `webContents.getLastWebPreferences()` is documented but absent from the
 * Electron 40 typings, so it is reached through one narrow cast here rather
 * than in every spec.
 */
export async function readWebPreferences(
  app: ElectronApplication,
): Promise<EffectiveWebPreferences> {
  return app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]!.webContents as unknown as {
      getLastWebPreferences(): Record<string, unknown> | null;
    };
    const prefs = contents.getLastWebPreferences();
    if (!prefs) throw new Error('The window reported no web preferences');
    return prefs as unknown as EffectiveWebPreferences;
  });
}
