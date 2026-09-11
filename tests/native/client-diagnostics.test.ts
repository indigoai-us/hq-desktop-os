import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HealthCommandLedger } from '../../src/main/health/commands';
import { PROBE_TIMEOUT_MS, runHealthProbes } from '../../src/main/health/probes';
import { companionHealthFromResults } from '../../src/main/health/view';
import { HEALTH_PREVIEW_FIXTURES } from '../../src/shared/health-fixtures';

describe('client-health probes', () => {
  it('returns skip for unsupported components instead of invented passes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-health-probes-'));
    try {
      const results = await runHealthProbes({
        signedIn: false,
        runnerAvailable: false,
        cliAvailable: false,
        coreAvailable: false,
        updaterSupported: false,
        syncPhase: 'not-connected',
        conflictCount: 0,
        storageWritable: true,
        permissionsProbeDirectory: directory,
      });
      expect(results).toHaveLength(9);
      expect(results.find((result) => result.check === 'auth')?.status).toBe('skip');
      expect(results.find((result) => result.check === 'cli')?.status).toBe('skip');
      expect(results.find((result) => result.check === 'updater')?.status).toBe('skip');
      expect(results.find((result) => result.check === 'permissions')?.status).toBe('pass');
      expect(results.every((result) => result.status !== 'pass' || ['storage', 'permissions'].includes(result.check))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('bounds hung probes to 10s and marks them skip', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-health-timeout-'));
    try {
      const started = Date.now();
      const results = await runHealthProbes({
        signedIn: true,
        runnerAvailable: true,
        cliAvailable: false,
        coreAvailable: true,
        updaterSupported: false,
        syncPhase: 'idle',
        conflictCount: 0,
        storageWritable: true,
        permissionsProbeDirectory: directory,
        overrides: {
          runner: () => new Promise(() => { /* never settles */ }),
        },
      });
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(PROBE_TIMEOUT_MS - 50);
      expect(elapsed).toBeLessThan(PROBE_TIMEOUT_MS + 2_000);
      expect(results.find((result) => result.check === 'runner')?.status).toBe('skip');
      expect(results.find((result) => result.check === 'auth')?.status).toBe('pass');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});

describe('client-health command ledger', () => {
  it('transitions CHECK_NOW through acknowledged → running → terminal and rejects expired commands', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-health-commands-'));
    try {
      const now = new Date('2026-09-11T12:00:00.000Z');
      const ledger = new HealthCommandLedger(directory, () => new Date(now));
      await ledger.load();

      const accepted = await ledger.accept({
        commandId: 'cmd-checknow01',
        installationId: 'inst-hqdos01a2b3',
        kind: 'CHECK_NOW',
        issuedAt: '2026-09-11T11:59:00.000Z',
        expiresAt: '2026-09-11T13:00:00.000Z',
      });
      expect(accepted.state).toBe('acknowledged');

      const receipt = await ledger.execute('cmd-checknow01', 'inst-hqdos01a2b3', {
        signedIn: true,
        runnerAvailable: true,
        cliAvailable: false,
        coreAvailable: true,
        updaterSupported: false,
        syncPhase: 'idle',
        conflictCount: 0,
        storageWritable: true,
        permissionsProbeDirectory: directory,
      });
      expect(['succeeded', 'failed']).toContain(receipt.state);
      expect(receipt.checks?.length).toBe(9);
      expect(receipt.kind).toBe('CHECK_NOW');

      const expired = await ledger.accept({
        commandId: 'cmd-expired001',
        installationId: 'inst-hqdos01a2b3',
        kind: 'CHECK_NOW',
        issuedAt: '2026-09-11T10:00:00.000Z',
        expiresAt: '2026-09-11T11:00:00.000Z',
      });
      expect(expired.state).toBe('expired');

      const mutating = await ledger.accept({
        commandId: 'cmd-repair0001',
        installationId: 'inst-hqdos01a2b3',
        kind: 'RESTART_APP',
        issuedAt: '2026-09-11T11:59:00.000Z',
        expiresAt: '2026-09-11T13:00:00.000Z',
      });
      const failed = await ledger.execute('cmd-repair0001', 'inst-hqdos01a2b3', {
        signedIn: true,
        runnerAvailable: true,
        cliAvailable: false,
        coreAvailable: true,
        updaterSupported: false,
        syncPhase: 'idle',
        conflictCount: 0,
        storageWritable: true,
        permissionsProbeDirectory: directory,
      });
      expect(mutating.state).toBe('acknowledged');
      expect(failed.state).toBe('failed');
      expect(failed.failureReason).toBe('MANUAL_ACTION_REQUIRED');
      expect(failed.manualActionRequired).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('health UI fixtures', () => {
  it('covers healthy, degraded, stale and checking preview states', () => {
    expect(HEALTH_PREVIEW_FIXTURES.healthy.overall).toBe('healthy');
    expect(HEALTH_PREVIEW_FIXTURES.degraded.overall).toBe('degraded');
    expect(HEALTH_PREVIEW_FIXTURES.stale.overall).toBe('stale');
    expect(HEALTH_PREVIEW_FIXTURES.checking.overall).toBe('checking');
    expect(HEALTH_PREVIEW_FIXTURES.healthy.clientName).toBe('hq-desktop-os');
    expect(companionHealthFromResults([
      { check: 'auth', status: 'pass' },
      { check: 'runner', status: 'pass' },
      { check: 'cli', status: 'skip' },
      { check: 'core', status: 'pass' },
      { check: 'updater', status: 'skip' },
      { check: 'sync', status: 'fail', reason: 'CONFLICT_BLOCKED' },
      { check: 'conflicts', status: 'fail', reason: 'CONFLICT_BLOCKED' },
      { check: 'storage', status: 'pass' },
      { check: 'permissions', status: 'pass' },
    ]).overall).toBe('degraded');
  });
});
