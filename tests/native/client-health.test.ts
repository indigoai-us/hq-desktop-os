import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLIENT_HEALTH_ATTRIBUTION_HEADER,
  CLIENT_HEALTH_CLIENT_NAME,
  ClientHealthContractError,
  parseClientHealthHeartbeat,
  shouldApplyHeartbeat,
} from '../../src/main/health/contract';
import { buildCompanionHeartbeatFacts } from '../../src/main/health/facts';
import { HEALTH_HEARTBEAT_FIXTURES } from '../../src/main/health/fixtures';
import {
  cachedLocalFilesOverview,
  collectLocalFilesOverview,
  countRecentErrorLines,
} from '../../src/main/health/local-files';
import { HealthReporter } from '../../src/main/health/reporter';
import {
  CLIENT_HEALTH_HEARTBEAT_INTERVAL_MS,
  HealthHeartbeatScheduler,
} from '../../src/main/health/scheduler';
import { HealthStateStore } from '../../src/main/health/state';
import {
  clientHealthAttributionHeaders,
  HttpHealthTransport,
  isClientHealthReportingEnabled,
} from '../../src/main/health/transport';

describe('client-health contract', () => {
  it('attributes this companion as hq-desktop-os, not hq-desktop-app or hq-sync', () => {
    expect(CLIENT_HEALTH_CLIENT_NAME).toBe('hq-desktop-os');
    expect(CLIENT_HEALTH_CLIENT_NAME).not.toBe('hq-desktop-app');
    expect(CLIENT_HEALTH_CLIENT_NAME).not.toBe('hq-sync');
    expect(CLIENT_HEALTH_ATTRIBUTION_HEADER).toBe('x-hq-client-name');
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
  it('persists installation id under an environment-scoped userData path, never ~/.hq', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-health-state-'));
    try {
      const native = new HealthStateStore(directory, { environment: 'native' });
      const wsl = new HealthStateStore(directory, { environment: 'wsl2' });
      await native.load();
      await wsl.load();
      expect(native.filePath).toContain(`${join('client-health', 'native')}`);
      expect(wsl.filePath).toContain(`${join('client-health', 'wsl2')}`);
      expect(native.filePath).not.toContain('.hq');
      expect(native.snapshot.installationId).not.toBe(wsl.snapshot.installationId);

      await native.nextSequence(1_000);
      await wsl.nextSequence(2_000);
      expect(native.snapshot.sequence).toBe(1_000);
      expect(wsl.snapshot.sequence).toBe(2_000);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

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
      expect(one?.sequence).toBeGreaterThan(0);
      expect(two?.sequence).toBeGreaterThan(one!.sequence);
      expect(sent).toBe(0);

      const restored = new HealthStateStore(directory);
      await restored.load();
      expect(restored.snapshot.installationId).toBe(firstId);
      expect(restored.snapshot.sequence).toBe(two!.sequence);
      reporter.dispose();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps attempt, success and engine watermark distinct', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-health-outcomes-'));
    try {
      const state = new HealthStateStore(directory);
      await state.load();
      await state.recordSyncAttempt('2026-09-11T10:00:00.000Z');
      await state.recordEngineWatermark('2026-09-11T10:01:00.000Z');
      expect(state.snapshot.lastSyncSuccessAt).toBeNull();
      expect(state.snapshot.syncEngineWatermarkAt).toBe('2026-09-11T10:01:00.000Z');
      await state.recordSyncSuccess('2026-09-11T10:02:00.000Z');
      expect(state.snapshot.lastSyncSuccessAt).toBe('2026-09-11T10:02:00.000Z');
      expect(state.snapshot.syncEngineWatermarkAt).toBe('2026-09-11T10:01:00.000Z');
      await state.recordSyncFailure();
      expect(state.snapshot.consecutiveFailures).toBe(1);

      const facts = buildCompanionHeartbeatFacts({
        sync: {
          phase: 'idle',
          lastSuccess: '2026-09-11T10:02:00.000Z',
          message: 'ok',
          conflicts: 0,
          conflictPaths: [],
          transport: 'realtime',
          pass: null,
          pendingCount: 0,
        },
        healthState: state.snapshot,
        updaterState: 'unchecked',
      });
      expect(facts.lastSyncSuccessAt).toBe('2026-09-11T10:02:00.000Z');
      expect(facts.syncEngineWatermarkAt).toBe('2026-09-11T10:01:00.000Z');
      expect(facts.lastSyncAttemptAt).toBe('2026-09-11T10:00:00.000Z');
      expect(facts.syncState).toBe('idle');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('never throws transport failures to the caller and attributes live sends', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-health-transport-'));
    try {
      const state = new HealthStateStore(directory);
      await state.load();
      const headers: Record<string, string>[] = [];
      const reporter = new HealthReporter({
        state,
        reportingEnabled: true,
        authToken: 'test-token',
        appVersion: '0.1.0',
        transport: {
          async sendHeartbeat(_payload, sentHeaders) {
            headers.push(sentHeaders);
            throw new Error('network down');
          },
        },
      });
      await expect(reporter.report({
        versions: {},
        syncState: 'idle',
        consecutiveFailures: 0,
      })).resolves.toMatchObject({ syncState: 'idle' });
      expect(headers[0]?.[CLIENT_HEALTH_ATTRIBUTION_HEADER]).toBe('hq-desktop-os');
      expect(headers[0]?.Authorization).toBe('Bearer test-token');
      reporter.dispose();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps production reporting gated off by default', () => {
    expect(isClientHealthReportingEnabled({})).toBe(false);
    expect(isClientHealthReportingEnabled({ HQ_CLIENT_HEALTH_REPORTING: '1' })).toBe(true);
    expect(isClientHealthReportingEnabled({ HQ_CLIENT_HEALTH_REPORTING: '0' })).toBe(false);
  });
});

describe('client-health local files overview', () => {
  it('returns only bounded metadata and never embeds paths or log text', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-health-files-'));
    try {
      const syncLog = join(directory, 'hq-sync.log');
      const journal = join(directory, 'journal.json');
      await writeFile(syncLog, 'info ok\nERROR boom\n{"level":"error","msg":"x"}\n');
      await writeFile(journal, '{"ok":true}\n');
      const overview = collectLocalFilesOverview({
        syncLogPath: syncLog,
        journalPaths: [journal],
        nowMs: Date.now(),
      });
      expect(overview.syncLogExists).toBe(true);
      expect(overview.journalExists).toBe(true);
      expect(overview.recentErrorLineCount).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(overview)).not.toContain(directory);
      expect(JSON.stringify(overview)).not.toContain('boom');
      expect(countRecentErrorLines(syncLog)).toBe(2);

      const first = cachedLocalFilesOverview(null, { syncLogPath: syncLog, journalPaths: [journal], nowMs: 1_000 });
      const second = cachedLocalFilesOverview(first.cache, { syncLogPath: syncLog, journalPaths: [journal], nowMs: 2_000 });
      expect(second.overview).toEqual(first.overview);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('client-health scheduler', () => {
  it('emits on startup, interval, and debounced health changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-health-sched-'));
    try {
      const state = new HealthStateStore(directory);
      await state.load();
      const emits: number[] = [];
      const reporter = new HealthReporter({
        state,
        reportingEnabled: false,
        appVersion: '0.1.0',
        now: () => new Date('2026-09-11T12:00:00.000Z'),
      });
      const originalReport = reporter.report.bind(reporter);
      reporter.report = async (facts) => {
        emits.push(1);
        return originalReport(facts);
      };

      const timers: Array<{ kind: 'interval' | 'timeout'; fn: () => void }> = [];
      const scheduler = new HealthHeartbeatScheduler({
        reporter,
        facts: () => ({
          versions: {},
          syncState: 'idle',
          consecutiveFailures: 0,
        }),
        intervalMs: 50,
        debounceMs: 5,
        setIntervalFn: ((fn: () => void) => {
          timers.push({ kind: 'interval', fn });
          return 1 as unknown as NodeJS.Timeout;
        }) as typeof setInterval,
        clearIntervalFn: (() => undefined) as typeof clearInterval,
        setTimeoutFn: ((fn: () => void) => {
          timers.push({ kind: 'timeout', fn });
          return 2 as unknown as NodeJS.Timeout;
        }) as typeof setTimeout,
        clearTimeoutFn: (() => undefined) as typeof clearTimeout,
      });

      scheduler.start();
      await vi.waitFor(() => expect(emits.length).toBeGreaterThanOrEqual(1));
      const interval = timers.find((timer) => timer.kind === 'interval');
      expect(interval).toBeTruthy();
      interval!.fn();
      await vi.waitFor(() => expect(emits.length).toBeGreaterThanOrEqual(2));
      scheduler.notifyHealthChanged();
      const debounce = timers.filter((timer) => timer.kind === 'timeout').at(-1);
      expect(debounce).toBeTruthy();
      debounce!.fn();
      await vi.waitFor(() => expect(emits.length).toBeGreaterThanOrEqual(3));
      expect(CLIENT_HEALTH_HEARTBEAT_INTERVAL_MS).toBe(5 * 60_000);
      scheduler.stop();
      reporter.dispose();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('client-health http transport', () => {
  it('posts to /v1/client-health/heartbeat with attribution headers', async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const transport = new HttpHealthTransport({
      baseUrl: 'https://hqapi.example.test',
      fetchImpl: (async (url, init) => {
        calls.push({
          url: String(url),
          headers: init?.headers as Record<string, string>,
          body: String(init?.body),
        });
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
    });
    await transport.sendHeartbeat(
      HEALTH_HEARTBEAT_FIXTURES.healthy,
      clientHealthAttributionHeaders('0.1.0', 'tok'),
    );
    expect(calls[0]?.url).toBe('https://hqapi.example.test/v1/client-health/heartbeat');
    expect(calls[0]?.headers[CLIENT_HEALTH_ATTRIBUTION_HEADER]).toBe('hq-desktop-os');
    expect(JSON.parse(calls[0]!.body).installationId).toBe(HEALTH_HEARTBEAT_FIXTURES.healthy.installationId);
  });
});

describe('client-health legacy state migration', () => {
  it('lifts the flat scaffold file into the environment-scoped path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-health-legacy-'));
    try {
      await writeFile(join(directory, 'client-health-state.json'), `${JSON.stringify({
        version: 1,
        installationId: 'legacyinst01ab',
        sequence: 7,
        lastHeartbeatAt: '2026-09-11T11:00:00.000Z',
        lastProbeAt: null,
      }, null, 2)}\n`);
      const state = new HealthStateStore(directory, { environment: 'native' });
      await state.load();
      expect(state.snapshot.installationId).toBe('legacyinst01ab');
      expect(state.snapshot.sequence).toBe(7);
      expect(state.snapshot.consecutiveFailures).toBe(0);
      const persisted = JSON.parse(await readFile(state.filePath, 'utf8')) as { installationId: string };
      expect(persisted.installationId).toBe('legacyinst01ab');
      await mkdir(join(directory, 'client-health', 'native'), { recursive: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
