import type { CompanionHealth } from './health.js';
import type { CredentialStorageStatus, PublicAccount } from './auth.js';
import type { Workspace } from './workspace.js';
import { isHqWebDestination, type HqWebDestination } from './hq-web.js';
import type { SyncStatus } from './sync.js';

export type { Workspace, WorkspaceEnvironment } from './workspace.js';
export type { AccountStatus, CredentialStorageStatus, PublicAccount } from './auth.js';
export type { HqWebDestination } from './hq-web.js';
export type { SyncPhase, SyncStatus } from './sync.js';

/** Serializable desktop state. Credentials and arbitrary host commands never cross IPC. */
/** Engine `--on-conflict` strategies from hq-cloud sync-runner. */
export const CONFLICT_CHOICES = ['keep', 'publish-local', 'overwrite', 'abort'] as const;
export type ConflictChoice = typeof CONFLICT_CHOICES[number];

/** Membership discovery must never look like a successful empty company list on failure. */
export type MembershipsStatus = 'idle' | 'ready' | 'error';
export interface MembershipsState {
  status: MembershipsStatus;
  error: string | null;
}

export interface CompanionSnapshot {
  setup?: { root: string; steps: { id: string; label: string; status: 'waiting' | 'working' | 'ready' | 'error' }[]; error: string | null; complete: boolean };
  syncScopes?: { id: string; label: string }[];
  selectedSyncScope?: string;
  memberships: MembershipsState;
  version: string;
  platform: string;
  installationId: string;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  account: PublicAccount;
  sync: SyncStatus;
  runtime: { version: string; available: boolean; node: string };
  credentials: CredentialStorageStatus;
  preferences: { closeToTray: boolean; launchAtLogin: boolean };
  diagnostics: { name: string; state: 'ok' | 'attention' | 'unavailable'; detail: string }[];
  health: CompanionHealth;
}
export const COMPANION_ACTIONS = [
  'snapshot',
  'create-workspace',
  'resume-setup',
  'cancel-setup',
  'reset-setup',
  'sign-in',
  'cancel-sign-in',
  'pause-sync',
  'resume-sync',
  'resolve-conflicts',
  'load-sync-scopes',
  'select-sync-scope',
  'open-hq-web',
  'attach-workspace',
  'select-workspace',
  'remove-workspace',
  'open-folder',
  'open-terminal',
  'export-diagnostics',
  'diagnostics',
  'set-preference',
  'sign-out',
] as const;
export type CompanionActionName = typeof COMPANION_ACTIONS[number];
export interface CompanionAction {
  action: CompanionActionName;
  workspaceId?: string;
  scopeId?: string;
  preference?: 'closeToTray' | 'launchAtLogin';
  enabled?: boolean;
  choice?: ConflictChoice;
  /** Relative conflict paths to resolve; omit to apply the choice to every listed conflict. */
  paths?: string[];
  /** Existing HQ console flow opened in the system browser. */
  destination?: HqWebDestination;
}
/** Relative vault keys only — never absolute host paths across IPC. */
export function isRelativeConflictPath(path: string): boolean {
  if (!path || path.length > 512 || path.includes('\0') || path.includes('..')) return false;
  if (path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(path)) return false;
  return true;
}
export function parseCompanionAction(raw: unknown): CompanionAction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['action', 'workspaceId', 'scopeId', 'preference', 'enabled', 'choice', 'paths', 'destination'].includes(key))) return null;
  if (!COMPANION_ACTIONS.includes(record.action as CompanionActionName)) return null;
  const needsId = ['select-workspace', 'remove-workspace', 'open-folder', 'open-terminal'].includes(String(record.action));
  if (needsId && (typeof record.workspaceId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(record.workspaceId))) return null;
  if (!needsId && record.workspaceId !== undefined) return null;
  if (record.action === 'select-sync-scope') { if (typeof record.scopeId !== 'string' || !/^(all|personal|cmp_[a-zA-Z0-9]+)$/.test(record.scopeId)) return null; }
  else if (record.scopeId !== undefined) return null;
  if (record.action === 'set-preference') { if (!['closeToTray', 'launchAtLogin'].includes(String(record.preference)) || typeof record.enabled !== 'boolean') return null; }
  else if (record.preference !== undefined || record.enabled !== undefined) return null;
  if (record.action === 'resolve-conflicts') {
    if (!CONFLICT_CHOICES.includes(record.choice as ConflictChoice)) return null;
    if (record.paths !== undefined) {
      if (!Array.isArray(record.paths) || !record.paths.length || record.paths.length > 500) return null;
      if (record.paths.some((path) => typeof path !== 'string' || !isRelativeConflictPath(path))) return null;
    }
  } else if (record.choice !== undefined || record.paths !== undefined) return null;
  if (record.action === 'open-hq-web') {
    if (!isHqWebDestination(record.destination)) return null;
  } else if (record.destination !== undefined) return null;
  return record as unknown as CompanionAction;
}
export function activeWorkspace(state: CompanionSnapshot): Workspace | undefined {
  return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
}
