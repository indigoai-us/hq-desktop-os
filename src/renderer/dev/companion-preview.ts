import type { CompanionClient } from '../companion-client';
import type { CompanionSnapshot } from '../../shared/companion';
import { HEALTH_PREVIEW_FIXTURES } from '../../shared/health-fixtures';
import {
  parsePreviewScenario,
  previewSetupSteps,
  snapshotForScenario,
} from './scenarios';

/** Development only: no host access, network, or persistence. Reset by reloading or clearing `?scenario=`. */
export function createPreviewClient(): CompanionClient {
  const initialScenario = parsePreviewScenario(
    new URLSearchParams(window.location.search).get('scenario'),
  );
  const state: CompanionSnapshot = snapshotForScenario(initialScenario);
  let setupStarted: number | undefined;

  const attach = () => {
    if (!state.workspaces.length) {
      state.workspaces.push({
        id: 'preview-workspace',
        name: 'My HQ',
        root: '/home/example/HQ',
        environment: 'linux',
        addedAt: '2026-09-11T00:00:00Z',
      });
    }
    state.activeWorkspaceId = 'preview-workspace';
  };

  return {
    simulated: true,
    async request(request) {
      if (request.action === 'create-workspace') {
        state.setup = previewSetupSteps();
        setupStarted = Date.now();
      }
      if (request.action === 'resume-setup' && state.setup) {
        state.setup.error = null;
        setupStarted = Date.now();
      }
      if (request.action === 'cancel-setup' && state.setup) {
        setupStarted = undefined;
        state.setup.error = 'Setup was canceled. You can continue when you’re ready.';
        for (const step of state.setup.steps) {
          if (step.status === 'working') step.status = 'error';
        }
      }
      if (request.action === 'reset-setup') {
        setupStarted = undefined;
        delete state.setup;
      }
      if (setupStarted !== undefined && state.setup) {
        const current = Math.floor((Date.now() - setupStarted) / 400);
        state.setup.steps.forEach((step, index) => {
          step.status = index < current ? 'ready' : index === current ? 'working' : 'waiting';
        });
        if (current >= state.setup.steps.length) {
          state.setup.complete = true;
          setupStarted = undefined;
          attach();
        }
      }
      if (request.action === 'attach-workspace') attach();
      if (request.action === 'select-workspace') state.activeWorkspaceId = request.workspaceId!;
      if (request.action === 'remove-workspace') {
        state.workspaces = state.workspaces.filter((w) => w.id !== request.workspaceId);
        state.activeWorkspaceId = state.workspaces[0]?.id ?? null;
        delete state.setup;
      }
      if (request.action === 'sign-in') {
        state.account = { status: 'connected', label: 'Alex' };
        state.syncScopes = [
          { id: 'all', label: 'Everything I’m part of (2)' },
          { id: 'personal', label: 'My personal work only' },
          { id: 'cmp_example', label: 'My team' },
        ];
        state.selectedSyncScope = 'all';
        state.sync = {
          phase: 'syncing',
          message: 'Connecting your files',
          lastSuccess: null,
          conflicts: 0,
          conflictPaths: [],
        };
      }
      if (request.action === 'sign-out') {
        state.syncScopes = [];
        state.selectedSyncScope = undefined;
        state.account = { status: 'signed-out', label: null };
        state.sync = {
          phase: 'not-connected',
          lastSuccess: null,
          message: 'Sign in to sync your files.',
          conflicts: 0,
          conflictPaths: [],
        };
      }
      if (request.action === 'load-sync-scopes') {
        state.syncScopes = [
          { id: 'all', label: 'Everything I’m part of (2)' },
          { id: 'personal', label: 'My personal work only' },
          { id: 'cmp_example', label: 'My team' },
        ];
        state.selectedSyncScope = 'all';
      }
      if (request.action === 'select-sync-scope') {
        state.selectedSyncScope = request.scopeId;
        state.sync = {
          phase: 'paused',
          message: 'Ready when you are',
          lastSuccess: null,
          conflicts: 0,
          conflictPaths: [],
        };
      }
      if (request.action === 'set-preference') state.preferences[request.preference!] = request.enabled!;
      if (request.action === 'pause-sync') {
        state.sync.phase = 'paused';
        state.sync.message = 'Sync is paused';
      }
      if (request.action === 'resume-sync') {
        state.sync = {
          phase: 'idle',
          message: 'Your files are up to date',
          lastSuccess: new Date().toISOString(),
          conflicts: 0,
          conflictPaths: [],
        };
      }
      if (request.action === 'resolve-conflicts') {
        const listed = state.sync.conflictPaths;
        const targets = request.paths?.length ? request.paths : listed;
        if (!targets.length) throw new Error('There are no conflicting files to resolve right now.');
        if (request.paths?.length && request.paths.some((path) => !listed.includes(path))) {
          throw new Error('Choose conflicting files from the current list.');
        }
        if (request.choice === 'abort') {
          state.sync = {
            ...state.sync,
            phase: 'paused',
            message: 'Sync is paused',
            conflicts: listed.length,
            conflictPaths: listed,
          };
        } else {
          state.sync = {
            phase: 'idle',
            message: 'Your files are up to date',
            lastSuccess: new Date().toISOString(),
            conflicts: 0,
            conflictPaths: [],
          };
        }
      }
      if (request.action === 'diagnostics') {
        state.health = structuredClone(HEALTH_PREVIEW_FIXTURES.checking);
        // Preview only: flip to healthy on the next snapshot tick.
        setTimeout(() => {
          state.health = structuredClone(HEALTH_PREVIEW_FIXTURES.healthy);
        }, 400);
      }
      return structuredClone(state);
    },
  };
}
