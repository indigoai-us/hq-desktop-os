import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pausedSync, reduceSync } from '../../src/main/sync/protocol';
import { snapshotForScenario } from '../../src/renderer/dev/scenarios';
import { CONFLICT_CHOICES } from '../../src/shared/companion';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function readJson<T>(rel: string): T {
  return JSON.parse(read(rel)) as T;
}

describe('US-013 Live sync controls and conflict recovery UI', () => {
  it('ships the PRD sync screen, status, conflict list, and e2e modules', () => {
    for (const rel of [
      'src/renderer/screens/sync.tsx',
      'src/renderer/components/sync-status.tsx',
      'src/renderer/components/conflict-list.tsx',
      'tests/e2e/sync.spec.ts',
    ]) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }

    const screen = read('src/renderer/screens/sync.tsx');
    expect(screen).toContain('SyncScreen');
    expect(screen).toContain('pause-sync');
    expect(screen).toContain('resume-sync');
    expect(screen).toContain('resolve-conflicts');
    expect(screen).toContain('CompanyPicker');
    expect(screen).toContain('ConflictList');

    const status = read('src/renderer/components/sync-status.tsx');
    expect(status).toContain('Last confirmed sync');
    expect(status).toContain('Connected · live updates');
    expect(status).toContain('Connected · checking periodically');
    expect(status).toContain('Initial reconciliation');
    expect(status).toContain('pending changes');

    const conflicts = read('src/renderer/components/conflict-list.tsx');
    for (const choice of CONFLICT_CHOICES) expect(conflicts).toContain(`'${choice}'`);
    expect(conflicts).toContain('Keep both versions');
    expect(conflicts).toContain('Use the cloud copy');
    expect(conflicts).toContain('Never chosen for you');
  });

  it('derives reconciliation, pending, realtime, polling, offline, and paused from runner events', () => {
    const complete = {
      type: 'all-complete',
      companiesAttempted: 1,
      errors: [],
      conflictPaths: [],
      transient: [],
      partial: false,
    };
    expect(reduceSync(pausedSync(), { type: 'plan' })).toMatchObject({
      phase: 'syncing',
      pass: 'reconciling',
      message: 'Checking your files',
    });
    expect(
      reduceSync(pausedSync(), { type: 'plan', filesToDownload: 1, filesToUpload: 1, filesToDelete: 1 }),
    ).toMatchObject({ phase: 'syncing', pass: 'pending', pendingCount: 3 });
    expect(reduceSync(pausedSync(), complete)).toMatchObject({ phase: 'idle', transport: 'realtime' });
    expect(reduceSync(reduceSync(pausedSync(), complete), { type: 'transport', mode: 'polling' })).toMatchObject({
      transport: 'polling',
    });
    expect(reduceSync(pausedSync(), { type: 'transient-network' })).toMatchObject({
      phase: 'offline',
      transport: 'offline',
    });
    expect(pausedSync()).toMatchObject({ phase: 'paused', transport: null, pass: null });

    expect(snapshotForScenario('reconciling').sync).toMatchObject({ pass: 'reconciling' });
    expect(snapshotForScenario('pending').sync).toMatchObject({ pass: 'pending', pendingCount: 3 });
    expect(snapshotForScenario('connected').sync).toMatchObject({ transport: 'realtime', lastSuccess: expect.any(String) });
    expect(snapshotForScenario('polling').sync).toMatchObject({ transport: 'polling' });
    expect(snapshotForScenario('offline').sync).toMatchObject({ phase: 'offline', transport: 'offline' });
    expect(snapshotForScenario('paused').sync).toMatchObject({ phase: 'paused', transport: null });
    expect(snapshotForScenario('conflict').sync.conflictPaths).toEqual(['notes/shared-draft.md']);
  });

  it('keeps scope validation and non-default overwrite on the companion boundary', () => {
    const companion = read('src/main/companion.ts');
    expect(companion).toContain('This shared workspace is no longer available.');
    expect(companion).toContain('refreshScopes');
    expect(companion).toContain("conflictStrategy = 'abort'");
    expect(companion).toContain('resolveConflicts');

    const shared = read('src/shared/companion.ts');
    expect(shared).toContain('CONFLICT_CHOICES');
    expect(shared).toContain('resolve-conflicts');
    expect(shared).toContain('select-sync-scope');

    const preview = read('src/renderer/dev/companion-preview.ts');
    expect(preview).toContain('This shared workspace is no longer available.');
  });

  it('records Linux sync-controls coverage and defers live two-client convergence', () => {
    const manifest = readJson<{
      platformEvidence: {
        linux: { syncControls?: string; notes?: string };
        windows: { syncControls?: string };
      };
    }>('runtime/manifest.json');
    expect(manifest.platformEvidence.linux.syncControls).toBe('covered');
    expect(manifest.platformEvidence.windows.syncControls).toBe('deferred');
    expect(manifest.platformEvidence.linux.notes).toMatch(/US-013/);
    expect(manifest.platformEvidence.linux.notes).toMatch(/two-client/i);

    const docs = read('docs/platform-boundary.md');
    expect(docs).toContain('Live sync controls and conflict recovery (US-013 Linux slice)');
    expect(docs).toContain('Last confirmed sync');
    expect(docs).toContain('--on-conflict abort');
  });
});
