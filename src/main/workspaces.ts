import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  hostEnvironment,
  isWorkspaceRecord,
  normalizeWslDistro,
  type Workspace,
  type WorkspaceEnvironment,
  type WorkspaceRegistryState,
} from '../shared/workspace.js';
import {
  assertHqWorkspaceLayout,
  assertReadableWritableDirectory,
  pathIdentity,
  resolveWorkspaceRoot,
} from './platform/native.js';

const emptyRegistry = (): WorkspaceRegistryState => ({
  version: 1,
  installationId: randomUUID(),
  activeWorkspaceId: null,
  workspaces: [],
});

function parseRegistry(raw: unknown): WorkspaceRegistryState {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid workspace registry. Your folders have not been changed.');
  }
  const state = raw as WorkspaceRegistryState;
  if (state.version !== 1 || typeof state.installationId !== 'string' || !Array.isArray(state.workspaces)) {
    throw new Error('Invalid workspace registry. Your folders have not been changed.');
  }
  const workspaces: Workspace[] = state.workspaces.map((entry) => {
    // Tolerate pre-US-009 records that omitted wslDistro (native linux/windows only).
    const candidate = entry && typeof entry === 'object'
      ? { ...(entry as object), wslDistro: (entry as { wslDistro?: unknown }).wslDistro ?? null }
      : entry;
    if (!isWorkspaceRecord(candidate)) {
      throw new Error('Invalid workspace registry. Your folders have not been changed.');
    }
    return {
      ...candidate,
      wslDistro: normalizeWslDistro(candidate.environment, candidate.wslDistro),
    };
  });
  if (state.activeWorkspaceId !== null && !workspaces.some((workspace) => workspace.id === state.activeWorkspaceId)) {
    throw new Error('Invalid workspace registry. Your folders have not been changed.');
  }
  return {
    version: 1,
    installationId: state.installationId,
    activeWorkspaceId: state.activeWorkspaceId,
    workspaces,
  };
}

export interface AttachWorkspaceOptions {
  environment?: WorkspaceEnvironment;
  wslDistro?: string | null;
}

export class WorkspaceRegistry {
  private state: WorkspaceRegistryState = emptyRegistry();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string, private readonly platform = process.platform) {}
  get snapshot(): WorkspaceRegistryState { return structuredClone(this.state); }
  async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const raw: unknown = JSON.parse(await readFile(join(this.directory, 'workspaces.json'), 'utf8'));
      this.state = parseRegistry(raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.persist(this.state);
    }
  }
  private async persist(next: WorkspaceRegistryState): Promise<void> {
    const path = join(this.directory, 'workspaces.json');
    await writeFile(`${path}.tmp`, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    this.state = next;
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.then(() => undefined, (error: unknown) => {
      console.error('Workspace operation failed:', error instanceof Error ? error.message : 'unknown error');
    });
    return next;
  }
  private resolveAttachTarget(options: AttachWorkspaceOptions = {}): {
    environment: WorkspaceEnvironment;
    wslDistro: string | null;
  } {
    const environment = options.environment ?? hostEnvironment(this.platform);
    if (environment === 'wsl2') {
      if (this.platform !== 'win32') {
        throw new Error('WSL workspaces can only be attached from the Windows app.');
      }
      const wslDistro = normalizeWslDistro('wsl2', options.wslDistro ?? null);
      return { environment, wslDistro };
    }
    if (options.wslDistro != null) {
      throw new Error('Only WSL workspaces select a distribution.');
    }
    return { environment, wslDistro: null };
  }
  attach(selected: string, options: AttachWorkspaceOptions = {}): Promise<Workspace> {
    return this.serialize(async () => {
      const { environment, wslDistro } = this.resolveAttachTarget(options);
      const root = await resolveWorkspaceRoot(selected);
      await assertReadableWritableDirectory(root);
      await assertHqWorkspaceLayout(root);
      const identity = pathIdentity(root, this.platform);
      const duplicate = this.state.workspaces.find((workspace) => pathIdentity(workspace.root, this.platform) === identity);
      if (duplicate) {
        if (duplicate.environment !== environment || duplicate.wslDistro !== wslDistro) {
          throw new Error(
            `This folder is already registered as a ${duplicate.environment} workspace`
            + (duplicate.wslDistro ? ` (${duplicate.wslDistro})` : '')
            + '. Remove that registration before attaching it under a different environment.',
          );
        }
        await this.persist({ ...this.state, activeWorkspaceId: duplicate.id });
        return duplicate;
      }
      const workspace: Workspace = {
        id: randomUUID(),
        name: basename(root),
        root,
        environment,
        wslDistro,
        addedAt: new Date().toISOString(),
      };
      await this.persist({
        ...this.state,
        activeWorkspaceId: workspace.id,
        workspaces: [...this.state.workspaces, workspace],
      });
      return workspace;
    });
  }
  select(id: string): Promise<void> {
    return this.serialize(async () => {
      this.get(id);
      await this.persist({ ...this.state, activeWorkspaceId: id });
    });
  }
  remove(id: string): Promise<void> {
    return this.serialize(async () => {
      this.get(id);
      const workspaces = this.state.workspaces.filter((workspace) => workspace.id !== id);
      await this.persist({
        ...this.state,
        workspaces,
        activeWorkspaceId: this.state.activeWorkspaceId === id ? workspaces[0]?.id ?? null : this.state.activeWorkspaceId,
      });
    });
  }
  get(id: string): Workspace {
    const workspace = this.state.workspaces.find((entry) => entry.id === id);
    if (!workspace) throw new Error('Workspace is no longer registered.');
    return structuredClone(workspace);
  }
  async verifiedRoot(id: string): Promise<string> {
    const workspace = this.get(id);
    const root = await realpath(workspace.root);
    if (pathIdentity(root, this.platform) !== pathIdentity(workspace.root, this.platform)) {
      throw new Error('The workspace path changed. Remove it from the app and attach it again.');
    }
    await assertReadableWritableDirectory(root);
    return root;
  }
}
