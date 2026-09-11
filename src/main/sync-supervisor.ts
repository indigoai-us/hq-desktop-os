import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { AccountSession } from './auth.js';
import type { ConflictChoice } from '../shared/companion.js';
import { pausedSync, reduceSync, RunnerLines, type SyncState } from './sync-state.js';
export class SyncSupervisor {
  private child?: ChildProcess;
  private stopping?: Promise<void>;
  state: SyncState = pausedSync();
  get running(): boolean { return !!this.child; }
  constructor(private readonly account: AccountSession) {}
  /**
   * Interactive desktop defaults to `--on-conflict abort` so conflicts surface
   * instead of silently keeping local. A one-shot resolve restarts this child
   * with the user's explicit strategy for that pass; callers should return to
   * abort afterward so overwrite/keep never become a sticky bulk default.
   */
  start(root: string, scopeId: string, env: NodeJS.ProcessEnv, onConflict: ConflictChoice = 'abort'): void {
    if (this.child || this.stopping) throw new Error('Wait for sync to stop before starting again.');
    if (scopeId !== 'all' && scopeId !== 'personal' && !/^cmp_[a-zA-Z0-9]+$/.test(scopeId)) throw new Error('Choose a shared workspace again.');
    if (!['abort', 'keep', 'publish-local', 'overwrite'].includes(onConflict)) throw new Error('Choose how to resolve conflicting files.');
    const expectedSub = this.account.identity?.sub;
    if (!expectedSub) throw new Error('Sign in before starting sync.');
    this.state = { ...pausedSync(), phase: 'syncing', message: 'Connecting your files' };
    // `all` → hq-cloud `--companies` fanout (personal + every active membership),
    // matching hq-desktop-app Sync Now. Single targets stay explicit.
    const scopeArgs = scopeId === 'all' ? ['--companies'] : scopeId === 'personal' ? ['--personal'] : ['--company', scopeId];
    const child = fork(join(__dirname, 'sync-child.js'), ['--hq-root', root, ...scopeArgs, '--direction', 'both', '--on-conflict', onConflict, '--watch', '--event-push'], {
      execPath: process.execPath, execArgv: [], detached: process.platform !== 'win32', cwd: root, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    this.child = child;
    const consume = (event: Record<string, unknown>) => { if (this.child === child && !this.stopping) this.state = reduceSync(this.state, event); };
    for (const stream of [child.stdout, child.stderr]) { const lines = new RunnerLines(consume); stream?.setEncoding('utf8'); stream?.on('data', (chunk: string) => lines.push(chunk)); }
    child.on('message', (raw: unknown) => {
      const message = raw as { type?: string; id?: number };
      if (this.child !== child || this.stopping) return;
      if (message?.type === 'auth-refused') { this.state = { ...this.state, phase: 'not-connected', message: 'Sign in again to continue syncing' }; void this.stop().catch(error => { console.error('Sync stop failed', error instanceof Error ? error.name : 'unknown'); }); return; }
      if (message?.type !== 'token-request' || typeof message.id !== 'number') return;
      void this.account.bearer().then(token => {
        if (this.account.identity?.sub !== expectedSub) { void this.stop().catch(error => console.error('Sync stop failed', error instanceof Error ? error.name : 'unknown')); return; }
        if (this.child === child && child.connected && !this.stopping) child.send({ type: 'token', id: message.id, token, sub: this.account.identity?.sub, name: this.account.identity?.label }, error => { if (error) console.error('Sync account pipe closed'); });
      }).catch((error: unknown) => {
        console.error('Sync account unavailable', error instanceof Error ? error.name : 'unknown');
        if (this.child === child && child.connected) child.send({ type: 'token', id: message.id, retryable: !!this.account.identity }, error => { if (error) console.error('Sync account pipe closed'); });
        if (!this.account.identity) this.state = { ...this.state, phase: 'not-connected', message: 'Sign in again to continue syncing' };
      });
    });
    child.once('error', (error: Error) => { console.error('Sync could not start', error.name); this.state = { ...this.state, phase: 'error', message: 'Sync could not start. Please try again.' }; });
    child.once('close', () => { if (this.child === child) { this.child = undefined; if (!this.stopping && !['not-connected', 'error', 'conflict'].includes(this.state.phase)) this.state = { ...this.state, phase: 'error', message: 'Sync stopped. Please try again.' }; } });
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const child = this.child; if (!child) return Promise.resolve();
    this.stopping = new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        if (child.pid && process.platform !== 'win32') {
          try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.error('Sync process group could not be stopped'); }
        } else child.kill('SIGKILL');
      }, 10_000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
      if (child.connected) child.send({ type: 'stop' }, error => { if (error) { console.error('Sync stop connection unavailable'); child.kill('SIGKILL'); } });
      else child.kill('SIGKILL');
    }).finally(() => { this.stopping = undefined; });
    return this.stopping;
  }
  async pause(): Promise<void> { await this.stop(); this.state = { ...this.state, phase: 'paused', message: 'Sync is paused' }; }
  async reset(): Promise<void> { await this.stop(); this.state = pausedSync(); }
}
