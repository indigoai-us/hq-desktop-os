export const HEALTH_CHECK_IDS = [
  'auth',
  'runner',
  'cli',
  'core',
  'updater',
  'sync',
  'conflicts',
  'storage',
  'permissions',
] as const;
export type HealthCheckId = (typeof HEALTH_CHECK_IDS)[number];

export type HealthUiState = 'checking' | 'healthy' | 'degraded' | 'stale' | 'retry' | 'unavailable';

export interface HealthCheckView {
  id: HealthCheckId;
  label: string;
  status: HealthUiState;
  detail: string;
}

export interface CompanionHealth {
  overall: HealthUiState;
  checks: HealthCheckView[];
  lastCheckedAt: string | null;
  /** Live heartbeat transport is opt-in; scaffold default is false. */
  reportingEnabled: boolean;
  clientName: 'hq-desktop-os';
}

export const HEALTH_UI_STATE_LABELS: Record<HealthUiState, string> = {
  checking: 'Checking',
  healthy: 'Healthy',
  degraded: 'Needs attention',
  stale: 'Stale',
  retry: 'Retrying',
  unavailable: 'Unavailable',
};
