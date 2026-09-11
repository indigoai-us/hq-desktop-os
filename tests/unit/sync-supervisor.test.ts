import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fork, type ChildProcess } from 'node:child_process';
import type { AccountSession } from '../../src/main/auth';
vi.mock('node:child_process', () => ({ fork: vi.fn() }));
import { SyncSupervisor } from '../../src/main/sync-supervisor';
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.resetAllMocks(); });
function fixture() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), connected: true, send: vi.fn(), kill: vi.fn() });
  vi.mocked(fork).mockReturnValue(child as unknown as ChildProcess);
  const account = { identity: { sub: 'account-a', label: 'A' }, bearer: vi.fn(async () => 'token-a') };
  const sync = new SyncSupervisor(account as unknown as AccountSession);
  sync.start('/tmp/HQ', 'personal', { HOME: '/tmp/home' });
  return { child, account, sync };
}
describe('owned sync process lifecycle', () => {
  it('answers every concurrent token request', async () => {
    const { child, account } = fixture();
    let release!: (value: string) => void;
    const pending = new Promise<string>(resolve => { release = resolve; }); account.bearer.mockReturnValue(pending);
    child.emit('message', { type: 'token-request', id: 1 }); child.emit('message', { type: 'token-request', id: 2 });
    release('token-a'); await vi.waitFor(() => expect(child.send).toHaveBeenCalledTimes(2));
    expect(child.send.mock.calls.map(call => call[0].id)).toEqual([1, 2]); child.emit('close', 0);
  });
  it('defaults interactive sync to abort so conflicts surface', () => {
    fixture();
    expect(vi.mocked(fork).mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['--on-conflict', 'abort']));
  });
  it('restarts with an explicit one-shot conflict strategy when requested', () => {
    const { child, sync } = fixture();
    child.emit('close', 0);
    sync.start('/tmp/HQ', 'personal', { HOME: '/tmp/home' }, 'publish-local');
    expect(vi.mocked(fork).mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(['--on-conflict', 'publish-local']));
  });
  it('stops without delivering a different account token to an existing worker', async () => {
    vi.useFakeTimers();
    const { child, account } = fixture();
    account.identity = { sub: 'account-b', label: 'B' }; account.bearer.mockResolvedValue('token-b');
    child.emit('message', { type: 'token-request', id: 1 }); await vi.advanceTimersByTimeAsync(1);
    expect(child.send).toHaveBeenCalledWith({ type: 'stop' }, expect.any(Function));
    expect(child.send.mock.calls.some(call => 'token' in call[0])).toBe(false); child.emit('close', 0);
  });
  it('keeps ownership until process closure and refuses overlapping starts', async () => {
    const { child, sync } = fixture(); const stopped = sync.pause();
    expect(sync.running).toBe(true); expect(() => sync.start('/tmp/Other', 'personal', {})).toThrow('stop');
    child.emit('close', 0); await stopped;
    expect(sync.running).toBe(false); expect(sync.state.phase).toBe('paused');
  });
  it('preserves conflict phase when the runner exits after aborting a pass', () => {
    const { child, sync } = fixture();
    child.stdout.write('{"type":"conflict","path":"notes/shared-draft.md"}\n');
    child.emit('close', 0);
    expect(sync.state).toMatchObject({ phase: 'conflict', conflictPaths: ['notes/shared-draft.md'], conflicts: 1 });
  });
  it('does not infer success from a clean process exit or untrusted prose', () => {
    const { child, sync } = fixture();
    child.stdout.write('{"type":"auth-error","message":"secret host details"}\n'); child.emit('close', 0);
    expect(sync.state.phase).toBe('not-connected'); expect(sync.state.lastSuccess).toBeNull();
    expect(sync.state.message).not.toContain('secret');
  });
});
