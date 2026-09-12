/** Renderer-safe sync status and supervisor policy. Tokens never appear here. */

export type SyncPhase = 'not-connected' | 'idle' | 'syncing' | 'paused' | 'offline' | 'conflict' | 'error';

/** How live updates arrive while the owned watcher is running. */
export type SyncTransport = 'realtime' | 'polling' | 'offline' | null;

/** In-progress pass detail while phase === 'syncing'. */
export type SyncPass = 'reconciling' | 'pending' | 'transferring' | null;

export interface SyncStatus {
  phase: SyncPhase;
  lastSuccess: string | null;
  message: string;
  conflicts: number;
  conflictPaths: string[];
  /** Live-update path; null when sync is paused / not connected. */
  transport: SyncTransport;
  /** Active runner pass while syncing; null otherwise. */
  pass: SyncPass;
  /** Pending file count from the latest plan (uploads + downloads + deletes). */
  pendingCount: number;
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
  'transport',
] as const;

export type SyncProtocolEventType = (typeof SYNC_PROTOCOL_EVENT_TYPES)[number];

/** Empty signed-out / not-connected snapshot sync block. */
export function disconnectedSync(message = 'Sign in to sync your files.'): SyncStatus {
  return {
    phase: 'not-connected',
    lastSuccess: null,
    message,
    conflicts: 0,
    conflictPaths: [],
    transport: null,
    pass: null,
    pendingCount: 0,
  };
}
