import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function readJson<T>(rel: string): T {
  return JSON.parse(read(rel)) as T;
}

describe('US-009 workspace registry and environment selection', () => {
  it('ships the PRD registry/platform modules and Linux atomic persistence contract', () => {
    for (const rel of [
      'src/main/workspaces.ts',
      'src/main/platform/native.ts',
      'src/main/platform/wsl-discovery.ts',
      'src/shared/workspace.ts',
      'tests/native/workspaces.test.ts',
    ]) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }

    const shared = read('src/shared/workspace.ts');
    expect(shared).toContain("WORKSPACE_ENVIRONMENTS = ['linux', 'windows', 'wsl2']");
    expect(shared).toContain('wslDistro');
    expect(shared).toContain('installationId');

    const registry = read('src/main/workspaces.ts');
    expect(registry).toContain('workspaces.json');
    expect(registry).toContain('assertReadableWritableDirectory');
    expect(registry).toContain('already registered as a');
    expect(registry).toContain('mode: 0o600');
    expect(registry).toContain('rename(`${path}.tmp`, path)');

    const native = read('src/main/platform/native.ts');
    expect(native).toContain('realpath');
    expect(native).toContain('R_OK');
    expect(native).toContain('W_OK');
    expect(native).toContain('companies');
    expect(native).toContain('core');
  });

  it('lists WSL via bounded argument arrays and keeps Linux hosts fail-closed', () => {
    const discovery = read('src/main/platform/wsl-discovery.ts');
    expect(discovery).toContain("runner('wsl.exe', ['--list', '--verbose'])");
    expect(discovery).toContain('shell: false');
    expect(discovery).toContain("platform !== 'win32'");
    expect(discovery).toContain('WSL1 is not supported');
    expect(discovery).toContain("status: 'missing'");
    expect(discovery).toContain("status: 'stopped'");
    expect(discovery).toContain("status: 'unavailable'");

    const tests = read('tests/native/workspaces.test.ts');
    expect(tests).toContain('persists root, environment, installation identity');
    expect(tests).toContain('dual ownership');
    expect(tests).toContain('actionable unavailable state on non-Windows');
    expect(tests).toContain('rejects WSL1');
  });

  it('records Linux registry coverage and deferred live Windows/WSL evidence', () => {
    const manifest = readJson<{
      platformEvidence: {
        linux: { workspaceRegistry: string };
        windows: { workspaceRegistry: string };
        wsl2: { workspaceRegistry: string; discovery: string };
      };
    }>('runtime/manifest.json');
    expect(manifest.platformEvidence.linux.workspaceRegistry).toBe('covered');
    expect(manifest.platformEvidence.windows.workspaceRegistry).toBe('deferred');
    expect(manifest.platformEvidence.wsl2.workspaceRegistry).toBe('deferred');
    expect(manifest.platformEvidence.wsl2.discovery).toBe('contract-only');

    const docs = read('docs/platform-boundary.md');
    expect(docs).toContain('Workspace registry (US-009 Linux slice)');
    expect(docs).toContain('Live WSL2 discovery');
    expect(docs).toContain('does not invent a Linux WSL runtime');
  });
});
