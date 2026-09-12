import { SYNC_WATCH_ARGV } from '../../shared/sync.js';

/** Exclusive lock name held under the shared HQ state dir so CLI sync cannot race the desktop watcher. */
export const DESKTOP_SYNC_LOCK = 'desktop-sync' as const;
export const DESKTOP_SYNC_LOCK_MODE = 'exclusive' as const;

export function isSyncScopeId(scopeId: string): boolean {
  return scopeId === 'all' || scopeId === 'personal' || /^cmp_[a-zA-Z0-9]+$/.test(scopeId);
}

/**
 * Explicit root/company scope for the shared runner.
 * `all` → `--companies` fanout (personal + every active membership).
 */
export function syncScopeArgs(scopeId: string): string[] {
  if (scopeId === 'all') return ['--companies'];
  if (scopeId === 'personal') return ['--personal'];
  if (/^cmp_[a-zA-Z0-9]+$/.test(scopeId)) return ['--company', scopeId];
  throw new Error('Choose a shared workspace again.');
}

/** Full child argv after `--hq-root <root>`: scope + watch/both/event-push + conflict strategy. */
export function syncChildArgv(root: string, scopeId: string, onConflict: string): string[] {
  if (!isSyncScopeId(scopeId)) throw new Error('Choose a shared workspace again.');
  if (!['abort', 'keep', 'publish-local', 'overwrite'].includes(onConflict)) {
    throw new Error('Choose how to resolve conflicting files.');
  }
  return ['--hq-root', root, ...syncScopeArgs(scopeId), ...SYNC_WATCH_ARGV, '--on-conflict', onConflict];
}
