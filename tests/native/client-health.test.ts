import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLIENT_HEALTH_CLIENT_NAME,
  ClientHealthContractError,
  parseClientHealthHeartbeat,
  shouldApplyHeartbeat,
} from '../../src/main/health/contract';
import { HEALTH_HEARTBEAT_FIXTURES } from '../../src/main/health/fixtures';
import { HealthReporter } from '../../src/main/health/reporter';
import { HealthStateStore } from '../../src/main/health/state';

describe('client-health contract', () => {
  it('attributes this companion as hq-desktop-os, not hq-desktop-app or hq-sync', () => {
    expect(CLIENT_HEALTH_CLIENT_NAME).toBe('hq-desktop-os');
    expect(CLIENT_HEALTH_CLIENT_NAME).not.toBe('hq-desktop-app');
    expect(CLIENT_HEALTH_CLIENT_NAME).not.toBe('hq-sync');
  });

  it('accepts scaffold heartbeat fixtures', () => {
    for (const [name, fixture] of Object.entries(HEALTH_HEARTBEAT_FIXTURES)) {
      expect(parseClientHealthHeartbeat(structuredClone(fixture)), name).toEqual(fixture);
    }
  });

  it('rejects path-shaped, secret-shaped and unknown enum values', () => {
    expect(() => parseClientHealthHeartbeat({
      ...HEALTH_HEARTBEAT_FIXTURES.healthy,
      installationId: '/home/secret',
    })).toThrow(ClientHealthContractError);
    expect(() => parseClientHealthHeartbeat({
      ...HEALTH_HEARTBEAT_FIXTURES.healthy,
      installationId: 'ghp_notatokenbutprefix',
    })).toThrow(ClientHealthContractError);
    expect(() => parseClientHealthHeartbeat({
      ...HEALTH_HEARTBEAT_FIXTURES.healthy,
      syncState: 'wsl',
    })).toThrow(ClientHealthContractError);
  });

  it('keeps heartbeat sequences monotonic', () => {
    expect(shouldApplyHeartbeat(undefined, 1)).toBe(true);
    expect(shouldApplyHeartbeat(10, 11)).toBe(true);
    expect(shouldApplyHeartbeat(10, 10)).toBe(false);
    expect(shouldApplyHeartbeat(10, 9)).toBe(false);
  });
});

describe('client-health state + reporter', () => {
  it('persists installation id and advances sequence without sending when disabled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-health-state-'));
    try {
      const state = new HealthStateStore(directory);
      await state.load();
      const firstId = state.snapshot.installationId;
      expect(firstId.length).toBeGreaterThanOrEqual(8);

      let sent = 0;
      const reporter = new HealthReporter({
        state,
        reportingEnabled: false,
        authToken: null,
        appVersion: '0.1.0',
        transport: {
          async sendHeartbeat() { sent += 1; },
        },
      });
      const one = await reporter.report({
        versions: {},
        syncState: 'never_synced',
        consecutiveFailures: 0,
        updaterState: 'unsupported',
      });
      const two = await reporter.report({
        versions: {},
        syncState: 'idle',
        consecutiveFailures: 0,
        updaterState: 'unsupported',
      });
      expect(one?.sequence).toBe(1);
      expect(two?.sequence).toBe(2);
      expect(sent).toBe(0);

      const restored = new HealthStateStore(directory);
      await restored.load();
      expect(restored.snapshot.installationId).toBe(firstId);
      expect(restored.snapshot.sequence).toBe(2);
      reporter.dispose();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('never throws transport failures to the caller', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-health-transport-'));
    try {
      const state = new HealthStateStore(directory);
      await state.load();
      const reporter = new HealthReporter({
        state,
        reportingEnabled: true,
        authToken: 'test-token',
        appVersion: '0.1.0',
        transport: {
          async sendHeartbeat() { throw new Error('network down'); },
        },
      });
      await expect(reporter.report({
        versions: {},
        syncState: 'idle',
        consecutiveFailures: 0,
      })).resolves.toMatchObject({ sequence: 1 });
      reporter.dispose();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
