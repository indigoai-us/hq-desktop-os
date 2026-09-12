import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceRegistry } from '../../src/main/workspaces';
import { discoverWslDistributions, parseWslListVerbose } from '../../src/main/platform/wsl-discovery';
import { pathIdentity } from '../../src/main/platform/native';

const directories: string[] = [];

async function fixture(platform: NodeJS.Platform = process.platform) {
  const path = await mkdtemp(join(tmpdir(), 'hq-desktop-registry-'));
  directories.push(path);
  const root = join(path, 'existing hq');
  await mkdir(join(root, 'core'), { recursive: true });
  await mkdir(join(root, 'companies'));
  const registry = new WorkspaceRegistry(join(path, 'app'), platform);
  await registry.load();
  return { path, root, registry };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('US-009 workspace registry (native Linux)', () => {
  it('persists root, environment, installation identity and null WSL distro across reloads', async () => {
    const { path, root, registry } = await fixture('linux');
    const attached = await registry.attach(root);
    expect(attached.environment).toBe('linux');
    expect(attached.wslDistro).toBeNull();
    expect(attached.root).toBe(root);
    expect(registry.snapshot.installationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(registry.snapshot.activeWorkspaceId).toBe(attached.id);

    const restored = new WorkspaceRegistry(join(path, 'app'), 'linux');
    await restored.load();
    expect(restored.snapshot).toEqual(registry.snapshot);
    expect(restored.snapshot.workspaces).toHaveLength(1);
  });

  it('canonicalizes aliases and rejects dual ownership of one physical root', async () => {
    const { path, root, registry } = await fixture('linux');
    const alias = join(path, 'alias');
    await symlink(root, alias, 'dir');
    const [first, second] = await Promise.all([registry.attach(root), registry.attach(alias)]);
    expect(first.id).toBe(second.id);
    expect(registry.snapshot.workspaces).toHaveLength(1);

    const windowsRegistry = new WorkspaceRegistry(join(path, 'win-app'), 'win32');
    await windowsRegistry.load();
    await writeFile(
      join(path, 'win-app', 'workspaces.json'),
      `${JSON.stringify({
        version: 1,
        installationId: '11111111-1111-4111-8111-111111111111',
        activeWorkspaceId: 'ws-win',
        workspaces: [{
          id: 'ws-win',
          name: 'existing hq',
          root,
          environment: 'windows',
          wslDistro: null,
          addedAt: '2026-09-11T00:00:00.000Z',
        }],
      }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await windowsRegistry.load();
    await expect(windowsRegistry.attach(root, { environment: 'wsl2', wslDistro: 'Ubuntu' })).rejects.toThrow(
      /already registered as a windows workspace/i,
    );
    expect(windowsRegistry.snapshot.workspaces).toHaveLength(1);
  });

  it('removes registration without deleting workspace contents and rejects bad folders', async () => {
    const { path, root, registry } = await fixture('linux');
    await writeFile(join(root, 'keep.txt'), 'user-owned');
    const workspace = await registry.attach(root);
    await registry.remove(workspace.id);
    expect(registry.snapshot.workspaces).toEqual([]);
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('user-owned');
    await expect(registry.attach(path)).rejects.toThrow(/does not look like an HQ workspace/i);
    await expect(registry.select('unknown')).rejects.toThrow(/no longer registered/i);
  });

  it('fails closed on corrupt registries and migrates missing wslDistro on load', async () => {
    const { path, root } = await fixture('linux');
    const file = join(path, 'app', 'workspaces.json');
    await writeFile(file, '{bad');
    await expect(new WorkspaceRegistry(join(path, 'app'), 'linux').load()).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('{bad');

    await writeFile(
      file,
      `${JSON.stringify({
        version: 1,
        installationId: '22222222-2222-4222-8222-222222222222',
        activeWorkspaceId: 'legacy',
        workspaces: [{
          id: 'legacy',
          name: 'existing hq',
          root,
          environment: 'linux',
          addedAt: '2026-09-11T00:00:00.000Z',
        }],
      }, null, 2)}\n`,
    );
    const migrated = new WorkspaceRegistry(join(path, 'app'), 'linux');
    await migrated.load();
    expect(migrated.snapshot.workspaces[0]?.wslDistro).toBeNull();
  });

  it('refuses attach when the folder is not writable', async () => {
    if (process.getuid?.() === 0) return;
    const { root, registry } = await fixture('linux');
    await chmod(root, 0o500);
    try {
      await expect(registry.attach(root)).rejects.toThrow(/permission/i);
    } finally {
      await chmod(root, 0o700);
    }
  });
});

describe('US-009 WSL discovery contract', () => {
  it('returns actionable unavailable state on non-Windows hosts', async () => {
    const snapshot = await discoverWslDistributions({ platform: 'linux' });
    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.distributions).toEqual([]);
    expect(snapshot.message).toMatch(/Windows hosts/i);
  });

  it('parses wsl --list --verbose, rejects WSL1, and surfaces missing/stopped states', async () => {
    const parsed = parseWslListVerbose(
      '  NAME            STATE           VERSION\n* Ubuntu          Running         2\n  Legacy          Stopped         1\n  Debian          Stopped         2\n',
    );
    expect(parsed).toEqual([
      {
        name: 'Ubuntu',
        version: 2,
        state: 'Running',
        usable: true,
        detail: 'WSL2 distribution is available.',
      },
      {
        name: 'Legacy',
        version: 1,
        state: 'Stopped',
        usable: false,
        detail: 'WSL1 is not supported. Convert this distribution to WSL2, then try again.',
      },
      {
        name: 'Debian',
        version: 2,
        state: 'Stopped',
        usable: true,
        detail: 'Distribution is stopped. Start it from Windows, then refresh.',
      },
    ]);

    const missing = await discoverWslDistributions({
      platform: 'win32',
      runner: async () => {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      },
    });
    expect(missing.status).toBe('missing');
    expect(missing.message).toMatch(/Install WSL2/i);

    const stopped = await discoverWslDistributions({
      platform: 'win32',
      runner: async (command, args) => {
        expect(command).toBe('wsl.exe');
        expect(args).toEqual(['--list', '--verbose']);
        return {
          stdout: '  NAME            STATE           VERSION\n  Legacy          Stopped         1\n',
          stderr: '',
          code: 0,
        };
      },
    });
    expect(stopped.status).toBe('stopped');
    expect(stopped.distributions.every((item) => item.version === 1 || !item.usable || item.state !== 'Running')).toBe(true);
    expect(stopped.message).toMatch(/no supported WSL2/i);

    const ready = await discoverWslDistributions({
      platform: 'win32',
      selected: 'Ubuntu',
      runner: async () => ({
        stdout: Buffer.from('  NAME            STATE           VERSION\r\n* Ubuntu          Running         2\r\n', 'utf16le'),
        stderr: Buffer.alloc(0),
        code: 0,
      }),
    });
    expect(ready.status).toBe('ready');
    expect(ready.selected).toBe('Ubuntu');
  });

  it('uses platform-appropriate path identity', () => {
    expect(pathIdentity('C:\\HQ', 'win32')).toBe(pathIdentity('c:\\hq', 'win32'));
    expect(pathIdentity('/Home/HQ', 'linux')).not.toBe(pathIdentity('/home/HQ', 'linux'));
  });
});
