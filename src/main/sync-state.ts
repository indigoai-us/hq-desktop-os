import type { CompanionSnapshot } from '../shared/companion.js';
export type SyncState = CompanionSnapshot['sync'];
export const pausedSync = (): SyncState => ({ phase: 'paused', message: 'Ready when you are', lastSuccess: null, conflicts: 0 });
/** Protocol events, never exit code alone, establish a successful sync. */
export function reduceSync(state: SyncState, event: Record<string, unknown>): SyncState {
  switch (event.type) {
    case 'plan': case 'progress': return { ...state, phase: 'syncing', message: 'Keeping your files up to date' };
    case 'transient-network': return { ...state, phase: 'offline', message: 'Waiting for a connection' };
    case 'auth-error': return { ...state, phase: 'not-connected', message: 'Sign in again to continue syncing' };
    case 'setup-needed': return { ...state, phase: 'error', message: 'Your account needs another moment. Try again shortly.' };
    case 'error': return { ...state, phase: 'error', message: 'Some files could not sync. Please try again.' };
    case 'conflict': return { ...state, phase: 'conflict', conflicts: state.conflicts + 1, message: 'Some files need your attention' };
    case 'all-complete': {
      if (!Array.isArray(event.errors) || !Array.isArray(event.conflictPaths) || !Array.isArray(event.transient) || typeof event.companiesAttempted !== 'number' || event.companiesAttempted < 1 || typeof event.partial !== 'boolean') return state;
      const conflicts = event.conflictPaths.length;
      if (conflicts) return { ...state, phase: 'conflict', conflicts, message: 'Some files need your attention' };
      if (event.errors.length || event.partial) return { ...state, phase: 'error', message: 'Some files could not sync. Please try again.' };
      if (event.transient.length) return { ...state, phase: 'offline', message: 'Waiting for a connection' };
      return { phase: 'idle', message: 'Your files are up to date', conflicts: 0, lastSuccess: new Date().toISOString() };
    }
    default: return state;
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
      if (this.pending.length > 256 * 1024) { this.pending = ''; this.dropping = true; }
      if (!part.endsWith('\n')) continue;
      if (!this.dropping) {
        try { const value: unknown = JSON.parse(this.pending); if (value && typeof value === 'object' && !Array.isArray(value)) this.emit(value as Record<string, unknown>); }
        catch { console.error('Unrecognized sync status line'); }
      }
      this.pending = ''; this.dropping = false;
    }
  }
}
