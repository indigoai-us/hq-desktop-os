import type { SyncPhase, SyncStatus } from '../../shared/sync.js';
import type {
  ClientHealthFailureReason,
  ClientHealthLocalFilesOverview,
  ClientHealthSyncState,
  ClientHealthUpdaterState,
  ClientHealthVersions,
} from './contract.js';
import type { HealthPersistedState } from './state.js';

/** Inputs the reporter turns into a validated heartbeat payload. */
export interface HeartbeatFacts {
  versions: ClientHealthVersions;
  syncState: ClientHealthSyncState;
  lastSyncAttemptAt?: string;
  lastSyncSuccessAt?: string;
  syncEngineWatermarkAt?: string;
  consecutiveFailures: number;
  conflictCount?: number;
  updaterState?: ClientHealthUpdaterState;
  failureReason?: ClientHealthFailureReason;
  localFilesOverview?: ClientHealthLocalFilesOverview;
}

/** Map renderer/supervisor sync phase onto the closed health sync-state enum. */
export function syncPhaseToHealthState(phase: SyncPhase | 'not-connected'): ClientHealthSyncState {
  switch (phase) {
    case 'syncing':
      return 'syncing';
    case 'paused':
      return 'paused';
    case 'conflict':
      return 'conflict_blocked';
    case 'error':
      return 'error';
    case 'idle':
    case 'offline':
      return 'idle';
    case 'not-connected':
    default:
      return 'never_synced';
  }
}

export function failureReasonForSync(sync: SyncStatus): ClientHealthFailureReason | undefined {
  if (sync.phase === 'conflict') return 'CONFLICT_BLOCKED';
  if (sync.phase === 'paused') return 'SYNC_PAUSED';
  if (sync.phase === 'error') return 'RUNNER_FAILED';
  return undefined;
}

export interface BuildCompanionHeartbeatFactsInput {
  sync: SyncStatus;
  /** Persisted health counters / watermarks (engine watermark ≠ success). */
  healthState: HealthPersistedState;
  versions?: ClientHealthVersions;
  updaterState?: ClientHealthUpdaterState;
  localFilesOverview?: ClientHealthLocalFilesOverview;
  /** When false, treat sync as never_synced regardless of phase. */
  signedIn?: boolean;
}

/**
 * Build heartbeat facts from companion sync + persisted health state.
 * `lastSyncSuccessAt` only comes from genuine completed success (`sync.lastSuccess`).
 * `syncEngineWatermarkAt` stays separate (journal/engine observation).
 */
export function buildCompanionHeartbeatFacts(input: BuildCompanionHeartbeatFactsInput): HeartbeatFacts {
  const signedIn = input.signedIn !== false;
  const syncState = signedIn
    ? syncPhaseToHealthState(input.sync.phase)
    : 'never_synced';
  const persisted = input.healthState;
  const lastSyncAttemptAt = persisted.lastSyncAttemptAt ?? undefined;
  // Genuine completed success only — never promote attempt or watermark.
  const lastSyncSuccessAt = input.sync.lastSuccess
    ?? persisted.lastSyncSuccessAt
    ?? undefined;
  const syncEngineWatermarkAt = persisted.syncEngineWatermarkAt ?? undefined;
  const consecutiveFailures = persisted.consecutiveFailures;
  const failureReason = signedIn ? failureReasonForSync(input.sync) : 'AUTH_EXPIRED';

  const facts: HeartbeatFacts = {
    versions: input.versions ?? {},
    syncState,
    consecutiveFailures,
  };
  if (lastSyncAttemptAt) facts.lastSyncAttemptAt = lastSyncAttemptAt;
  if (lastSyncSuccessAt) facts.lastSyncSuccessAt = lastSyncSuccessAt;
  if (syncEngineWatermarkAt) facts.syncEngineWatermarkAt = syncEngineWatermarkAt;
  if (input.sync.conflicts > 0 || syncState === 'conflict_blocked') {
    facts.conflictCount = input.sync.conflicts;
  }
  if (input.updaterState !== undefined) facts.updaterState = input.updaterState;
  if (failureReason) facts.failureReason = failureReason;
  if (input.localFilesOverview) facts.localFilesOverview = input.localFilesOverview;
  return facts;
}

/** ISO-UTC helper that rejects non-finite clocks. */
export function isoUtcNow(now: Date = new Date()): string {
  return now.toISOString();
}
