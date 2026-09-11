import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pausedSync, reduceSync, RunnerLines } from '../../src/main/sync-state';
import { membershipScopes, WorkspaceAccounts } from '../../src/main/sync-scopes';
import { parseCompanionAction } from '../../src/shared/companion';

describe('truthful sync status', () => {
  const complete = { type: 'all-complete', companiesAttempted: 1, errors: [], conflictPaths: [], transient: [], partial: false };
  it('requires a complete protocol summary before recording success', () => {
    for (const event of [{ type: 'exit', code: 0 }, { type: 'all-complete' }, { ...complete, companiesAttempted: 0 }, { ...complete, errors: ['failed'] }, { ...complete, partial: true }, { ...complete, transient: ['retry'] }, { ...complete, conflictPaths: ['file'] }]) expect(reduceSync(pausedSync(), event).lastSuccess).toBeNull();
    expect(reduceSync(pausedSync(), complete)).toMatchObject({ phase: 'idle', lastSuccess: expect.any(String), conflictPaths: [] });
  });
  it('preserves the previous successful time when a later pass fails', () => {
    const synced = reduceSync(pausedSync(), complete);
    expect(reduceSync(synced, { type: 'auth-error' })).toMatchObject({ phase: 'not-connected', lastSuccess: synced.lastSuccess });
    expect(reduceSync(synced, { ...complete, partial: true })).toMatchObject({ phase: 'error', lastSuccess: synced.lastSuccess });
  });
  it('tracks relative conflict paths from conflict events and all-complete', () => {
    const first = reduceSync(pausedSync(), { type: 'conflict', path: 'notes/shared-draft.md' });
    expect(first).toMatchObject({ phase: 'conflict', conflicts: 1, conflictPaths: ['notes/shared-draft.md'], message: 'One file needs your attention' });
    const second = reduceSync(first, { type: 'conflict', path: 'plans/roadmap.md' });
    expect(second).toMatchObject({ conflicts: 2, conflictPaths: ['notes/shared-draft.md', 'plans/roadmap.md'] });
    const summarized = reduceSync(pausedSync(), { ...complete, conflictPaths: ['notes/shared-draft.md', '/etc/passwd', '../escape', 'plans/roadmap.md'] });
    expect(summarized).toMatchObject({ phase: 'conflict', conflicts: 2, conflictPaths: ['notes/shared-draft.md', 'plans/roadmap.md'] });
  });
  it('reassembles fragmented lines and recovers after oversized diagnostic output', () => {
    const events: Record<string, unknown>[] = []; const lines = new RunnerLines(event => events.push(event));
    lines.push('{"type":"pro'); lines.push('gress"}\n');
    lines.push('x'.repeat(300000)); lines.push('\n'); lines.push(JSON.stringify(complete) + '\n');
    expect(events.map(event => event.type)).toEqual(['progress', 'all-complete']);
  });
});
describe('account-scoped work selection', () => {
  it('accepts projected companyName from active memberships and offers an all fan-out', () => {
    expect(membershipScopes({
      memberships: [
        { companyUid: 'cmp_A', status: 'active', companyName: 'Example team' },
        { companyUid: 'cmp_A', status: 'active', companyName: 'Example team' },
        { companyUid: 'cmp_B', status: 'revoked', companyName: 'Old team' },
      ],
    })).toEqual([
      { id: 'all', label: 'Everything I’m part of (2)' },
      { id: 'personal', label: 'My personal work only' },
      { id: 'cmp_A', label: 'Example team' },
    ]);
    expect(membershipScopes({ memberships: [{ companyUid: 'cmp_A', status: 'active', name: 'Legacy name' }] })[2]).toEqual({ id: 'cmp_A', label: 'Legacy name' });
    expect(() => membershipScopes({ error: 'unavailable' })).toThrow();
    expect(() => membershipScopes({ memberships: [{ companyUid: '../../other', status: 'active' }] })).toThrow();
  });
  it('never interprets paths or shell syntax as a selected scope', () => {
    for (const scopeId of ['/home/user', '--companies', 'cmp_A;echo', 'cmp_A/../B']) expect(parseCompanionAction({ action: 'select-sync-scope', scopeId })).toBeNull();
    expect(parseCompanionAction({ action: 'select-sync-scope', scopeId: 'personal' })).toEqual({ action: 'select-sync-scope', scopeId: 'personal' });
    expect(parseCompanionAction({ action: 'select-sync-scope', scopeId: 'all' })).toEqual({ action: 'select-sync-scope', scopeId: 'all' });
    expect(parseCompanionAction({ action: 'sign-in', scopeId: 'personal' })).toBeNull();
  });
  it('accepts only engine conflict choices and relative paths for resolve-conflicts', () => {
    expect(parseCompanionAction({ action: 'resolve-conflicts', choice: 'keep' })).toEqual({ action: 'resolve-conflicts', choice: 'keep' });
    expect(parseCompanionAction({ action: 'resolve-conflicts', choice: 'publish-local', paths: ['notes/a.md'] })).toEqual({ action: 'resolve-conflicts', choice: 'publish-local', paths: ['notes/a.md'] });
    expect(parseCompanionAction({ action: 'resolve-conflicts', choice: 'overwrite' })).toEqual({ action: 'resolve-conflicts', choice: 'overwrite' });
    expect(parseCompanionAction({ action: 'resolve-conflicts', choice: 'abort' })).toEqual({ action: 'resolve-conflicts', choice: 'abort' });
    for (const input of [
      { action: 'resolve-conflicts' },
      { action: 'resolve-conflicts', choice: 'nuke' },
      { action: 'resolve-conflicts', choice: 'keep', paths: ['/etc/passwd'] },
      { action: 'resolve-conflicts', choice: 'keep', paths: ['../escape'] },
      { action: 'resolve-conflicts', choice: 'keep', paths: [] },
      { action: 'pause-sync', choice: 'keep' },
    ]) expect(parseCompanionAction(input)).toBeNull();
  });
  it('remembers folder ownership across app restarts and rejects another account', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-account-owner-'));
    try {
      await new WorkspaceAccounts(directory).bind('/example/HQ', 'first');
      await new WorkspaceAccounts(directory).bind('/example/HQ', 'first');
      await expect(new WorkspaceAccounts(directory).bind('/example/HQ', 'second')).rejects.toThrow('another HQ account');
      await new WorkspaceAccounts(directory).bind('/example/Other HQ', 'second');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
