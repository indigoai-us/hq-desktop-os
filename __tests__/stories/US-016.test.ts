import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagnoseRuntime, runtimeGuidance } from '../../src/main/diagnostics';
import { snapshotForScenario } from '../../src/renderer/dev/scenarios';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function readJson<T>(rel: string): T {
  return JSON.parse(read(rel)) as T;
}

describe('US-016 Redacted diagnostics and recovery guidance', () => {
  it('ships the PRD diagnostics modules', () => {
    for (const rel of [
      'src/main/diagnostics.ts',
      'src/renderer/screens/settings.tsx',
      'tests/native/diagnostics.test.ts',
    ]) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }

    const diagnostics = read('src/main/diagnostics.ts');
    expect(diagnostics).toContain('redactSensitiveText');
    expect(diagnostics).toContain('buildDiagnosticsReport');
    expect(diagnostics).toContain('formatDiagnosticsPreview');
    expect(diagnostics).toContain('repairOwnedRuntime');
    expect(diagnostics).toContain('diagnoseRuntime');

    const settings = read('src/renderer/screens/settings.tsx');
    expect(settings).toContain('preview-diagnostics');
    expect(settings).toContain('export-diagnostics');
    expect(settings).toContain('repair-runtime');
    expect(settings).toContain('diagnostics-preview');
    expect(settings).toContain('Nothing is sent automatically');

    const shared = read('src/shared/companion.ts');
    expect(shared).toContain('preview-diagnostics');
    expect(shared).toContain('dismiss-diagnostics-preview');
    expect(shared).toContain('repair-runtime');
    expect(shared).toContain('diagnosticsPreview');
  });

  it('distinguishes failing runtime from missing data with retry guidance in fixtures', () => {
    expect(diagnoseRuntime(false, { code: 'MODULE_NOT_FOUND' })).toBe('missing');
    expect(diagnoseRuntime(false, { code: 'EACCES', message: 'corrupt runtime' })).toBe('failed');
    expect(runtimeGuidance('failed').detail).toMatch(/different from a missing install/i);

    const missing = snapshotForScenario('runtime-missing');
    const failed = snapshotForScenario('runtime-failed');
    expect(missing.runtimeRepair?.diagnosis).toBe('missing');
    expect(failed.runtimeRepair?.diagnosis).toBe('failed');
    expect(missing.runtimeRepair?.guidance).not.toEqual(failed.runtimeRepair?.guidance);
    expect(failed.diagnostics.find((item) => item.name === 'Bundled runtime')?.state).toBe('attention');
    expect(missing.diagnostics.find((item) => item.name === 'Bundled runtime')?.state).toBe('unavailable');
  });

  it('wires companion export through redacted preview and scoped repair', () => {
    const companion = read('src/main/companion.ts');
    expect(companion).toContain('buildDiagnosticsPreview');
    expect(companion).toContain('assertReportRedacted');
    expect(companion).toContain('repairOwnedRuntime');
    expect(companion).toContain('preview-diagnostics');
    expect(companion).toContain('repair-runtime');
    expect(companion).not.toMatch(/upload.*diagnostics|support message/i);
  });

  it('records Linux diagnostics coverage and defers Windows/WSL native acceptance', () => {
    const manifest = readJson<{
      platformEvidence: {
        linux: { diagnostics?: string; notes?: string };
        windows: { diagnostics?: string };
        wsl2: { diagnostics?: string };
      };
    }>('runtime/manifest.json');
    expect(manifest.platformEvidence.linux.diagnostics).toBe('covered');
    expect(manifest.platformEvidence.windows.diagnostics).toBe('deferred');
    expect(manifest.platformEvidence.wsl2.diagnostics).toBe('deferred');
    expect(manifest.platformEvidence.linux.notes).toMatch(/US-016/);

    const docs = read('docs/platform-boundary.md');
    expect(docs).toContain('Redacted diagnostics and recovery guidance (US-016 Linux slice)');
    expect(docs).toContain('preview');
    expect(docs).toContain('repair');
  });
});
