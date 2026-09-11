import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function readJson<T>(rel: string): T {
  return JSON.parse(read(rel)) as T;
}

describe('US-012 Shared realtime sync supervisor', () => {
  it('ships the PRD sync supervisor modules', () => {
    for (const rel of [
      'src/main/sync/supervisor.ts',
      'src/main/sync/protocol.ts',
      'src/main/sync/ownership.ts',
      'src/shared/sync.ts',
      'tests/runtime/supervisor.test.ts',
      'src/main/sync-child.ts',
    ]) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }

    const supervisor = read('src/main/sync/supervisor.ts');
    expect(supervisor).toContain('class SyncSupervisor');
    expect(supervisor).toContain('scheduleRestart');
    expect(supervisor).toContain('SYNC_RESTART_POLICY');
    expect(supervisor).toContain('syncChildArgv');

    const ownership = read('src/main/sync/ownership.ts');
    expect(ownership).toContain('DESKTOP_SYNC_LOCK');
    expect(ownership).toContain('syncChildArgv');
    expect(ownership).toContain('SYNC_WATCH_ARGV');

    const shared = read('src/shared/sync.ts');
    expect(shared).toContain("'--watch'");
    expect(shared).toContain("'--event-push'");

    const protocol = read('src/main/sync/protocol.ts');
    expect(protocol).toContain('reduceSync');
    expect(protocol).toContain('setup-needed');
    expect(protocol).toContain('auth-error');
    expect(protocol).toContain('partial');
    expect(protocol).toContain('RunnerLines');

    expect(shared).toContain('SYNC_WATCH_ARGV');
    expect(shared).toContain('SYNC_RESTART_POLICY');
  });

  it('keeps one owned watcher contract: private IPC stop, exclusive lock, recoverable state dir', () => {
    const child = read('src/main/sync-child.ts');
    expect(child).toContain('DESKTOP_SYNC_LOCK');
    expect(child).toContain('Private parent connection required');
    expect(child).toContain('token-request');
    expect(child).toMatch(/recoverable engine state/i);

    const supervisor = read('src/main/sync/supervisor.ts');
    expect(supervisor).toContain("type: 'stop'");
    expect(supervisor).toContain('HQ_STATE_DIR');
    expect(supervisor).toContain('sync-child.js');

    const companion = read('src/main/companion.ts');
    expect(companion).toContain('pauseSync');
    expect(companion).toContain('resume-sync');
    expect(companion).toContain('SyncSupervisor');
  });

  it('records Linux sync-supervisor coverage and defers live authenticated subscribe', () => {
    const manifest = readJson<{
      platformEvidence: {
        linux: { syncSupervisor?: string; notes?: string };
        windows: { syncSupervisor?: string };
      };
    }>('runtime/manifest.json');
    expect(manifest.platformEvidence.linux.syncSupervisor).toBe('covered');
    expect(manifest.platformEvidence.windows.syncSupervisor).toBe('deferred');
    expect(manifest.platformEvidence.linux.notes).toMatch(/US-012/);
    expect(manifest.platformEvidence.linux.notes).toMatch(/authenticated live subscribe/i);

    const docs = read('docs/platform-boundary.md');
    expect(docs).toContain('Shared realtime sync supervisor (US-012 Linux slice)');
    expect(docs).toContain('bounded exponential restart/backoff');
    expect(docs).toContain('--event-push');
  });
});
