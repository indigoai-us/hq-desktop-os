import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const require = createRequire(import.meta.url);

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function readJson<T>(rel: string): T {
  return JSON.parse(read(rel)) as T;
}

describe('US-008 pinned HQ runtime and setup dependency preflight', () => {
  it('pins public hq-cloud >= 6.16.35 exactly with integrity and no floating launch path', () => {
    expect(existsSync(join(root, 'runtime/manifest.json'))).toBe(true);
    expect(existsSync(join(root, 'scripts/prepare-runtime.mjs'))).toBe(true);
    expect(existsSync(join(root, 'docs/runtime-contract.md'))).toBe(true);
    expect(existsSync(join(root, 'tests/runtime/payload.test.ts'))).toBe(true);

    const manifest = readJson<{
      syncEngine: { version: string; integrity: string };
      hostRuntime: { bundledNodePolicy: string };
    }>('runtime/manifest.json');
    expect(manifest.syncEngine.version).toBe('6.16.35');
    expect(manifest.syncEngine.integrity.startsWith('sha512-')).toBe(true);
    expect(manifest.hostRuntime.bundledNodePolicy).toMatch(/ELECTRON_RUN_AS_NODE|embedded Node/i);

    const pkg = readJson<{
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    }>('package.json');
    expect(pkg.dependencies['@indigoai-us/hq-cloud']).toBe('6.16.35');
    expect(pkg.scripts['prepare:runtime']).toBe('node scripts/prepare-runtime.mjs');

    const lock = read('pnpm-lock.yaml');
    expect(lock).toContain("'@indigoai-us/hq-cloud@6.16.35'");
    expect(lock).toContain(manifest.syncEngine.integrity);

    const installed = readJson<{ version: string }>(
      'node_modules/@indigoai-us/hq-cloud/package.json',
    );
    expect(installed.version).toBe('6.16.35');

    const setup = read('src/main/setup.ts');
    const deps = read('src/main/setup-dependencies.ts');
    const syncChild = read('src/main/sync-child.ts');
    expect(setup).not.toMatch(/\bnpx\b/);
    expect(deps).not.toMatch(/\bnpx\b/);
    expect(syncChild).not.toMatch(/\bnpx\b/);
    expect(syncChild).toContain('@indigoai-us/hq-cloud');
    expect(read('src/main/companion.ts')).toContain("version: '6.16.35'");
  });

  it('records the onboarding audit, licenses, and owned adapter choice before setup', () => {
    const manifest = readJson<{
      rejectedAdapters: Array<{ package: string; cloudDependency: string; decision: string }>;
      chosenAdapter: { id: string; privateSourceAccess: boolean; syncEngine: string };
      setupToolchain: {
        node: { version: string; sha256: string; license: string };
        hqCli: { version: string; license: string };
        qmd: { version: string };
        yq: { version: string; sha256: string };
        jq: { version: string; sha256: string };
        git: { requirement: string };
      };
      hqCoreTemplate: { version: string; sha256: string };
    }>('runtime/manifest.json');

    expect(manifest.chosenAdapter.id).toBe('owned-guided-setup');
    expect(manifest.chosenAdapter.privateSourceAccess).toBe(false);
    expect(manifest.chosenAdapter.syncEngine).toBe('@indigoai-us/hq-cloud@6.16.35');

    const rejected = Object.fromEntries(
      manifest.rejectedAdapters.map((item) => [item.package, item]),
    );
    expect(rejected['create-hq']?.decision).toBe('reject');
    expect(rejected['create-hq']?.cloudDependency).toMatch(/^(\^5)/);
    expect(rejected['@indigoai-us/hq-onboarding']?.cloudDependency).toBe('^5.1.0');

    expect(manifest.setupToolchain.node.version).toBe('22.17.0');
    expect(manifest.setupToolchain.hqCli.version).toBe('5.109.6');
    expect(manifest.setupToolchain.qmd.version).toBe('2.5.3');
    expect(manifest.setupToolchain.yq.version).toBe('4.47.1');
    expect(manifest.setupToolchain.jq.version).toBe('1.8.1');
    expect(manifest.setupToolchain.git.requirement).toBe('system');
    expect(manifest.hqCoreTemplate.version).toBe('15.0.126');

    const setup = read('src/main/setup.ts');
    const deps = read('src/main/setup-dependencies.ts');
    expect(setup).toContain(`version: '${manifest.hqCoreTemplate.version}'`);
    expect(setup).toContain(manifest.hqCoreTemplate.sha256);
    expect(deps).toContain(`node: '${manifest.setupToolchain.node.version}'`);
    expect(deps).toContain(`hq: '${manifest.setupToolchain.hqCli.version}'`);
    expect(deps).toContain(manifest.setupToolchain.node.sha256);
    expect(deps).toContain(manifest.setupToolchain.yq.sha256);
    expect(deps).toContain(manifest.setupToolchain.jq.sha256);

    const docs = read('docs/runtime-contract.md');
    expect(docs).toContain('create-hq');
    expect(docs).toContain('hq-onboarding');
    expect(docs).toContain('^5.1.0');
    expect(docs).toContain('MIT');
    expect(docs).toContain('owned guided setup');
  });

  it('prepare-runtime resolves Electron embedded Node without global Node or npx', () => {
    const result = spawnSync(process.execPath, [join(root, 'scripts/prepare-runtime.mjs')], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: '1' },
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/hq-cloud 6\.16\.35/);
    expect(result.stdout).toMatch(/Electron Node v\d+/);

    const report = readJson<{
      syncEngine: { version: string };
      host: { embeddedNode: string; electronPath: string };
      noGlobalNodeRequired: boolean;
      noFloatingNpx: boolean;
      platformEvidence: { linux: { childProcessIpc: string }; windows: { childProcessIpc: string } };
    }>('.scratch/runtime-resolved.json');
    expect(report.syncEngine.version).toBe('6.16.35');
    expect(report.noGlobalNodeRequired).toBe(true);
    expect(report.noFloatingNpx).toBe(true);
    expect(report.host.electronPath).toBe(require('electron'));
    expect(report.platformEvidence.linux.childProcessIpc).toBe('covered');
    expect(report.platformEvidence.windows.childProcessIpc).toBe('deferred');
  });
});
