import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fork, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, '../..');

function readManifest() {
  return JSON.parse(readFileSync(join(root, 'runtime/manifest.json'), 'utf8')) as {
    syncEngine: { version: string; integrity: string; package: string };
    payloadBudgets: {
      hqCloudInstalledBytesMax: number;
      syncChildSourceBytesMax: number;
      idleChildRssBytesMax: number;
    };
    platformEvidence: Record<string, { childProcessIpc: string; shutdown: string }>;
    setupToolchain: {
      node: { version: string; sha256: string };
      hqCli: { version: string };
      qmd: { version: string };
      yq: { version: string; sha256: string };
      jq: { version: string; sha256: string };
    };
    hqCoreTemplate: { version: string; sha256: string };
    rejectedAdapters: Array<{ package: string; cloudDependency: string; decision: string }>;
    chosenAdapter: { id: string; privateSourceAccess: boolean };
  };
}

function directoryBytes(path: string): number {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) total += directoryBytes(full);
    else if (entry.isFile()) total += statSync(full).size;
  }
  return total;
}

describe('US-008 runtime payload and IPC preflight', () => {
  it('keeps the sync engine payload and adapter source within recorded budgets', () => {
    const manifest = readManifest();
    const cloudRoot = join(root, 'node_modules/@indigoai-us/hq-cloud');
    const cloudBytes = directoryBytes(cloudRoot);
    const syncChildBytes = statSync(join(root, 'src/main/sync-child.ts')).size;

    expect(cloudBytes).toBeGreaterThan(1_000_000);
    expect(cloudBytes).toBeLessThanOrEqual(manifest.payloadBudgets.hqCloudInstalledBytesMax);
    expect(syncChildBytes).toBeGreaterThan(1_000);
    expect(syncChildBytes).toBeLessThanOrEqual(manifest.payloadBudgets.syncChildSourceBytesMax);

    const installed = JSON.parse(
      readFileSync(join(cloudRoot, 'package.json'), 'utf8'),
    ) as { version: string; name: string };
    expect(installed.name).toBe(manifest.syncEngine.package);
    expect(installed.version).toBe(manifest.syncEngine.version);
  });

  it('starts the exact Electron-embedded runtime, exchanges IPC, stops cleanly, and bounds idle RSS', async () => {
    const manifest = readManifest();
    const electron = require('electron') as string;
    const probe = spawnSync(
      electron,
      [
        '-e',
        `const v8=process.memoryUsage(); process.stdout.write(JSON.stringify({node:process.version,rss:v8.rss,execPath:process.execPath}))`,
      ],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' },
        encoding: 'utf8',
        timeout: 15_000,
      },
    );
    expect(probe.status).toBe(0);
    const idle = JSON.parse(probe.stdout.trim()) as { node: string; rss: number; execPath: string };
    expect(idle.execPath).toBe(electron);
    expect(idle.node.startsWith('v')).toBe(true);
    const major = Number(idle.node.slice(1).split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(22);
    expect(major).toBeLessThan(25);
    expect(idle.rss).toBeGreaterThan(1_000_000);
    expect(idle.rss).toBeLessThanOrEqual(manifest.payloadBudgets.idleChildRssBytesMax);

    const child = fork(
      join(root, 'tests/runtime/fixtures/ipc-probe.cjs'),
      [],
      {
        execPath: electron,
        execArgv: [],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1', PATH: '/usr/bin:/bin' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );

    const closed = new Promise<number | null>((resolve) => {
      child.once('close', (code) => resolve(code));
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('IPC probe did not become ready')), 10_000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('message', (message) => {
        clearTimeout(timer);
        if ((message as { type?: string }).type !== 'ready') {
          reject(new Error(`Unexpected probe hello: ${JSON.stringify(message)}`));
          return;
        }
        resolve();
      });
    });

    const reply = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('IPC probe did not answer ping')), 5_000);
      child.once('message', (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
    child.send({ type: 'ping', id: 7 });
    await expect(reply).resolves.toEqual({ type: 'pong', id: 7, runtime: idle.node });

    child.send({ type: 'stop' });
    await expect(closed).resolves.toBe(0);
    expect(child.exitCode).toBe(0);
    expect(child.signalCode).toBeNull();
  }, 30_000);

  it('records adapter rejection of create-hq / hq-onboarding cloud ^5 and chooses the owned path', () => {
    const manifest = readManifest();
    expect(manifest.chosenAdapter.id).toBe('owned-guided-setup');
    expect(manifest.chosenAdapter.privateSourceAccess).toBe(false);
    const rejected = Object.fromEntries(
      manifest.rejectedAdapters.map((item) => [item.package, item]),
    );
    expect(rejected['create-hq']?.decision).toBe('reject');
    expect(rejected['create-hq']?.cloudDependency).toMatch(/\^5/);
    expect(rejected['@indigoai-us/hq-onboarding']?.decision).toBe('reject');
    expect(rejected['@indigoai-us/hq-onboarding']?.cloudDependency).toBe('^5.1.0');

    expect(manifest.platformEvidence.linux.childProcessIpc).toBe('covered');
    expect(manifest.platformEvidence.linux.shutdown).toBe('covered');
    expect(manifest.platformEvidence.windows.childProcessIpc).toBe('deferred');
    expect(manifest.platformEvidence.wsl2.childProcessIpc).toBe('deferred');
  });
});
