import { createHash } from 'node:crypto';
import { app, dialog, safeStorage, shell } from 'electron';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createWorkspace, initialSetup, HQ_TEMPLATE, verifiedDownload, SetupJournal, type SetupState } from './setup.js';
import { prepareDependencies, runSetupCommand, findExecutable, toolchainPath } from './setup-dependencies.js';
import { launchTool, windowsTerminalPath } from './launch-tool.js';
import { parseCompanionAction, type CompanionSnapshot, type ConflictChoice } from '../shared/companion.js';
import { AccountSession } from './auth.js';
import { SecureTokenStore, secureStorageAvailable } from './secure-tokens.js';
import { PreferenceStore, setLinuxAutostart, startupExecutable } from './preferences.js';
import { SyncSelectionStore } from './sync-selection.js';
import { SyncSupervisor } from './sync-supervisor.js';
import { loadScopes, ensurePersonalStorage, WorkspaceAccounts, type SyncScope } from './sync-scopes.js';
import { WorkspaceRegistry } from './workspaces.js';

export class CompanionService {
  readonly registry = new WorkspaceRegistry(app.getPath('userData'));
  private pending = false;
  trayAvailable = false;
  readonly preferences = new PreferenceStore(app.getPath('userData'));
  readonly account = new AccountSession(new SecureTokenStore(app.getPath('userData')));
  readonly sync = new SyncSupervisor(this.account);
  private scopes: SyncScope[] = [];
  private selectedScope?: string;
  /** One-shot resolve strategy; startSync resets to abort after launching. */
  private conflictStrategy: ConflictChoice = 'abort';
  private closing = false;
  private restoreCanceled = false;
  private restoreJob?: Promise<void>;
  private readonly selection = new SyncSelectionStore(app.getPath('userData'));
  private async saveSyncChoice(enabled: boolean): Promise<void> {
    const id = this.registry.snapshot.activeWorkspaceId;
    const sub = this.account.identity?.sub;
    if (id && sub && this.selectedScope) await this.selection.save({ root: enabled ? await this.registry.verifiedRoot(id) : this.registry.get(id).root, sub, scope: this.selectedScope, enabled });
  }
  async pauseSync(): Promise<void> {
    this.restoreCanceled = true;
    await this.restoreJob;
    await this.sync.pause();
    await this.saveSyncChoice(false);
  }
  private async restoreSync(): Promise<void> {
    const id = this.registry.snapshot.activeWorkspaceId;
    const sub = this.account.identity?.sub;
    if (!id || !sub || this.closing) return;
    const saved = await this.selection.read(await this.registry.verifiedRoot(id), sub);
    if (!saved || this.closing) return;
    await this.refreshScopes();
    if (!this.scopes.some(scope => scope.id === saved.scope)) return;
    this.selectedScope = saved.scope;
    if (saved.enabled && !this.closing && !this.restoreCanceled) await this.startSync(true);
  }
  private readonly workspaceAccounts = new WorkspaceAccounts(app.getPath('userData'));
  private async refreshScopes(): Promise<void> { this.scopes = await loadScopes(this.account); if (!this.scopes.some(scope => scope.id === this.selectedScope)) this.selectedScope = undefined; }
  private async startSync(restoring = false): Promise<void> {
    if (this.closing) throw new Error('HQ is closing.');
    if (this.loginAbort) throw new Error('Finish signing in before starting sync.');
    if (this.sync.running) throw new Error('Sync is already running. Pause it before starting again.');
    const id = this.registry.snapshot.activeWorkspaceId;
    if (!id) throw new Error('Choose a workspace first.');
    await this.refreshScopes();
    if (!this.selectedScope) throw new Error('Choose which work to keep on this computer.');
    const root = await this.registry.verifiedRoot(id);
    if (!this.account.identity) throw new Error('Sign in to continue.');
    await this.workspaceAccounts.bind(root, this.account.identity.sub);
    await ensurePersonalStorage(this.account);
    const env: NodeJS.ProcessEnv = { HOME: app.getPath('home'), USERPROFILE: app.getPath('home'), PATH: toolchainPath(join(app.getPath('userData'), 'toolchain')), HQ_VAULT_API_URL: 'https://hqapi.hq.computer' };
    const scopeKey = createHash('sha256').update(JSON.stringify([root, this.account.identity!.sub])).digest('hex');
    env.HQ_STATE_DIR = join(app.getPath('userData'), 'sync-state', scopeKey);
    env.HQ_DESKTOP_SHARED_STATE_DIR = process.env.HQ_STATE_DIR || join(app.getPath('home'), '.hq');
    // The child holds a separate shared-location exclusive gate while using private journals.
    if (process.platform === 'win32') { env.SystemRoot = process.env.SystemRoot; env.TEMP = app.getPath('temp'); }
    if (this.closing || (restoring && this.restoreCanceled)) return;
    const onConflict = this.conflictStrategy;
    this.conflictStrategy = 'abort';
    this.sync.start(root, this.selectedScope, env, onConflict);
    try { await this.saveSyncChoice(true); }
    catch (error) { await this.sync.stop(); throw error; }
  }
  private async resolveConflicts(choice: ConflictChoice, paths?: string[]): Promise<void> {
    const listed = this.sync.state.conflictPaths;
    const targets = paths?.length ? paths : listed;
    if (!targets.length) throw new Error('There are no conflicting files to resolve right now.');
    if (paths?.length && paths.some((path) => !listed.includes(path))) throw new Error('Choose conflicting files from the current list.');
    if (choice === 'abort') {
      await this.pauseSync();
      this.sync.state = {
        ...this.sync.state,
        phase: 'paused',
        message: 'Sync is paused',
        conflicts: listed.length,
        conflictPaths: listed,
      };
      return;
    }
    // Engine applies one --on-conflict strategy per pass; restart with the
    // user's explicit choice, then return to abort so overwrite is never sticky.
    this.conflictStrategy = choice;
    if (this.sync.running) await this.sync.stop();
    await this.startSync();
  }
  private loginAbort?: AbortController;
  private loginJob?: Promise<void>;
  private accountError?: string;
  private startSignIn(): void {
    if (this.loginAbort) throw new Error('A sign-in window is already open.');
    if (!secureStorageAvailable()) throw new Error('Unlock your computer’s secure password storage, then try signing in again.');
    this.accountError = undefined; this.loginAbort = new AbortController();
    this.loginJob = this.account.signIn(url => shell.openExternal(url), this.loginAbort.signal).catch((error: unknown) => {
      console.error('Account sign-in did not finish', error instanceof Error ? error.name : 'unknown');
      this.accountError = error instanceof Error && error.name === 'Error' && !(error as NodeJS.ErrnoException).code ? error.message : 'Your account could not be connected. Check your connection and try again.';
    }).finally(() => { this.loginAbort = undefined; });
  }
  private setup?: SetupState;
  private setupAbort?: AbortController;
  private readonly journal = new SetupJournal(join(app.getPath('userData'), 'setup.json'));
  private setupJob?: Promise<void>;
  async shutdown(): Promise<void> { this.closing = true; this.setupAbort?.abort(); this.loginAbort?.abort(); await this.restoreJob; await Promise.all([this.setupJob, this.loginJob, this.sync.stop()]); }
  private beginSetup(root: string): void {
    if (this.setupAbort) throw new Error('Setup is already running.');
    this.setup ??= initialSetup(root);
    this.setup.error = null;
    this.setupAbort = new AbortController();
    const signal = this.setupAbort.signal;
    this.setupJob = this.performSetup(signal).catch(async (error: unknown) => {
      console.error('HQ setup failed', error instanceof Error ? error.name : 'unknown');
      this.setup!.error = error instanceof Error && !(error as NodeJS.ErrnoException).code && error.name === 'Error' ? error.message : 'Setup did not finish. Check that this folder is writable and your connection is working, then try again.';
      const step = this.setup!.steps.find(step => step.status === 'working');
      if (step) step.status = 'error';
      try { await this.journal.save(this.setup!); } catch (writeError) { console.error('Setup recovery state could not be saved', writeError instanceof Error ? writeError.name : 'unknown'); }
    }).finally(() => { this.setupAbort = undefined; });
  }
  private async performSetup(signal: AbortSignal): Promise<void> {
    const setup = this.setup!;
    const save = () => this.journal.save(setup);
    for (const step of setup.steps) {
      if (step.status === 'ready') continue;
      if (signal.aborted) throw new Error('Setup was canceled. You can continue when you’re ready.');
      step.status = 'working'; await save();
      if (step.id === 'content') setup.root = await createWorkspace(dirname(setup.root), () => verifiedDownload(HQ_TEMPLATE.url, HQ_TEMPLATE.sha256, undefined, signal), setup.id);
      if (step.id === 'dependencies') await prepareDependencies(join(app.getPath('userData'), 'toolchain'), signal, label => { step.label = label; });
      if (step.id === 'personalize') {
        const toolchain = join(app.getPath('userData'), 'toolchain');
        const path = toolchainPath(toolchain, '/usr/local/bin:/usr/bin:/bin');
        const settings = join(setup.root, '.claude/settings.json');
        const data = JSON.parse(await readFile(settings, 'utf8')) as { env?: Record<string, string> };
        data.env = { ...data.env, PATH: path }; await writeFile(settings, JSON.stringify(data, null, 2));
        const git = await findExecutable('git', '/usr/local/bin:/usr/bin:/bin');
        if (!git) throw new Error('Git is no longer available. Reinstall it from your software center and continue setup.');
        await runSetupCommand(git, ['-C', setup.root, 'init'], { cwd: setup.root, env: { PATH: path, HOME: app.getPath('home'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }, signal, timeout: 15_000 });
      }
      step.status = 'ready'; await save();
    }
    await this.registry.attach(setup.root);
    setup.complete = true; await save();
  }
  async initialize(): Promise<void> {
    await this.preferences.load();
    await this.registry.load(); this.setup = await this.journal.load();
    if (this.setup && !this.setup.complete) for (const step of this.setup.steps) if (step.status === 'working') step.status = 'error';
    this.restoreJob = this.account.restore().then(() => this.restoreSync()).catch((error: unknown) => { console.error('Saved account could not be restored', error instanceof Error ? error.name : 'unknown'); if (this.account.identity) this.sync.state = { ...this.sync.state, phase: 'error', message: 'Sync could not reconnect. Check your connection and try again.' }; else this.accountError = 'Your account could not be reconnected. Check your connection or sign in again.'; });
  }
  async snapshot(): Promise<CompanionSnapshot> {
    const state = this.registry.snapshot;
    const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform;
    const credentialsAvailable = safeStorage.isEncryptionAvailable() && backend !== 'basic_text';
    let runtimeAvailable = true;
    try { await access(require.resolve('@indigoai-us/hq-cloud/package.json')); }
    catch (error) { runtimeAvailable = false; console.error('Bundled HQ runtime unavailable:', error instanceof Error ? error.message : 'resolution failed'); }
    return {
      setup: this.setup ? structuredClone(this.setup) : undefined,
      version: app.getVersion(), platform: process.platform, installationId: state.installationId,
      workspaces: state.workspaces, activeWorkspaceId: state.activeWorkspaceId,
      account: { status: this.loginAbort ? 'signing-in' : this.account.identity ? 'connected' : 'signed-out', label: this.account.identity?.label ?? null, error: this.accountError },
      syncScopes: this.scopes, selectedSyncScope: this.selectedScope,
      sync: this.account.identity ? { ...this.sync.state } : { phase: 'not-connected', lastSuccess: null, message: 'Sign in to sync your files.', conflicts: 0, conflictPaths: [] },
      runtime: { version: '6.16.35', available: runtimeAvailable, node: process.versions.node },
      credentials: { available: credentialsAvailable, backend },
      preferences: { ...this.preferences.state },
      diagnostics: [
        { name: 'Workspace registry', state: 'ok', detail: `${state.workspaces.length} registered workspace${state.workspaces.length === 1 ? '' : 's'}` },
        { name: 'Bundled runtime', state: runtimeAvailable ? 'ok' : 'attention', detail: `HQ Cloud 6.16.35 · Node ${process.versions.node}` },
        { name: 'Credential storage', state: credentialsAvailable ? 'ok' : 'attention', detail: credentialsAvailable ? 'OS encrypted storage is available.' : 'OS encrypted storage is unavailable. Sign-in stays disabled.' },
        { name: 'Account', state: this.account.identity ? 'ok' : 'attention', detail: this.account.identity ? 'Account verified.' : 'Not signed in.' },
        { name: 'Sync', state: this.sync.running ? 'ok' : 'attention', detail: this.sync.state.message },
        { name: 'Updates', state: 'unavailable', detail: 'Local test build. Automatic updates and release signing are not configured.' },
        { name: 'Client health', state: 'unavailable', detail: 'Local checks only. Server attribution and support commands are not enabled.' },
      ],
    };
  }
  async request(raw: unknown): Promise<CompanionSnapshot> {
    const request = parseCompanionAction(raw);
    if (!request) throw new Error('Invalid desktop request.');
    if (request.action === 'snapshot') return this.snapshot();
    if (['pause-sync', 'resume-sync', 'resolve-conflicts', 'sign-in', 'sign-out', 'select-sync-scope', 'select-workspace', 'remove-workspace', 'attach-workspace', 'create-workspace'].includes(request.action)) this.restoreCanceled = true;
    await this.restoreJob;
    if (this.closing) throw new Error('HQ is closing.');
    if (this.pending) throw new Error('Another desktop operation is still running.');
    this.pending = true;
    try {
      switch (request.action) {
        case 'create-workspace': {
          if (this.setupAbort) throw new Error('Setup is already running.');
          const selection = await dialog.showOpenDialog({ title: 'Choose where your HQ folder will live', defaultPath: app.getPath('home'), properties: ['openDirectory', 'createDirectory'] });
          if (!selection.canceled && selection.filePaths[0]) { this.setup = initialSetup(join(selection.filePaths[0], 'HQ')); this.beginSetup(this.setup.root); }
          break;
        }
        case 'resume-setup': if (this.setup && !this.setup.complete) this.beginSetup(this.setup.root); break;
        case 'reset-setup': if (this.setupAbort) throw new Error('Cancel setup before choosing another folder.'); await this.journal.clear(); this.setup = undefined; break;
        case 'cancel-setup': this.setupAbort?.abort(); await this.setupJob; break;
        case 'sign-in': await this.sync.reset(); await this.saveSyncChoice(false); this.scopes = []; this.selectedScope = undefined; this.startSignIn(); break;
        case 'cancel-sign-in': this.loginAbort?.abort(); await this.loginJob; break;
        case 'load-sync-scopes': await this.refreshScopes(); break;
        case 'select-sync-scope': await this.sync.reset(); await this.refreshScopes(); if (!this.scopes.some(scope => scope.id === request.scopeId)) throw new Error('This shared workspace is no longer available.'); this.selectedScope = request.scopeId; await this.saveSyncChoice(false); break;
        case 'pause-sync': await this.pauseSync(); break;
        case 'resume-sync': await this.startSync(); break;
        case 'resolve-conflicts': await this.resolveConflicts(request.choice!, request.paths); break;
        case 'attach-workspace': {
          const selection = await dialog.showOpenDialog({ title: 'Choose your existing HQ workspace', properties: ['openDirectory'] });
          if (!selection.canceled && selection.filePaths[0]) { await this.sync.reset(); await this.saveSyncChoice(false); this.selectedScope = undefined; await this.registry.attach(selection.filePaths[0]); }
          break;
        }
        case 'select-workspace': await this.sync.reset(); await this.saveSyncChoice(false); this.selectedScope = undefined; await this.registry.select(request.workspaceId!); break;
        case 'remove-workspace': await this.sync.reset(); await this.saveSyncChoice(false); this.selectedScope = undefined; await this.registry.remove(request.workspaceId!); break;
        case 'open-folder': {
          const error = await shell.openPath(await this.registry.verifiedRoot(request.workspaceId!));
          if (error) throw new Error('Your folder could not be opened. Check that it is still on this computer.');
          break;
        }
        case 'open-terminal': {
          const cwd = await this.registry.verifiedRoot(request.workspaceId!);
          if (process.platform === 'win32') {
            const executable = windowsTerminalPath(process.env.LOCALAPPDATA);
            await access(executable);
            await launchTool(executable, ['-d', cwd], cwd);
          } else {
            const terminal = await findExecutable('x-terminal-emulator', '/usr/local/bin:/usr/bin:/bin');
            const bash = await findExecutable('bash', '/usr/bin:/bin');
            if (!terminal || !bash) throw new Error('A terminal could not be found. Install one from your software center, then try again.');
            const path = toolchainPath(join(app.getPath('userData'), 'toolchain'));
            // env runs inside the terminal, including terminals that reuse a server process.
            await launchTool(terminal, ['-e', '/usr/bin/env', `PATH=${path}`, bash, '--noprofile', '--norc', '-i'], cwd);
          }
          break;
        }
        case 'export-diagnostics': {
          const report = await this.diagnosticsReport();
          const result = await dialog.showSaveDialog({ title: 'Export redacted diagnostics', defaultPath: 'hq-desktop-diagnostics.json', filters: [{ name: 'JSON report', extensions: ['json'] }] });
          if (!result.canceled && result.filePath) await writeFile(result.filePath, report, { mode: 0o600 });
          break;
        }
        case 'diagnostics': break;
        case 'set-preference': {
          if (request.preference === 'closeToTray' && request.enabled && !this.trayAvailable) throw new Error('This desktop does not support keeping HQ in the tray. Keep the window open to continue syncing.');
          if (request.preference === 'launchAtLogin') {
            if (!app.isPackaged) throw new Error('Install HQ before turning on automatic startup.');
            if (process.platform === 'linux') await setLinuxAutostart(app.getPath('home'), startupExecutable(process.execPath, { APPIMAGE: process.env.APPIMAGE, APPDIR: process.env.APPDIR }), request.enabled!);
            else app.setLoginItemSettings({ openAtLogin: request.enabled!, path: process.execPath });
          }
          await this.preferences.save({ ...this.preferences.state, [request.preference!]: request.enabled! });
          break;
        }
        case 'sign-out': {
          await this.sync.reset(); this.loginAbort?.abort(); await this.loginJob;
          try { await this.saveSyncChoice(false); }
          finally { this.scopes = []; this.selectedScope = undefined; await this.account.signOut(); this.accountError = undefined; }
          break;
        }
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
