import { isRelativeConflictPath } from '../../shared/companion.js';
import type { SyncPass, SyncStatus, SyncTransport } from '../../shared/sync.js';

export type SyncState = SyncStatus;

export const pausedSync = (): SyncState => ({
  phase: 'paused',
  message: 'Ready when you are',
  lastSuccess: null,
  conflicts: 0,
  conflictPaths: [],
  transport: null,
  pass: null,
  pendingCount: 0,
});

function conflictMessage(count: number): string {
  return count === 1 ? 'One file needs your attention' : 'Some files need your attention';
}

function sanitizePaths(values: unknown[]): string[] {
  const paths: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const path = value.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!isRelativeConflictPath(path) || paths.includes(path)) continue;
    paths.push(path);
  }
  return paths;
}

function planPendingCount(event: Record<string, unknown>): number {
  const keys = ['filesToDownload', 'filesToUpload', 'filesToDelete'] as const;
  let total = 0;
  for (const key of keys) {
    const value = event[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) total += Math.floor(value);
  }
  return total;
}

function asTransport(value: unknown): SyncTransport {
  if (value === 'realtime' || value === 'polling' || value === 'offline') return value;
  return null;
}

/** Protocol events, never exit code alone, establish a successful sync. */
export function reduceSync(state: SyncState, event: Record<string, unknown>): SyncState {
  switch (event.type) {
    case 'plan': {
      const pendingCount = planPendingCount(event);
      const pass: SyncPass = pendingCount > 0 ? 'pending' : 'reconciling';
      const message = pendingCount > 0
        ? (pendingCount === 1 ? 'Updating 1 file' : `Updating ${pendingCount} files`)
        : (state.lastSuccess ? 'Checking for changes' : 'Checking your files');
      return {
        ...state,
        phase: 'syncing',
        pass,
        pendingCount,
        message,
        // Stay offline only while the network event is active; a new plan resumes work.
        transport: state.transport === 'offline' ? null : state.transport,
      };
    }
    case 'progress':
      return {
        ...state,
        phase: 'syncing',
        pass: 'transferring',
        message: 'Keeping your files up to date',
        transport: state.transport === 'offline' ? null : state.transport,
      };
    case 'transport': {
      const transport = asTransport(event.mode);
      if (!transport) return state;
      if (transport === 'offline') {
        return { ...state, phase: 'offline', transport, pass: null, message: 'Waiting for a connection' };
      }
      // Realtime / polling only annotate a live watcher — never invent a completed sync.
      return {
        ...state,
        transport,
        message: state.phase === 'idle'
          ? (transport === 'polling' ? 'Connected · checking periodically' : 'Your files are up to date')
          : state.message,
      };
    }
    case 'transient-network':
      return {
        ...state,
        phase: 'offline',
        transport: 'offline',
        pass: null,
        pendingCount: 0,
        message: 'Waiting for a connection',
      };
    case 'auth-error':
      return {
        ...state,
        phase: 'not-connected',
        transport: null,
        pass: null,
        pendingCount: 0,
        message: 'Sign in again to continue syncing',
      };
    case 'setup-needed':
      return {
        ...state,
        phase: 'error',
        transport: null,
        pass: null,
        pendingCount: 0,
        message: 'Your account needs another moment. Try again shortly.',
      };
    case 'error':
      return {
        ...state,
        phase: 'error',
        transport: null,
        pass: null,
        pendingCount: 0,
        message: 'Some files could not sync. Please try again.',
      };
    case 'conflict': {
      const path = typeof event.path === 'string' ? sanitizePaths([event.path])[0] : undefined;
      const conflictPaths = path && !state.conflictPaths.includes(path) ? [...state.conflictPaths, path] : state.conflictPaths;
      const conflicts = Math.max(conflictPaths.length, path ? conflictPaths.length : state.conflicts + 1);
      return {
        ...state,
        phase: 'conflict',
        conflicts,
        conflictPaths,
        pass: null,
        pendingCount: 0,
        message: conflictMessage(conflicts),
      };
    }
    case 'all-complete': {
      if (
        !Array.isArray(event.errors)
        || !Array.isArray(event.conflictPaths)
        || !Array.isArray(event.transient)
        || typeof event.companiesAttempted !== 'number'
        || event.companiesAttempted < 1
        || typeof event.partial !== 'boolean'
      ) {
        return state;
      }
      const conflictPaths = sanitizePaths(event.conflictPaths);
      const conflicts = conflictPaths.length;
      if (conflicts) {
        return {
          ...state,
          phase: 'conflict',
          conflicts,
          conflictPaths,
          pass: null,
          pendingCount: 0,
          message: conflictMessage(conflicts),
        };
      }
      if (event.errors.length || event.partial) {
        return {
          ...state,
          phase: 'error',
          message: 'Some files could not sync. Please try again.',
          conflicts: 0,
          conflictPaths: [],
          pass: null,
          pendingCount: 0,
          transport: null,
        };
      }
      if (event.transient.length) {
        return {
          ...state,
          phase: 'offline',
          message: 'Waiting for a connection',
          conflicts: 0,
          conflictPaths: [],
          pass: null,
          pendingCount: 0,
          transport: 'offline',
        };
      }
      // Desktop always launches with --event-push; a clean all-complete means
      // the watcher is live. Polling is only shown after an explicit transport event.
      const transport: SyncTransport = state.transport === 'polling' ? 'polling' : 'realtime';
      return {
        phase: 'idle',
        message: transport === 'polling' ? 'Connected · checking periodically' : 'Your files are up to date',
        conflicts: 0,
        conflictPaths: [],
        lastSuccess: new Date().toISOString(),
        transport,
        pass: null,
        pendingCount: 0,
      };
    }
    default:
      return state;
  }
}

/** Bound diagnostic lines before parsing; never retain raw paths or messages. */
export class RunnerLines {
  private pending = '';
  private dropping = false;
  constructor(private readonly emit: (event: Record<string, unknown>) => void) {}
  push(chunk: string): void {
    for (const part of chunk.split(/(?<=\n)/)) {
      if (!this.dropping) this.pending += part;
      if (this.pending.length > 256 * 1024) {
        this.pending = '';
        this.dropping = true;
      }
      if (!part.endsWith('\n')) continue;
      if (!this.dropping) {
        try {
          const value: unknown = JSON.parse(this.pending);
          if (value && typeof value === 'object' && !Array.isArray(value)) this.emit(value as Record<string, unknown>);
        } catch {
          // Plain stderr diagnostics from the shared runner (not NDJSON).
          if (/event-push watcher degraded/i.test(this.pending)) {
            this.emit({ type: 'transport', mode: 'polling' });
          } else {
            console.error('Unrecognized sync status line');
          }
        }
      }
      this.pending = '';
      this.dropping = false;
    }
  }
}
