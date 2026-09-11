import type { ClientHealthCheckResult, ClientHealthHeartbeat } from './contract.js';
import type { HealthUiState } from './probes.js';

/** Public scaffold fixtures — UI/preview evidence only, not live support proof. */
export const HEALTH_HEARTBEAT_FIXTURES = {
  healthy: {
    contractVersion: 1,
    installationId: 'inst-hqdos01a2b3',
    source: 'desktop',
    platform: 'linux',
    arch: 'x64',
    sentAt: '2026-09-11T12:00:00.000Z',
    sequence: 12,
    versions: { desktop: '0.1.0-local.2', syncRunner: '6.16.35' },
    syncState: 'idle',
    lastSyncAttemptAt: '2026-09-11T11:55:00.000Z',
    lastSyncSuccessAt: '2026-09-11T11:55:00.000Z',
    consecutiveFailures: 0,
    conflictCount: 0,
    updaterState: 'unsupported',
  },
  degraded: {
    contractVersion: 1,
    installationId: 'inst-hqdos01a2b3',
    source: 'desktop',
    platform: 'linux',
    arch: 'x64',
    sentAt: '2026-09-11T12:00:00.000Z',
    sequence: 13,
    versions: { desktop: '0.1.0-local.2', syncRunner: '6.16.35' },
    syncState: 'conflict_blocked',
    lastSyncAttemptAt: '2026-09-11T11:58:00.000Z',
    lastSyncSuccessAt: '2026-09-11T10:00:00.000Z',
    consecutiveFailures: 1,
    conflictCount: 2,
    updaterState: 'unsupported',
    failureReason: 'CONFLICT_BLOCKED',
  },
  stale: {
    contractVersion: 1,
    installationId: 'inst-hqdos01a2b3',
    source: 'desktop',
    platform: 'linux',
    arch: 'x64',
    sentAt: '2026-09-10T08:00:00.000Z',
    sequence: 4,
    versions: { desktop: '0.1.0-local.2' },
    syncState: 'idle',
    consecutiveFailures: 0,
    updaterState: 'unchecked',
    failureReason: 'HEARTBEAT_STALE',
  },
} as const satisfies Record<string, ClientHealthHeartbeat>;

const ALL_PASS: ClientHealthCheckResult[] = [
  { check: 'auth', status: 'pass' },
  { check: 'runner', status: 'pass' },
  { check: 'cli', status: 'skip' },
  { check: 'core', status: 'pass' },
  { check: 'updater', status: 'skip' },
  { check: 'sync', status: 'pass' },
  { check: 'conflicts', status: 'pass' },
  { check: 'storage', status: 'pass' },
  { check: 'permissions', status: 'pass' },
];

const DEGRADED: ClientHealthCheckResult[] = [
  { check: 'auth', status: 'pass' },
  { check: 'runner', status: 'pass' },
  { check: 'cli', status: 'skip' },
  { check: 'core', status: 'pass' },
  { check: 'updater', status: 'skip' },
  { check: 'sync', status: 'fail', reason: 'CONFLICT_BLOCKED' },
  { check: 'conflicts', status: 'fail', reason: 'CONFLICT_BLOCKED' },
  { check: 'storage', status: 'pass' },
  { check: 'permissions', status: 'pass' },
];

export interface HealthUiFixture {
  overall: HealthUiState;
  checks: { id: ClientHealthCheckResult['check']; label: string; status: HealthUiState; detail: string }[];
  lastCheckedAt: string | null;
  reportingEnabled: boolean;
}

const LABELS = {
  auth: 'Account',
  runner: 'Sync runner',
  cli: 'HQ CLI',
  core: 'HQ Core',
  updater: 'Updates',
  sync: 'Sync',
  conflicts: 'Conflicts',
  storage: 'Storage',
  permissions: 'Permissions',
} as const;

function toUi(results: ClientHealthCheckResult[], overall: HealthUiState, detailFor: (result: ClientHealthCheckResult) => string): HealthUiFixture['checks'] {
  return results.map((result) => ({
    id: result.check,
    label: LABELS[result.check],
    status: overall === 'checking'
      ? 'checking'
      : result.status === 'pass'
        ? 'healthy'
        : result.status === 'fail'
          ? 'degraded'
          : overall === 'stale'
            ? 'stale'
            : 'unavailable',
    detail: detailFor(result),
  }));
}

/** Preview/Settings fixtures for healthy / degraded / stale / checking. */
export const HEALTH_UI_FIXTURES: Record<'healthy' | 'degraded' | 'stale' | 'checking', HealthUiFixture> = {
  healthy: {
    overall: 'healthy',
    lastCheckedAt: '2026-09-11T12:00:00.000Z',
    reportingEnabled: false,
    checks: toUi(ALL_PASS, 'healthy', (result) => (result.status === 'skip' ? 'Not available on this computer.' : 'Looking good.')),
  },
  degraded: {
    overall: 'degraded',
    lastCheckedAt: '2026-09-11T12:00:00.000Z',
    reportingEnabled: false,
    checks: toUi(DEGRADED, 'degraded', (result) => {
      if (result.reason === 'CONFLICT_BLOCKED') return 'One or more files need a choice.';
      if (result.status === 'skip') return 'Not available on this computer.';
      return 'Looking good.';
    }),
  },
  stale: {
    overall: 'stale',
    lastCheckedAt: '2026-09-10T08:00:00.000Z',
    reportingEnabled: false,
    checks: toUi(ALL_PASS, 'stale', () => 'Last checked a while ago.'),
  },
  checking: {
    overall: 'checking',
    lastCheckedAt: null,
    reportingEnabled: false,
    checks: CLIENT_HEALTH_DIAGNOSTIC_CHECK_VIEWS(),
  },
};

function CLIENT_HEALTH_DIAGNOSTIC_CHECK_VIEWS(): HealthUiFixture['checks'] {
  return (Object.keys(LABELS) as (keyof typeof LABELS)[]).map((id) => ({
    id,
    label: LABELS[id],
    status: 'checking' as const,
    detail: 'Checking…',
  }));
}
