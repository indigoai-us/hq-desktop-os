import { CLIENT_HEALTH_CLIENT_NAME, CLIENT_HEALTH_DIAGNOSTIC_CHECKS, type ClientHealthCheckResult } from './contract.js';
import {
  aggregateUiState,
  mapCheckToUiState,
  probeLabel,
  reasonDetail,
} from './probes.js';
import type { CompanionHealth } from '../../shared/health.js';
import { HEALTH_UI_FIXTURES } from './fixtures.js';

export function companionHealthFromResults(
  results: ClientHealthCheckResult[],
  options?: {
    checking?: boolean;
    stale?: boolean;
    retry?: boolean;
    lastCheckedAt?: string | null;
    reportingEnabled?: boolean;
  },
): CompanionHealth {
  const overall = aggregateUiState(results, options);
  return {
    overall,
    lastCheckedAt: options?.lastCheckedAt ?? null,
    reportingEnabled: options?.reportingEnabled === true,
    clientName: CLIENT_HEALTH_CLIENT_NAME,
    checks: results.map((result) => ({
      id: result.check,
      label: probeLabel(result.check),
      status: mapCheckToUiState(result, overall),
      detail: result.status === 'fail'
        ? reasonDetail(result.reason) || 'Needs attention.'
        : result.status === 'skip'
          ? 'Not available on this computer.'
          : overall === 'checking'
            ? 'Checking…'
            : overall === 'stale'
              ? 'Last checked a while ago.'
              : 'Looking good.',
    })),
  };
}

export function unavailableHealth(
  detail = 'Local checks only. Server attribution and support commands are not enabled.',
): CompanionHealth {
  return {
    overall: 'unavailable',
    lastCheckedAt: null,
    reportingEnabled: false,
    clientName: CLIENT_HEALTH_CLIENT_NAME,
    checks: CLIENT_HEALTH_DIAGNOSTIC_CHECKS.map((id) => ({
      id,
      label: probeLabel(id),
      status: 'unavailable',
      detail,
    })),
  };
}

export function healthFixture(scenario: keyof typeof HEALTH_UI_FIXTURES): CompanionHealth {
  const fixture = HEALTH_UI_FIXTURES[scenario];
  return {
    overall: fixture.overall,
    checks: fixture.checks,
    lastCheckedAt: fixture.lastCheckedAt,
    reportingEnabled: fixture.reportingEnabled,
    clientName: CLIENT_HEALTH_CLIENT_NAME,
  };
}
