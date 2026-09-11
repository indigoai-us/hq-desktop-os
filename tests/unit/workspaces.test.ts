import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceRegistry } from '../../src/main/workspaces';
import { parseCompanionAction } from '../../src/shared/companion';
const directories: string[] = [];
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'hq-desktop-registry-')); directories.push(path);
  const root = join(path, 'existing hq');
  await mkdir(join(root, 'core'), { recursive: true }); await mkdir(join(root, 'companies'));
  const registry = new WorkspaceRegistry(join(path, 'app')); await registry.load();
  return { path, root, registry };
}
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
describe('workspace ownership', () => {
  it('canonicalizes aliases, serializes concurrent attaches and persists stable identity', async () => {
    const { path, root, registry } = await fixture();
    const alias = join(path, 'alias'); await symlink(root, alias, 'dir');
    const [first, second] = await Promise.all([registry.attach(root), registry.attach(alias)]);
    expect(first.id).toBe(second.id); expect(registry.snapshot.workspaces).toHaveLength(1);
    const restored = new WorkspaceRegistry(join(path, 'app')); await restored.load();
    expect(restored.snapshot).toEqual(registry.snapshot);
  });
  it('removes registration without deleting workspace contents', async () => {
    const { root, registry } = await fixture();
    await writeFile(join(root, 'keep.txt'), 'user-owned');
    const workspace = await registry.attach(root); await registry.remove(workspace.id);
    expect(registry.snapshot.workspaces).toEqual([]);
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('user-owned');
  });
  it('rejects non-HQ folders and unknown workspace IDs', async () => {
    const { path, registry } = await fixture();
    await expect(registry.attach(path)).rejects.toThrow('existing HQ');
    await expect(registry.select('unknown')).rejects.toThrow('no longer registered');
    expect(registry.snapshot.workspaces).toEqual([]);
  });
  it('fails closed on a corrupt registry rather than replacing it', async () => {
    const { path } = await fixture(); const file = join(path, 'app/workspaces.json');
    await writeFile(file, '{bad');
    await expect(new WorkspaceRegistry(join(path, 'app')).load()).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('{bad');
  });
  it('rejects arbitrary commands and renderer paths at the request boundary', () => {
    expect(parseCompanionAction({ action: 'open-folder', workspaceId: 'abc-123' })).not.toBeNull();
    for (const input of [{ action: 'exec', command: 'test' }, { action: 'attach-workspace', path: '/private' }, { action: 'open-folder', workspaceId: '../secret' }, { action: 'open-terminal' }, { action: 'snapshot', workspaceId: 'extra' }, null]) expect(parseCompanionAction(input)).toBeNull();
  });
});
