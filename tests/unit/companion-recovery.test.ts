import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const host = vi.hoisted(() => ({ directory: '', restore: vi.fn(), scopes: vi.fn(), provision: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => host.directory, getVersion: () => 'test' }, dialog: {}, shell: {}, safeStorage: { getSelectedStorageBackend: () => 'gnome_libsecret', isEncryptionAvailable: () => true } }));
vi.mock('../../src/main/auth', () => ({ AccountSession: class { identity = { sub: 'alice', label: 'Alice' }; restore = host.restore; signOut = vi.fn(async () => { this.identity = undefined as never; }); } }));
vi.mock('../../src/main/sync-supervisor', () => ({ SyncSupervisor: class { running = false; state = { phase: 'paused', message: 'Paused', lastSuccess: null, conflicts: 0 }; start = vi.fn(() => { this.running = true; }); stop = vi.fn(async () => { this.running = false; }); pause = vi.fn(async () => { this.running = false; }); reset = vi.fn(async () => { this.running = false; }); } }));
vi.mock('../../src/main/sync-scopes', async importOriginal => ({ ...await importOriginal<object>(), loadScopes: host.scopes, ensurePersonalStorage: host.provision }));
import { CompanionService } from '../../src/main/companion';
import { SyncSelectionStore } from '../../src/main/sync-selection';
import { WorkspaceRegistry } from '../../src/main/workspaces';
let root: string;
async function prepare(enabled = true, sub = 'alice', scope = 'personal') {
  const registry = new WorkspaceRegistry(host.directory); await registry.load(); await registry.attach(root);
  await new SyncSelectionStore(host.directory).save({ root, sub, scope, enabled });
  const service = new CompanionService(); await service.initialize(); return service;
}
beforeEach(async () => {
  vi.clearAllMocks(); host.restore.mockResolvedValue(undefined); host.scopes.mockResolvedValue([{ id: 'personal', label: 'My personal work' }]); host.provision.mockResolvedValue(undefined);
  host.directory = await mkdtemp(join(tmpdir(), 'hq-service-recovery-')); root = join(host.directory, 'HQ');
  await mkdir(join(root, 'core'), { recursive: true }); await mkdir(join(root, 'companies'));
});
afterEach(async () => { await rm(host.directory, { recursive: true, force: true }); });
describe('desktop sync recovery', () => {
  it('reconnects once after validating the account, membership and folder', async () => {
    const service = await prepare();
    await service.request({ action: 'diagnostics' });
    expect(service.sync.start).toHaveBeenCalledTimes(1);
    expect(host.scopes).toHaveBeenCalled(); expect(host.provision).toHaveBeenCalledOnce();
    expect(service.sync.start).toHaveBeenCalledWith(root, 'personal', expect.any(Object));
    await service.shutdown();
  });
  it.each([[false, 'alice', 'personal'], [true, 'bob', 'personal'], [true, 'alice', 'cmp_REVOKED']])('does not reconnect a paused, different-account or revoked choice', async (enabled, sub, scope) => {
    const service = await prepare(enabled as boolean, sub as string, scope as string);
    await service.request({ action: 'diagnostics' });
    expect(service.sync.start).not.toHaveBeenCalled();
    await service.shutdown();
  });
  it.each(['pause-sync', 'sign-out', 'shutdown'])('honors %s received while account recovery is pending', async action => {
    let release!: () => void; host.restore.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const service = await prepare();
    const done = action === 'shutdown' ? service.shutdown() : service.request({ action });
    release(); await done;
    expect(service.sync.start).not.toHaveBeenCalled();
    if (action !== 'shutdown') expect(await new SyncSelectionStore(host.directory).read(root, 'alice')).toMatchObject({ enabled: false });
    await service.shutdown();
  });
  it.each(['sign-out', 'remove-workspace'])('allows %s after the active folder disappears', async action => {
    const service = await prepare(); await service.request({ action: 'diagnostics' });
    const workspaceId = service.registry.snapshot.activeWorkspaceId!;
    await rm(root, { recursive: true, force: true });
    await service.request(action === 'sign-out' ? { action } : { action, workspaceId });
    if (action === 'sign-out') expect(service.account.identity).toBeUndefined();
    else expect(service.registry.snapshot.workspaces).toHaveLength(0);
    await service.shutdown();
  });
  it('clears the account even when saving disabled sync intent fails', async () => {
    const service = await prepare(); await service.request({ action: 'diagnostics' });
    const spy = vi.spyOn(SyncSelectionStore.prototype, 'save').mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(service.request({ action: 'sign-out' })).rejects.toThrow('disk unavailable');
    expect(service.account.identity).toBeUndefined(); expect(service.sync.running).toBe(false);
    spy.mockRestore(); await service.shutdown();
  });
  it('does not start after a pause arrives during provisioning', async () => {
    let release!: () => void; host.provision.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const service = await prepare(); await vi.waitFor(() => expect(host.provision).toHaveBeenCalled());
    const pause = service.request({ action: 'pause-sync' }); release(); await pause;
    expect(service.sync.start).not.toHaveBeenCalled(); await service.shutdown();
  });
});
