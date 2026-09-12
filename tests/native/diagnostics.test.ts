import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertReportRedacted,
  buildDiagnosticsReport,
  diagnoseRuntime,
  formatDiagnosticsPreview,
  redactSensitiveText,
  repairOwnedRuntime,
  runtimeGuidance,
} from '../../src/main/diagnostics';
import { unavailableHealth } from '../../src/main/health/view';

const SYNTHETIC_SECRET = 'sk-liveSECRETVALUE1234';
const SYNTHETIC_PATH = '/home/jane/HQ/companies/acme/settings/vault.json';
const SYNTHETIC_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.signaturemarker';

describe('diagnostics redaction', () => {
  it('removes synthetic secret markers, absolute paths, and JWT-shaped values from free text', () => {
    const poisoned = `EACCES: ${SYNTHETIC_PATH} token=${SYNTHETIC_SECRET} auth=${SYNTHETIC_JWT} Bearer abcdefghijklmnop`;
    const redacted = redactSensitiveText(poisoned);
    expect(redacted).not.toContain(SYNTHETIC_SECRET);
    expect(redacted).not.toContain(SYNTHETIC_PATH);
    expect(redacted).not.toContain('/home/jane');
    expect(redacted).not.toContain(SYNTHETIC_JWT);
    expect(redacted).not.toContain('abcdefghijklmnop');
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).toContain('[PATH]');
  });

  it('builds a preview and saved payload that both omit synthetic markers', () => {
    const report = buildDiagnosticsReport({
      version: '0.1.0-test',
      platform: 'linux',
      workspaceCount: 1,
      workspaceEnvironments: ['linux'],
      runtime: { version: '6.16.35', available: false, node: '22.17.0', diagnosis: 'failed' },
      sync: {
        phase: 'error',
        lastSuccess: null,
        conflicts: 0,
        transport: null,
        pass: null,
        pendingCount: 0,
        message: `Sync failed reading ${SYNTHETIC_PATH} with ${SYNTHETIC_SECRET}`,
      },
      checks: [
        {
          name: 'Bundled runtime',
          state: 'attention',
          detail: `Failed near ${SYNTHETIC_PATH}`,
        },
      ],
      health: unavailableHealth(),
      extras: {
        token: SYNTHETIC_SECRET,
        root: SYNTHETIC_PATH,
        content: 'file body must never export',
      },
    });
    const preview = formatDiagnosticsPreview(report, {
      token: SYNTHETIC_SECRET,
      root: SYNTHETIC_PATH,
      content: 'file body must never export',
      note: `poison ${SYNTHETIC_SECRET} ${SYNTHETIC_PATH}`,
    });
    assertReportRedacted(preview, [SYNTHETIC_SECRET, SYNTHETIC_PATH, '/home/jane', 'file body must never export']);
    expect(preview).not.toContain(SYNTHETIC_SECRET);
    expect(preview).not.toContain(SYNTHETIC_PATH);
    expect(JSON.parse(preview)).toMatchObject({
      app: 'hq-desktop-os',
      runtime: { diagnosis: 'failed' },
      workspaceCount: 1,
    });
    expect(JSON.parse(preview)).not.toHaveProperty('installationId');
  });
});

describe('runtime diagnosis and recovery guidance', () => {
  it('distinguishes missing runtime from failed runtime and exposes retry guidance', () => {
    expect(diagnoseRuntime(false, { code: 'MODULE_NOT_FOUND', message: 'Cannot find module' })).toBe('missing');
    expect(diagnoseRuntime(false, { code: 'EACCES', message: 'permission denied loading runtime' })).toBe('failed');
    expect(diagnoseRuntime(true)).toBe('ok');

    const missing = runtimeGuidance('missing');
    const failed = runtimeGuidance('failed');
    expect(missing.title).toMatch(/missing/i);
    expect(failed.title).toMatch(/failed/i);
    expect(missing.detail).not.toEqual(failed.detail);
    expect(missing.retryAvailable).toBe(true);
    expect(failed.retryAvailable).toBe(true);
    expect(missing.repairAvailable).toBe(true);
    expect(failed.repairAvailable).toBe(true);
    expect(failed.detail).toMatch(/different from a missing install/i);
  });
});

describe('scoped runtime repair', () => {
  it('restores owned toolchain assets while leaving workspace content unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hq-diagnostics-repair-'));
    const toolchain = join(root, 'toolchain');
    const workspace = join(root, 'HQ');
    try {
      await mkdir(workspace, { recursive: true });
      await writeFile(join(workspace, 'keep.txt'), 'user-owned-bytes', { mode: 0o600 });
      const before = await readFile(join(workspace, 'keep.txt'), 'utf8');

      const outcome = await repairOwnedRuntime({
        toolchainDirectory: toolchain,
        workspaceRoots: [workspace],
        prepare: async (directory) => {
          await mkdir(join(directory, 'bin'), { recursive: true });
          await writeFile(join(directory, 'bin', 'hq-runtime'), 'restored', { mode: 0o700 });
          return directory;
        },
      });

      expect(outcome.status).toBe('ready');
      expect(outcome.guidance).toMatch(/workspace files were not changed/i);
      expect(await readFile(join(workspace, 'keep.txt'), 'utf8')).toBe(before);
      expect(await readFile(join(toolchain, 'bin', 'hq-runtime'), 'utf8')).toBe('restored');
      expect(outcome.toolchainMarker).toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never auto-runs unsupported platform repairs', async () => {
    const outcome = await repairOwnedRuntime({
      toolchainDirectory: '/tmp/unused',
      workspaceRoots: [],
      platform: 'win32',
    });
    expect(outcome.status).toBe('unsupported');
    expect(outcome.guidance).toMatch(/not available/i);
  });
});
