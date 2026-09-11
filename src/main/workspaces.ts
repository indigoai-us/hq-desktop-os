import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join, parse } from 'node:path';
import type { Workspace } from '../shared/companion.js';

interface Registry { version: 1; installationId: string; activeWorkspaceId: string | null; workspaces: Workspace[] }
const emptyRegistry = (): Registry => ({ version: 1, installationId: randomUUID(), activeWorkspaceId: null, workspaces: [] });
export class WorkspaceRegistry {
  private state: Registry = emptyRegistry();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string, private readonly platform = process.platform) {}
  get snapshot(): Registry { return structuredClone(this.state); }
  async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const raw: unknown = JSON.parse(await readFile(join(this.directory, 'workspaces.json'), 'utf8'));
      if (!raw || typeof raw !== 'object') throw new Error('Invalid workspace registry. Your folders have not been changed.');
      const state = raw as Registry;
      if (state.version !== 1 || typeof state.installationId !== 'string' || !Array.isArray(state.workspaces) || state.workspaces.some((w) => !w || typeof w.root !== 'string' || typeof w.id !== 'string' || typeof w.name !== 'string' || !['linux', 'windows'].includes(w.environment)) || (state.activeWorkspaceId !== null && !state.workspaces.some((w) => w.id === state.activeWorkspaceId))) throw new Error('Invalid workspace registry. Your folders have not been changed.');
      this.state = state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.persist(this.state);
    }
  }
  private async persist(next: Registry): Promise<void> {
    const path = join(this.directory, 'workspaces.json');
    await writeFile(`${path}.tmp`, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    this.state = next;
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.then(() => undefined, (error: unknown) => { console.error('Workspace operation failed:', error instanceof Error ? error.message : 'unknown error'); });
    return next;
  }
  attach(selected: string): Promise<Workspace> {
    return this.serialize(async () => {
      const root = await realpath(selected);
      if (!(await stat(root)).isDirectory() || root === parse(root).root) throw new Error('Choose an HQ workspace folder, not a filesystem root.');
      // A renderer cannot authorize an arbitrary host path; selection happens in the native dialog.
      // Existing workspaces must have actual HQ layout. Attaching never overwrites their contents.
      const markers = await Promise.all(['companies', 'core'].map(async (name) => {
        try { return (await stat(join(root, name))).isDirectory(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
      }));
      if (!markers.every(Boolean)) throw new Error('This folder does not look like an HQ workspace. Choose your HQ folder, or use Set up HQ to create one.');
      const identity = (value: string) => this.platform === 'win32' ? value.toLowerCase() : value;
      const duplicate = this.state.workspaces.find((w) => identity(w.root) === identity(root));
      if (duplicate) { await this.persist({ ...this.state, activeWorkspaceId: duplicate.id }); return duplicate; }
      const workspace: Workspace = { id: randomUUID(), name: basename(root), root, environment: this.platform === 'win32' ? 'windows' : 'linux', addedAt: new Date().toISOString() };
      await this.persist({ ...this.state, activeWorkspaceId: workspace.id, workspaces: [...this.state.workspaces, workspace] });
      return workspace;
    });
  }
  select(id: string): Promise<void> {
    return this.serialize(async () => { this.get(id); await this.persist({ ...this.state, activeWorkspaceId: id }); });
  }
  remove(id: string): Promise<void> {
    return this.serialize(async () => {
      this.get(id);
      const workspaces = this.state.workspaces.filter((w) => w.id !== id);
      await this.persist({ ...this.state, workspaces, activeWorkspaceId: this.state.activeWorkspaceId === id ? workspaces[0]?.id ?? null : this.state.activeWorkspaceId });
    });
  }
  get(id: string): Workspace {
    const workspace = this.state.workspaces.find((w) => w.id === id);
    if (!workspace) throw new Error('Workspace is no longer registered.');
    return structuredClone(workspace);
  }
  async verifiedRoot(id: string): Promise<string> {
    const workspace = this.get(id);
    const root = await realpath(workspace.root);
    if (root !== workspace.root) throw new Error('The workspace path changed. Remove it from the app and attach it again.');
    return root;
  }
}
