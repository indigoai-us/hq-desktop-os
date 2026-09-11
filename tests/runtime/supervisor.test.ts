import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pausedSync, reduceSync, RunnerLines } from '../../src/main/sync/protocol';
import { DESKTOP_SYNC_LOCK, DESKTOP_SYNC_LOCK_MODE, syncChildArgv, syncScopeArgs } from '../../src/main/sync/ownership';
import { SYNC_PROTOCOL_EVENT_TYPES, SYNC_RESTART_POLICY, SYNC_WATCH_ARGV } from '../../src/shared/sync';

const root = join(import.meta.dirname, '../..');

describe('US-012 shared realtime sync supervisor contract', () => {
  it('ships the PRD sync modules and keeps the owned child entry small', () => {
    for (const rel of [
      'src/main/sync/supervisor.ts',
      'src/main/sync/protocol.ts',
      'src/main/sync/ownership.ts',
      'src/shared/sync.ts',
      'src/main/sync-child.ts',
      'scripts/verify-sync-child.mjs',
    ]) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }
    expect(statSync(join(root, 'src/main/sync-child.ts')).size).toBeLessThanOrEqual(20_000);
  });

  it('builds shared-runner argv with watch, both directions, event-push, and exclusive ownership', () => {
    expect(SYNC_WATCH_ARGV).toEqual(['--direction', 'both', '--watch', '--event-push']);
    expect(syncScopeArgs('all')).toEqual(['--companies']);
    expect(syncScopeArgs('personal')).toEqual(['--personal']);
    expect(syncScopeArgs('cmp_ABC')).toEqual(['--company', 'cmp_ABC']);
    expect(syncChildArgv('/tmp/HQ', 'all', 'abort')).toEqual([
      '--hq-root', '/tmp/HQ', '--companies', '--direction', 'both', '--watch', '--event-push', '--on-conflict', 'abort',
    ]);
    expect(DESKTOP_SYNC_LOCK).toBe('desktop-sync');
    expect(DESKTOP_SYNC_LOCK_MODE).toBe('exclusive');
    expect(SYNC_RESTART_POLICY.maxAttempts).toBeGreaterThan(0);
    expect(SYNC_RESTART_POLICY.maxMs).toBeGreaterThanOrEqual(SYNC_RESTART_POLICY.baseMs);
  });

  it('maps runner outcome fixtures to UI-facing state without treating exit-zero as success', () => {
    const complete = {
      type: 'all-complete',
      companiesAttempted: 1,
      errors: [],
      conflictPaths: [],
      transient: [],
      partial: false,
    };
    expect(reduceSync(pausedSync(), { type: 'exit', code: 0 }).lastSuccess).toBeNull();
    expect(reduceSync(pausedSync(), { type: 'setup-needed' }).phase).toBe('error');
    expect(reduceSync(pausedSync(), { type: 'auth-error' }).phase).toBe('not-connected');
    expect(reduceSync(pausedSync(), { ...complete, partial: true }).phase).toBe('error');
    expect(reduceSync(pausedSync(), { type: 'conflict', path: 'notes/a.md' }).phase).toBe('conflict');
    expect(reduceSync(pausedSync(), complete).phase).toBe('idle');

    const events: Record<string, unknown>[] = [];
    const lines = new RunnerLines(event => events.push(event));
    lines.push('not-json\n');
    lines.push(JSON.stringify({ type: 'progress' }) + '\n');
    lines.push('{bad\n');
    expect(events.map(event => event.type)).toEqual(['progress']);
    expect(SYNC_PROTOCOL_EVENT_TYPES).toContain('all-complete');
  });

  it('records Linux supervisor coverage and defers authenticated live subscribe evidence', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'runtime/manifest.json'), 'utf8')) as {
      platformEvidence: {
        linux: { syncSupervisor?: string; notes?: string };
        windows: { syncSupervisor?: string };
      };
    };
    expect(manifest.platformEvidence.linux.syncSupervisor).toBe('covered');
    expect(manifest.platformEvidence.windows.syncSupervisor).toBe('deferred');
    expect(manifest.platformEvidence.linux.notes).toMatch(/authenticated live subscribe/i);

    const supervisor = readFileSync(join(root, 'src/main/sync/supervisor.ts'), 'utf8');
    expect(supervisor).toContain('SYNC_RESTART_POLICY');
    expect(supervisor).toContain('scheduleRestart');
    expect(supervisor).toContain('type: \'stop\'');
  });
});
