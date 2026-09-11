import type { CompanionSnapshot } from '../../shared/companion';
import { HEALTH_PREVIEW_FIXTURES } from '../../shared/health-fixtures';

/**
 * Deterministic development-only companion scenarios.
 * Selected via `?scenario=` on `/dev/companion`. Production builds never load this module.
 */
export const PREVIEW_SCENARIOS = [
  'signed-out',
  'setup',
  'setup-error',
  'syncing',
  'connected',
  'offline',
  'conflict',
  'paused',
  'failure',
  'memberships-error',
  'health-healthy',
  'health-degraded',
  'health-stale',
  'health-checking',
  'health-unavailable',
  'health-unknown',
] as const;

export type PreviewScenarioId = (typeof PREVIEW_SCENARIOS)[number];

/** Required AC scenarios that must stay deterministic and resettable. */
export const REQUIRED_PREVIEW_SCENARIOS = [
  'signed-out',
  'setup',
  'syncing',
  'offline',
  'conflict',
  'failure',
] as const satisfies readonly PreviewScenarioId[];

const PREVIEW_WORKSPACE = {
  id: 'preview-workspace',
  name: 'My HQ',
  root: '/home/example/HQ',
  environment: 'linux' as const,
  wslDistro: null,
  addedAt: '2026-09-11T00:00:00Z',
};

const SYNC_SCOPES = [
  { id: 'all', label: 'Everything I’m part of (2)' },
  { id: 'personal', label: 'My personal work only' },
  { id: 'cmp_example', label: 'My team' },
];

export function isPreviewScenarioId(value: unknown): value is PreviewScenarioId {
  return typeof value === 'string' && (PREVIEW_SCENARIOS as readonly string[]).includes(value);
}

/** Unknown or missing values fall back to signed-out — never invent a live network state. */
export function parsePreviewScenario(raw: string | null | undefined): PreviewScenarioId {
  if (raw && isPreviewScenarioId(raw)) return raw;
  return 'signed-out';
}

export function createBasePreviewSnapshot(
  healthKey: keyof typeof HEALTH_PREVIEW_FIXTURES = 'unavailable',
): CompanionSnapshot {
  return {
    version: 'preview',
    platform: 'linux',
    installationId: 'preview-only',
    workspaces: [],
    activeWorkspaceId: null,
    account: { status: 'signed-out', label: null },
    memberships: { status: 'idle', error: null },
    sync: {
      phase: 'not-connected',
      lastSuccess: null,
      message: 'Sign in to sync your files.',
      conflicts: 0,
      conflictPaths: [],
    },
    runtime: { version: '6.16.35', available: true, node: '24' },
    credentials: { available: true, backend: 'preview' },
    preferences: { closeToTray: false, launchAtLogin: false },
    diagnostics: [],
    health: structuredClone(HEALTH_PREVIEW_FIXTURES[healthKey]),
  };
}

export function previewSetupSteps(): NonNullable<CompanionSnapshot['setup']> {
  return {
    root: PREVIEW_WORKSPACE.root,
    complete: false,
    error: null,
    steps: [
      { id: 'content', label: 'Getting your workspace ready', status: 'working' },
      { id: 'dependencies', label: 'Preparing this computer', status: 'waiting' },
      { id: 'personalize', label: 'Adding the finishing touches', status: 'waiting' },
    ],
  };
}

function attachWorkspace(state: CompanionSnapshot): void {
  if (!state.workspaces.length) state.workspaces.push({ ...PREVIEW_WORKSPACE });
  state.activeWorkspaceId = PREVIEW_WORKSPACE.id;
}

function connectAccount(state: CompanionSnapshot): void {
  attachWorkspace(state);
  state.account = { status: 'connected', label: 'Alex' };
  state.syncScopes = SYNC_SCOPES.map((scope) => ({ ...scope }));
  state.selectedSyncScope = 'all';
  state.memberships = { status: 'ready', error: null };
}

