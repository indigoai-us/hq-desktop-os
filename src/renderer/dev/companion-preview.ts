import type { CompanionClient } from '../companion-client';
import type { CompanionSnapshot } from '../../shared/companion';
import { HEALTH_PREVIEW_FIXTURES } from '../../shared/health-fixtures';
/** Development only: no host access, network, or persistence. */
export function createPreviewClient(): CompanionClient {
  const scenario = new URLSearchParams(window.location.search).get('scenario');
  const workspace = { id: 'preview-workspace', name: 'My HQ', root: '/home/example/HQ', environment: 'linux' as const, addedAt: '2026-09-11T00:00:00Z' };
  const healthScenario = scenario === 'health-healthy' ? 'healthy'
    : scenario === 'health-degraded' ? 'degraded'
      : scenario === 'health-stale' ? 'stale'
        : scenario === 'health-checking' ? 'checking'
          : 'unavailable';
  const state: CompanionSnapshot = {
    version: 'preview', platform: 'linux', installationId: 'preview-only',
    workspaces: [], activeWorkspaceId: null,
    account: { status: 'signed-out', label: null },
    sync: { phase: 'not-connected', lastSuccess: null, message: 'Sign in to sync your files.', conflicts: 0, conflictPaths: [] },
    runtime: { version: '6.16.35', available: true, node: '24' },
    credentials: { available: true, backend: 'preview' },
    preferences: { closeToTray: false, launchAtLogin: false }, diagnostics: [],
    health: structuredClone(HEALTH_PREVIEW_FIXTURES[healthScenario]),
  };
  const attach = () => { if (!state.workspaces.length) state.workspaces.push(workspace); state.activeWorkspaceId = workspace.id; };
  let setupStarted: number | undefined;
  const setup = () => ({ root: workspace.root, complete: false, error: null, steps: [
    { id: 'content', label: 'Getting your workspace ready', status: 'working' as const },
    { id: 'dependencies', label: 'Preparing this computer', status: 'waiting' as const },
    { id: 'personalize', label: 'Adding the finishing touches', status: 'waiting' as const },
  ] });
  if (scenario === 'setup-error') {
    state.setup = setup(); state.setup.steps[0]!.status = 'error';
    state.setup.error = 'There is already an HQ folder here. Choose another folder or use your existing one.';
  }
  if (['connected', 'offline', 'conflict', 'paused'].includes(scenario ?? '')) {
    attach(); state.account = { status: 'connected', label: 'Alex' }; state.syncScopes = [{ id: 'personal', label: 'My personal work' }, { id: 'cmp_example', label: 'My team' }]; state.selectedSyncScope = 'personal';
    state.sync = {
      phase: scenario === 'connected' ? 'idle' : scenario as 'offline' | 'conflict' | 'paused',
      lastSuccess: '2026-09-11T00:00:00Z',
      message: scenario === 'offline' ? 'Waiting for a connection' : scenario === 'conflict' ? 'One file needs your attention' : scenario === 'paused' ? 'Sync is paused' : 'Your files are up to date',
      conflicts: scenario === 'conflict' ? 1 : 0,
      conflictPaths: scenario === 'conflict' ? ['notes/shared-draft.md'] : [],
    };
  }
  return { simulated: true, async request(request) {
    if (request.action === 'create-workspace') { state.setup = setup(); setupStarted = Date.now(); }
    if (request.action === 'resume-setup' && state.setup) { state.setup.error = null; setupStarted = Date.now(); }
    if (request.action === 'cancel-setup' && state.setup) { setupStarted = undefined; state.setup.error = 'Setup was canceled. You can continue when you’re ready.'; for (const step of state.setup.steps) if (step.status === 'working') step.status = 'error'; }
    if (request.action === 'reset-setup') { setupStarted = undefined; delete state.setup; }
    if (setupStarted !== undefined && state.setup) {
      const current = Math.floor((Date.now() - setupStarted) / 400);
      state.setup.steps.forEach((step, index) => { step.status = index < current ? 'ready' : index === current ? 'working' : 'waiting'; });
      if (current >= state.setup.steps.length) { state.setup.complete = true; setupStarted = undefined; attach(); }
    }
    if (request.action === 'attach-workspace') attach();
    if (request.action === 'select-workspace') state.activeWorkspaceId = request.workspaceId!;
    if (request.action === 'remove-workspace') { state.workspaces = state.workspaces.filter(w => w.id !== request.workspaceId); state.activeWorkspaceId = state.workspaces[0]?.id ?? null; delete state.setup; }
    if (request.action === 'sign-in') { state.syncScopes = []; state.selectedSyncScope = undefined; state.account = { status: 'connected', label: 'Alex' }; state.sync.phase = 'paused'; state.sync.message = 'Sync is paused'; }
    if (request.action === 'sign-out') { state.syncScopes = []; state.selectedSyncScope = undefined; state.account = { status: 'signed-out', label: null }; state.sync = { phase: 'not-connected', lastSuccess: null, message: 'Sign in to sync your files.', conflicts: 0, conflictPaths: [] }; }
    if (request.action === 'load-sync-scopes') state.syncScopes = [{ id: 'personal', label: 'My personal work' }, { id: 'cmp_example', label: 'My team' }];
    if (request.action === 'select-sync-scope') { state.selectedSyncScope = request.scopeId; state.sync = { phase: 'paused', message: 'Ready when you are', lastSuccess: null, conflicts: 0, conflictPaths: [] }; }
    if (request.action === 'set-preference') state.preferences[request.preference!] = request.enabled!;
    if (request.action === 'pause-sync') { state.sync.phase = 'paused'; state.sync.message = 'Sync is paused'; }
    if (request.action === 'resume-sync') { state.sync = { phase: 'idle', message: 'Your files are up to date', lastSuccess: new Date().toISOString(), conflicts: 0, conflictPaths: [] }; }
    if (request.action === 'resolve-conflicts') {
      const listed = state.sync.conflictPaths;
      const targets = request.paths?.length ? request.paths : listed;
      if (!targets.length) throw new Error('There are no conflicting files to resolve right now.');
      if (request.paths?.length && request.paths.some((path) => !listed.includes(path))) throw new Error('Choose conflicting files from the current list.');
      if (request.choice === 'abort') {
        state.sync = { ...state.sync, phase: 'paused', message: 'Sync is paused', conflicts: listed.length, conflictPaths: listed };
      } else {
        state.sync = { phase: 'idle', message: 'Your files are up to date', lastSuccess: new Date().toISOString(), conflicts: 0, conflictPaths: [] };
      }
    }
    if (request.action === 'diagnostics') {
      state.health = structuredClone(HEALTH_PREVIEW_FIXTURES.checking);
      // Preview only: flip to healthy on the next snapshot tick.
      setTimeout(() => { state.health = structuredClone(HEALTH_PREVIEW_FIXTURES.healthy); }, 400);
    }
    return structuredClone(state);
  } };
}
