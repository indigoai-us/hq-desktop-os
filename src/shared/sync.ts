/** Renderer-safe sync status and supervisor policy. Tokens never appear here. */

export type SyncPhase = 'not-connected' | 'idle' | 'syncing' | 'paused' | 'offline' | 'conflict' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  lastSuccess: string | null;
  message: string;
  conflicts: number;
  conflictPaths: string[];
}

/** Shared hq-sync-runner watch argv — HTTP/SQS realtime + cadence recovery, not a V2 engine. */
export const SYNC_WATCH_ARGV = ['--direction', 'both', '--watch', '--event-push'] as const;

/**
 * Bounded supervisor restart after an unexpected watcher exit.
 * Attempts reset after a protocol `all-complete` success; delay caps at maxMs.
 */
export const SYNC_RESTART_POLICY = {
  baseMs: 1_000,
  maxMs: 60_000,
  maxAttempts: 10,
} as const;

/** NDJSON event types the supervisor reduces into SyncStatus. */
export const SYNC_PROTOCOL_EVENT_TYPES = [
  'plan',
  'progress',
  'transient-network',
  'auth-error',
  'setup-needed',
  'error',
  'conflict',
  'all-complete',
] as const;

export type SyncProtocolEventType = (typeof SYNC_PROTOCOL_EVENT_TYPES)[number];
