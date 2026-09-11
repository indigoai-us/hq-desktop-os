import type { CompanionHealth, HealthCheckId, HealthUiState } from './health.js';

const LABELS: Record<HealthCheckId, string> = {
  auth: 'Account',
  runner: 'Sync runner',
  cli: 'HQ CLI',
  core: 'HQ Core',
  updater: 'Updates',
  sync: 'Sync',
  conflicts: 'Conflicts',
  storage: 'Storage',
  permissions: 'Permissions',
};

function checks(
  overall: HealthUiState,
  statuses: Partial<Record<HealthCheckId, HealthUiState>>,
  details: Partial<Record<HealthCheckId, string>> = {},
): CompanionHealth['checks'] {
  return (Object.keys(LABELS) as HealthCheckId[]).map((id) => ({
    id,
    label: LABELS[id],
    status: overall === 'checking' ? 'checking' : statuses[id] ?? 'healthy',
    detail: overall === 'checking'
      ? 'Checking…'
      : details[id] ?? (statuses[id] === 'unavailable' ? 'Not available on this computer.' : 'Looking good.'),
  }));
}

/** Preview/Settings fixtures — UI evidence only, not live support proof. */
export const HEALTH_PREVIEW_FIXTURES: Record<'healthy' | 'degraded' | 'stale' | 'checking' | 'unavailable', CompanionHealth> = {
  healthy: {
    overall: 'healthy',
    lastCheckedAt: '2026-09-11T12:00:00.000Z',
    reportingEnabled: false,
    clientName: 'hq-desktop-os',
    checks: checks('healthy', {
      cli: 'unavailable',
      updater: 'unavailable',
    }),
  },
  degraded: {
    overall: 'degraded',
    lastCheckedAt: '2026-09-11T12:00:00.000Z',
    reportingEnabled: false,
    clientName: 'hq-desktop-os',
    checks: checks('degraded', {
      cli: 'unavailable',
      updater: 'unavailable',
      sync: 'degraded',
      conflicts: 'degraded',
    }, {
      sync: 'One or more files need a choice.',
      conflicts: 'One or more files need a choice.',
    }),
  },
  stale: {
    overall: 'stale',
    lastCheckedAt: '2026-09-10T08:00:00.000Z',
    reportingEnabled: false,
    clientName: 'hq-desktop-os',
    checks: checks('stale', {
      auth: 'stale',
      runner: 'stale',
      cli: 'unavailable',
      core: 'stale',
      updater: 'unavailable',
      sync: 'stale',
      conflicts: 'stale',
      storage: 'stale',
      permissions: 'stale',
    }, Object.fromEntries((Object.keys(LABELS) as HealthCheckId[]).map((id) => [id, 'Last checked a while ago.']))),
  },
  checking: {
    overall: 'checking',
    lastCheckedAt: null,
    reportingEnabled: false,
    clientName: 'hq-desktop-os',
    checks: checks('checking', {}),
  },
  unavailable: {
    overall: 'unavailable',
    lastCheckedAt: null,
    reportingEnabled: false,
    clientName: 'hq-desktop-os',
    checks: checks('unavailable', Object.fromEntries((Object.keys(LABELS) as HealthCheckId[]).map((id) => [id, 'unavailable'])) as Record<HealthCheckId, HealthUiState>,
      Object.fromEntries((Object.keys(LABELS) as HealthCheckId[]).map((id) => [id, 'Local checks only. Server attribution and support commands are not enabled.']))),
  },
};
