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
    expect(reduceSync(pausedSync(), complete)).toMatchObject({ phase: 'idle', lastSuccess: expect.any(String) });
  });
  it('preserves the previous successful time when a later pass fails', () => {
    const synced = reduceSync(pausedSync(), complete);
    expect(reduceSync(synced, { type: 'auth-error' })).toMatchObject({ phase: 'not-connected', lastSuccess: synced.lastSuccess });
    expect(reduceSync(synced, { ...complete, partial: true })).toMatchObject({ phase: 'error', lastSuccess: synced.lastSuccess });
  });
  it('reassembles fragmented lines and recovers after oversized diagnostic output', () => {
    const events: Record<string, unknown>[] = []; const lines = new RunnerLines(event => events.push(event));
    lines.push('{"type":"pro'); lines.push('gress"}\n');
    lines.push('x'.repeat(300000)); lines.push('\n'); lines.push(JSON.stringify(complete) + '\n');
    expect(events.map(event => event.type)).toEqual(['progress', 'all-complete']);
  });
});
describe('account-scoped work selection', () => {
  it('accepts projected names only from active memberships, with no global lookup', () => {
    expect(membershipScopes({ memberships: [{ companyUid: 'cmp_A', status: 'active', name: 'Example team' }, { companyUid: 'cmp_A', status: 'active' }, { companyUid: 'cmp_B', status: 'revoked', name: 'Old team' }] })).toEqual([{ id: 'personal', label: 'My personal work' }, { id: 'cmp_A', label: 'Example team' }]);
    expect(() => membershipScopes({ error: 'unavailable' })).toThrow();
    expect(() => membershipScopes({ memberships: [{ companyUid: '../../other', status: 'active' }] })).toThrow();
  });
  it('never interprets paths or shell syntax as a selected scope', () => {
    for (const scopeId of ['/home/user', '--companies', 'cmp_A;echo', 'cmp_A/../B']) expect(parseCompanionAction({ action: 'select-sync-scope', scopeId })).toBeNull();
    expect(parseCompanionAction({ action: 'select-sync-scope', scopeId: 'personal' })).toEqual({ action: 'select-sync-scope', scopeId: 'personal' });
    expect(parseCompanionAction({ action: 'sign-in', scopeId: 'personal' })).toBeNull();
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