function healthKeyForScenario(
  scenario: PreviewScenarioId,
): keyof typeof HEALTH_PREVIEW_FIXTURES {
  switch (scenario) {
    case 'health-healthy':
      return 'healthy';
    case 'health-degraded':
      return 'degraded';
    case 'health-stale':
      return 'stale';
    case 'health-checking':
      return 'checking';
    case 'health-unavailable':
    case 'health-unknown':
      return 'unavailable';
    default:
      return 'unavailable';
  }
}

/** Apply a named scenario onto a mutable snapshot. Idempotent for the same id. */
export function applyPreviewScenario(
  state: CompanionSnapshot,
  scenario: PreviewScenarioId,
): void {
  state.health = structuredClone(HEALTH_PREVIEW_FIXTURES[healthKeyForScenario(scenario)]);

  switch (scenario) {
    case 'signed-out':
    case 'health-healthy':
    case 'health-degraded':
    case 'health-stale':
    case 'health-checking':
    case 'health-unavailable':
    case 'health-unknown':
      return;
    case 'setup': {
      state.setup = previewSetupSteps();
      return;
    }
    case 'setup-error': {
      state.setup = previewSetupSteps();
      state.setup.steps[0]!.status = 'error';
      state.setup.error =
        'There is already an HQ folder here. Choose another folder or use your existing one.';
      return;
    }
    case 'syncing': {
      connectAccount(state);
      state.sync = {
        phase: 'syncing',
        lastSuccess: null,
        message: 'Connecting your files',
        conflicts: 0,
        conflictPaths: [],
      };
      return;
    }
    case 'connected': {
      connectAccount(state);
      state.sync = {
        phase: 'idle',
        lastSuccess: '2026-09-11T00:00:00Z',
        message: 'Your files are up to date',
        conflicts: 0,
        conflictPaths: [],
      };
      return;
    }
    case 'offline': {
      connectAccount(state);
      state.sync = {
        phase: 'offline',
        lastSuccess: '2026-09-11T00:00:00Z',
        message: 'Waiting for a connection',
        conflicts: 0,
        conflictPaths: [],
      };
      return;
    }
    case 'conflict': {
      connectAccount(state);
      state.sync = {
        phase: 'conflict',
        lastSuccess: '2026-09-11T00:00:00Z',
        message: 'One file needs your attention',
        conflicts: 1,
        conflictPaths: ['notes/shared-draft.md'],
      };
      return;
    }
    case 'paused': {
      connectAccount(state);
      state.sync = {
        phase: 'paused',
        lastSuccess: '2026-09-11T00:00:00Z',
        message: 'Sync is paused',
        conflicts: 0,
        conflictPaths: [],
      };
      return;
    }
    case 'failure': {
      connectAccount(state);
      state.sync = {
        phase: 'error',
        lastSuccess: '2026-09-11T00:00:00Z',
        message: 'Sync could not finish. Check your connection and try again.',
        conflicts: 0,
        conflictPaths: [],
      };
      return;
    }
    case 'memberships-error': {
      attachWorkspace(state);
      state.account = { status: 'connected', label: 'Alex' };
      state.syncScopes = [];
      state.selectedSyncScope = undefined;
      state.memberships = {
        status: 'error',
        error: 'Your shared workspaces could not be loaded. Check your connection and try again.',
      };
      state.sync = {
        phase: 'error',
        lastSuccess: null,
        message: 'Your shared workspaces could not be loaded.',
        conflicts: 0,
        conflictPaths: [],
      };
      return;
    }
    default: {
      const _exhaustive: never = scenario;
      return _exhaustive;
    }
  }
}

/** Build a fresh snapshot for a scenario id (or signed-out when unknown). */
export function snapshotForScenario(raw: string | null | undefined): CompanionSnapshot {
  const scenario = parsePreviewScenario(raw);
  const state = createBasePreviewSnapshot(healthKeyForScenario(scenario));
  applyPreviewScenario(state, scenario);
  return state;
}
