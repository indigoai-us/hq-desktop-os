import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLIENT_HEALTH_DIAGNOSTIC_CHECKS,
  type ClientHealthCheckResult,
  type ClientHealthDiagnosticCheck,
  type ClientHealthFailureReason,
} from './contract.js';

export const PROBE_TIMEOUT_MS = 10_000;

export type HealthUiState = 'checking' | 'healthy' | 'degraded' | 'stale' | 'retry' | 'unavailable';

export interface ProbeContext {
  signedIn: boolean;
  authExpired?: boolean;
  runnerAvailable: boolean;
  cliAvailable: boolean;
  coreAvailable: boolean;
  updaterSupported: boolean;
  updaterState?: 'unchecked' | 'up_to_date' | 'update_available' | 'update_failed' | 'unsupported';
  syncPhase: 'not-connected' | 'idle' | 'syncing' | 'paused' | 'offline' | 'conflict' | 'error';
  conflictCount: number;
  storageWritable: boolean;
  /** Directory used for the temporary permissions marker (userData or temp). */
  permissionsProbeDirectory: string;
  /** Optional overrides for tests — inject hung or forced outcomes. */
  overrides?: Partial<Record<ClientHealthDiagnosticCheck, () => Promise<ClientHealthCheckResult>>>;
}

const LABELS: Record<ClientHealthDiagnosticCheck, string> = {
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

export function probeLabel(check: ClientHealthDiagnosticCheck): string {
  return LABELS[check];
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(onTimeout());
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(onTimeout());
      },
    );
  });
}

async function runOne(check: ClientHealthDiagnosticCheck, context: ProbeContext): Promise<ClientHealthCheckResult> {
  const override = context.overrides?.[check];
  if (override) return override();

  switch (check) {
    case 'auth':
      if (!context.signedIn) return { check, status: 'skip' };
      if (context.authExpired) return { check, status: 'fail', reason: 'AUTH_EXPIRED' };
      return { check, status: 'pass' };
    case 'runner':
      if (!context.runnerAvailable) return { check, status: 'skip' };
      return { check, status: 'pass' };
    case 'cli':
      // CLI is optional for this companion; absence is unknown/skip, never a fake pass.
      if (!context.cliAvailable) return { check, status: 'skip' };
      return { check, status: 'pass' };
    case 'core':
      if (!context.coreAvailable) return { check, status: 'skip' };
      return { check, status: 'pass' };
    case 'updater':
      if (!context.updaterSupported || context.updaterState === 'unsupported') {
        return { check, status: 'skip' };
      }
      if (context.updaterState === 'update_failed') return { check, status: 'fail', reason: 'UPDATE_FAILED' };
      return { check, status: 'pass' };
    case 'sync':
      if (context.syncPhase === 'not-connected') return { check, status: 'skip' };
      if (context.syncPhase === 'error') return { check, status: 'fail', reason: 'RUNNER_FAILED' };
      if (context.syncPhase === 'paused') return { check, status: 'fail', reason: 'SYNC_PAUSED' };
      if (context.syncPhase === 'conflict') return { check, status: 'fail', reason: 'CONFLICT_BLOCKED' };
      return { check, status: 'pass' };
    case 'conflicts':
      if (context.syncPhase === 'not-connected') return { check, status: 'skip' };
      if (context.conflictCount > 0 || context.syncPhase === 'conflict') {
        return { check, status: 'fail', reason: 'CONFLICT_BLOCKED' };
      }
      return { check, status: 'pass' };
    case 'storage':
      if (!context.storageWritable) return { check, status: 'fail', reason: 'DISK_FULL' };
      return { check, status: 'pass' };
    case 'permissions': {
      // Only mutating repair allowed: create + remove a temporary marker.
      const dir = await mkdtemp(join(context.permissionsProbeDirectory || tmpdir(), 'hq-health-perm-'));
      const marker = join(dir, 'probe-marker');
      try {
        await writeFile(marker, 'ok', { mode: 0o600 });
        await rm(dir, { recursive: true, force: true });
        return { check, status: 'pass' };
      } catch {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        return { check, status: 'fail', reason: 'PERMISSION_DENIED' };
      }
    }
    default: {
      const _exhaustive: never = check;
      return _exhaustive;
    }
  }
}

/**
 * Run all nine diagnostic checks in parallel. Each probe is bounded to 10s.
 * Timeouts and unsupported components return skip/fail — never invented passes.
 */
export async function runHealthProbes(context: ProbeContext): Promise<ClientHealthCheckResult[]> {
  const jobs = CLIENT_HEALTH_DIAGNOSTIC_CHECKS.map((check) =>
    withTimeout(
      runOne(check, context),
      PROBE_TIMEOUT_MS,
      (): ClientHealthCheckResult => ({ check, status: 'skip' }),
    ),
  );
  return Promise.all(jobs);
}

export function mapCheckToUiState(result: ClientHealthCheckResult, overall: HealthUiState): HealthUiState {
  if (overall === 'checking') return 'checking';
  if (result.status === 'pass') return 'healthy';
  if (result.status === 'fail') return 'degraded';
  return 'unavailable';
}

export function aggregateUiState(results: ClientHealthCheckResult[], options?: {
  checking?: boolean;
  stale?: boolean;
  retry?: boolean;
}): HealthUiState {
  if (options?.checking) return 'checking';
  if (options?.retry) return 'retry';
  if (options?.stale) return 'stale';
  if (!results.length) return 'unavailable';
  if (results.some((result) => result.status === 'fail')) return 'degraded';
  if (results.every((result) => result.status === 'skip')) return 'unavailable';
  return 'healthy';
}

export function reasonDetail(reason?: ClientHealthFailureReason): string {
  switch (reason) {
    case 'AUTH_EXPIRED': return 'Sign-in has expired.';
    case 'SYNC_PAUSED': return 'Sync is paused.';
    case 'CONFLICT_BLOCKED': return 'One or more files need a choice.';
    case 'UPDATE_FAILED': return 'An update did not finish.';
    case 'RUNNER_FAILED': return 'Sync could not complete.';
    case 'PERMISSION_DENIED': return 'A required folder is not writable.';
    case 'DISK_FULL': return 'Storage looks full or unavailable.';
    case 'HEARTBEAT_STALE': return 'Health reporting is stale.';
    default: return reason ?? '';
  }
}
