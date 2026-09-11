import type { CompanionClient } from '../companion-client';
import type { CompanionSnapshot } from '../../shared/companion';
/** Never imported by a production build. Each reload constructs a fresh state. */
export function createPreviewClient(): CompanionClient {
  const state: CompanionSnapshot = {
    version: 'preview', platform: 'linux', installationId: 'preview-only',
    workspaces: [], activeWorkspaceId: null,
    account: { status: 'signed-out', label: null },
    sync: { phase: 'not-connected', lastSuccess: null, message: 'Account connection and shared-runner integration require native acceptance before sync can be enabled.', conflicts: 0 },
    runtime: { version: '6.16.35', available: true, node: '24' },
    credentials: { available: true, backend: 'preview' },
    preferences: { closeToTray: false, launchAtLogin: false },
    diagnostics: [{ name: 'Preview mode', state: 'unavailable', detail: 'Simulated data. No native actions or network calls.' }],
  };
  return { simulated: true, async request(request) {
    if (request.action === 'attach-workspace') {
      if (!state.workspaces.length) state.workspaces.push({ id: 'preview-workspace', name: 'My HQ', root: '/home/example/hq', environment: 'linux', addedAt: '2026-09-11T00:00:00Z' });
      state.activeWorkspaceId = 'preview-workspace';
    }
    if (request.action === 'select-workspace') state.activeWorkspaceId = request.workspaceId!;
    if (request.action === 'remove-workspace') { state.workspaces = state.workspaces.filter((w) => w.id !== request.workspaceId); state.activeWorkspaceId = state.workspaces[0]?.id ?? null; }
    return structuredClone(state);
  } };
}
