import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_HEALTH_CLIENT_NAME,
  CLIENT_HEALTH_ATTRIBUTION_HEADER,
} from '../../src/main/health/contract';
import { CLIENT_HEALTH_HEARTBEAT_INTERVAL_MS } from '../../src/main/health/scheduler';
import { isClientHealthReportingEnabled } from '../../src/main/health/transport';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function readJson<T>(rel: string): T {
  return JSON.parse(read(rel)) as T;
}

describe('US-022 Shared client-health contract and heartbeat reporting', () => {
  it('ships the PRD health contract, reporter, state, and native tests', () => {
    for (const rel of [
      'src/main/health/contract.ts',
      'src/main/health/reporter.ts',
      'src/main/health/state.ts',
      'src/main/health/facts.ts',
      'src/main/health/local-files.ts',
      'src/main/health/scheduler.ts',
      'src/main/health/transport.ts',
      'tests/native/client-health.test.ts',
      'docs/client-health.md',
    ]) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }

    expect(CLIENT_HEALTH_CLIENT_NAME).toBe('hq-desktop-os');
    expect(CLIENT_HEALTH_ATTRIBUTION_HEADER).toBe('x-hq-client-name');
    expect(CLIENT_HEALTH_HEARTBEAT_INTERVAL_MS).toBe(5 * 60_000);
    expect(isClientHealthReportingEnabled({})).toBe(false);
  });

  it('persists isolated install identity/sequence and builds gated heartbeats', () => {
    const state = read('src/main/health/state.ts');
    expect(state).toContain('client-health');
    expect(state).toContain('nextSequence');
    expect(state).toContain('recordSyncAttempt');
    expect(state).toContain('recordSyncSuccess');
    expect(state).toContain('syncEngineWatermarkAt');
    expect(state).toContain("environment?: HealthEnvironmentKey");
    expect(state).not.toContain("join(homedir");
    expect(state).not.toMatch(/['"]\.hq['"].*client-health/);

    const reporter = read('src/main/health/reporter.ts');
    expect(reporter).toContain('buildHeartbeat');
    expect(reporter).toContain('reportingEnabled');
    expect(reporter).toContain('localFilesOverview');

    const scheduler = read('src/main/health/scheduler.ts');
    expect(scheduler).toContain('CLIENT_HEALTH_HEARTBEAT_INTERVAL_MS');
    expect(scheduler).toContain('notifyHealthChanged');
    expect(scheduler).toContain('startup');

    const transport = read('src/main/health/transport.ts');
    expect(transport).toContain('HQ_CLIENT_HEALTH_REPORTING');
    expect(transport).toContain('/v1/client-health/heartbeat');
    expect(transport).toContain('DisabledHealthTransport');

    const companion = read('src/main/companion.ts');
    expect(companion).toContain('HealthHeartbeatScheduler');
    expect(companion).toContain('setReportingEnabled(false, null)');
    expect(companion).toContain('isClientHealthReportingEnabled');
    expect(companion).toContain('healthEnvironmentKey');
  });

  it('records Linux contract coverage and defers live support-view proof', () => {
    const manifest = readJson<{
      platformEvidence: {
        linux: { clientHealth?: string; notes?: string };
        windows: { clientHealth?: string };
        wsl2: { clientHealth?: string; notes?: string };
      };
    }>('runtime/manifest.json');
    expect(manifest.platformEvidence.linux.clientHealth).toBe('covered');
    expect(manifest.platformEvidence.windows.clientHealth).toBe('deferred');
    expect(manifest.platformEvidence.wsl2.clientHealth).toBe('deferred');
    expect(manifest.platformEvidence.linux.notes).toMatch(/US-022/);
    expect(manifest.platformEvidence.linux.notes).toMatch(/support-view|Live support-view|live heartbeat/i);

    const docs = read('docs/client-health.md');
    expect(docs).toContain('hq-desktop-os');
    expect(docs).toContain('HQ_CLIENT_HEALTH_REPORTING');
    expect(docs).toMatch(/default off|gated/i);

    const boundary = read('docs/platform-boundary.md');
    expect(boundary).toContain('Shared client-health contract and heartbeat reporting (US-022');
    expect(boundary).toContain('hq-desktop-os');
  });
});
