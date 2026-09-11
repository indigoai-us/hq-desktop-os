import { spawn } from 'node:child_process';
import { win32 } from 'node:path';
export function windowsTerminalPath(localAppData: string | undefined): string {
  if (!localAppData || !win32.isAbsolute(localAppData)) throw new Error('Windows Terminal install location is unavailable.');
  return win32.join(localAppData, 'Microsoft', 'WindowsApps', 'wt.exe');
}
/** External user tools outlive the app. Resolve on OS spawn, never kill a terminal after a timeout. */
export function launchTool(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: true, stdio: 'ignore', shell: false, windowsHide: false });
    const timer = setTimeout(() => { reject(new Error('The tool did not start within 10 seconds.')); }, 10_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('spawn', () => { clearTimeout(timer); child.unref(); resolve(); });
  });
}
