/** Serializable desktop state. Credentials and arbitrary host commands never cross IPC. */
export interface Workspace {
  id: string;
  name: string;
  root: string;
  environment: 'linux' | 'windows';
  addedAt: string;
}
export type SyncPhase = 'not-connected' | 'idle' | 'syncing' | 'paused' | 'offline' | 'conflict' | 'error';
export interface CompanionSnapshot {
  version: string;
  platform: string;
  installationId: string;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  account: { status: 'signed-out' | 'connected'; label: string | null };
  sync: { phase: SyncPhase; lastSuccess: string | null; message: string; conflicts: number };
  runtime: { version: string; available: boolean; node: string };
  credentials: { available: boolean; backend: string };
  preferences: { closeToTray: boolean; launchAtLogin: boolean };
  diagnostics: { name: string; state: 'ok' | 'attention' | 'unavailable'; detail: string }[];
}
export const COMPANION_ACTIONS = ['snapshot', 'attach-workspace', 'select-workspace', 'remove-workspace', 'open-folder', 'open-terminal', 'open-editor', 'export-diagnostics', 'diagnostics', 'sign-out'] as const;
export type CompanionActionName = typeof COMPANION_ACTIONS[number];
export interface CompanionAction { action: CompanionActionName; workspaceId?: string }
export function parseCompanionAction(raw: unknown): CompanionAction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'action' && key !== 'workspaceId')) return null;
  if (!COMPANION_ACTIONS.includes(record.action as CompanionActionName)) return null;
  const needsId = ['select-workspace', 'remove-workspace', 'open-folder', 'open-terminal', 'open-editor'].includes(String(record.action));
  if (needsId && (typeof record.workspaceId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(record.workspaceId))) return null;
  if (!needsId && record.workspaceId !== undefined) return null;
  return record as unknown as CompanionAction;
}
export function activeWorkspace(state: CompanionSnapshot): Workspace | undefined {
  return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
}
