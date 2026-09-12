/** Canonical workspace registry types shared by main and renderer IPC snapshots. */

export const WORKSPACE_ENVIRONMENTS = ['linux', 'windows', 'wsl2'] as const;
export type WorkspaceEnvironment = (typeof WORKSPACE_ENVIRONMENTS)[number];

/** Safe WSL distro name: no path separators or control characters. */
export const WSL_DISTRO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface Workspace {
  id: string;
  name: string;
  root: string;
  environment: WorkspaceEnvironment;
  /** Selected WSL2 distro when environment is wsl2; otherwise null. */
  wslDistro: string | null;
  addedAt: string;
}

export interface WorkspaceRegistryState {
  version: 1;
  installationId: string;
  activeWorkspaceId: string | null;
  workspaces: Workspace[];
}

export function isWorkspaceEnvironment(value: unknown): value is WorkspaceEnvironment {
  return typeof value === 'string' && (WORKSPACE_ENVIRONMENTS as readonly string[]).includes(value);
}

export function normalizeWslDistro(
  environment: WorkspaceEnvironment,
  value: unknown,
): string | null {
  if (environment === 'wsl2') {
    if (typeof value !== 'string' || !WSL_DISTRO_NAME.test(value)) {
      throw new Error('Invalid workspace registry. Your folders have not been changed.');
    }
    return value;
  }
  if (value === undefined || value === null) return null;
  throw new Error('Invalid workspace registry. Your folders have not been changed.');
}

export function isWorkspaceRecord(value: unknown): value is Workspace {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.name !== 'string' || typeof record.root !== 'string') return false;
  if (typeof record.addedAt !== 'string' || !isWorkspaceEnvironment(record.environment)) return false;
  try {
    normalizeWslDistro(record.environment, record.wslDistro ?? null);
    return true;
  } catch {
    return false;
  }
}

export function hostEnvironment(platform: string): Exclude<WorkspaceEnvironment, 'wsl2'> {
  return platform === 'win32' ? 'windows' : 'linux';
}
