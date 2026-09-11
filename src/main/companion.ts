import { app, dialog, safeStorage, shell } from 'electron';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchTool, windowsTerminalPath } from './launch-tool.js';
import { parseCompanionAction, type CompanionSnapshot } from '../shared/companion.js';
import { WorkspaceRegistry } from './workspaces.js';

export class CompanionService {
  readonly registry = new WorkspaceRegistry(app.getPath('userData'));
  private pending = false;
  async initialize(): Promise<void> { await this.registry.load(); }
  async snapshot(): Promise<CompanionSnapshot> {
    const state = this.registry.snapshot;
    const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform;
    const credentialsAvailable = safeStorage.isEncryptionAvailable() && backend !== 'basic_text';
    let runtimeAvailable = true;
    try { await access(require.resolve('@indigoai-us/hq-cloud/package.json')); }
    catch (error) { runtimeAvailable = false; console.error('Bundled HQ runtime unavailable:', error instanceof Error ? error.message : 'resolution failed'); }
    return {
      version: app.getVersion(), platform: process.platform, installationId: state.installationId,
      workspaces: state.workspaces, activeWorkspaceId: state.activeWorkspaceId,
      account: { status: 'signed-out', label: null },
      sync: { phase: 'not-connected', lastSuccess: null, message: 'Account connection and shared-runner integration require native acceptance before sync can be enabled.', conflicts: 0 },
      runtime: { version: '6.16.35', available: runtimeAvailable, node: process.versions.node },
      credentials: { available: credentialsAvailable, backend },
      preferences: { closeToTray: false, launchAtLogin: false },
      diagnostics: [
        { name: 'Workspace registry', state: 'ok', detail: `${state.workspaces.length} registered workspace${state.workspaces.length === 1 ? '' : 's'}` },
        { name: 'Bundled runtime', state: runtimeAvailable ? 'ok' : 'attention', detail: `HQ Cloud 6.16.35 · Node ${process.versions.node}` },
        { name: 'Credential storage', state: credentialsAvailable ? 'ok' : 'attention', detail: credentialsAvailable ? 'OS encrypted storage is available.' : 'OS encrypted storage is unavailable. Sign-in stays disabled.' },
        { name: 'Account', state: 'unavailable', detail: 'Native browser sign-in integration is pending.' },
        { name: 'Sync', state: 'unavailable', detail: 'No managed sync process. Existing CLI sync processes are not controlled by this app.' },
        { name: 'Updates', state: 'unavailable', detail: 'Local test build. Automatic updates and release signing are not configured.' },
        { name: 'Client health', state: 'unavailable', detail: 'Local checks only. Server attribution and support commands are not enabled.' },
      ],
    };
  }
  async request(raw: unknown): Promise<CompanionSnapshot> {
    const request = parseCompanionAction(raw);
    if (!request) throw new Error('Invalid desktop request.');
    if (request.action === 'snapshot') return this.snapshot();
    if (this.pending) throw new Error('Another desktop operation is still running.');
    this.pending = true;
    try {
      switch (request.action) {
        case 'attach-workspace': {
          const selection = await dialog.showOpenDialog({ title: 'Choose your existing HQ workspace', properties: ['openDirectory'] });
          if (!selection.canceled && selection.filePaths[0]) await this.registry.attach(selection.filePaths[0]);
          break;
        }
        case 'select-workspace': await this.registry.select(request.workspaceId!); break;
        case 'remove-workspace': await this.registry.remove(request.workspaceId!); break;
        case 'open-folder': {
          const error = await shell.openPath(await this.registry.verifiedRoot(request.workspaceId!));
          if (error) throw new Error(error);
          break;
        }
        case 'open-editor': {
          const cwd = await this.registry.verifiedRoot(request.workspaceId!);
          if (process.platform === 'win32') {
            const candidates = [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code/Code.exe'), process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft VS Code/Code.exe')].filter((path): path is string => !!path);
            let executable: string | undefined;
            for (const candidate of candidates) {
              try { await access(candidate); executable = candidate; break; }
              catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            }
            if (!executable) throw new Error('VS Code was not found in its standard install locations.');
            await launchTool(executable, ['--new-window', cwd], cwd);
          } else await launchTool('code', ['--new-window', cwd], cwd);
          break;
        }
        case 'open-terminal': {
          const cwd = await this.registry.verifiedRoot(request.workspaceId!);
          if (process.platform === 'win32') {
            const executable = windowsTerminalPath(process.env.LOCALAPPDATA);
            await access(executable);
            await launchTool(executable, ['-d', cwd], cwd);
          } else await launchTool('x-terminal-emulator', [], cwd);
          break;
        }
        case 'export-diagnostics': {
          const report = await this.diagnosticsReport();
          const result = await dialog.showSaveDialog({ title: 'Export redacted diagnostics', defaultPath: 'hq-desktop-diagnostics.json', filters: [{ name: 'JSON report', extensions: ['json'] }] });
          if (!result.canceled && result.filePath) await writeFile(result.filePath, report, { mode: 0o600 });
          break;
        }
        case 'diagnostics': break;
        case 'sign-out': break; // This build has no account credentials to clear.
      }
      return await this.snapshot();
    } finally { this.pending = false; }
  }
  async diagnosticsReport(): Promise<string> {
    const state = await this.snapshot();
    // Explicit allowlist; paths, installation ID, account identity, env, and raw errors stay local.
    return JSON.stringify({ generatedAt: new Date().toISOString(), app: 'hq-desktop-os', version: state.version, platform: state.platform, workspaceCount: state.workspaces.length, runtime: state.runtime, checks: state.diagnostics }, null, 2);
  }
}
