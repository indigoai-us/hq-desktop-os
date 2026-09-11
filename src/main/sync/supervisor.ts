import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { AccountSession } from '../auth.js';
import type { ConflictChoice } from '../../shared/companion.js';
import { SYNC_RESTART_POLICY } from '../../shared/sync.js';
import { syncChildArgv } from './ownership.js';
import { pausedSync, reduceSync, RunnerLines, type SyncState } from './protocol.js';

interface LaunchSpec {
  root: string;
  scopeId: string;
  env: NodeJS.ProcessEnv;
  onConflict: ConflictChoice;
}

export class SyncSupervisor {
  private child?: ChildProcess;
  private stopping?: Promise<void>;
  private restartTimer?: NodeJS.Timeout;
  private restartAttempts = 0;
  private launch?: LaunchSpec;
  state: SyncState = pausedSync();

  /** True while a watcher process is alive or a bounded restart is pending. */
  get running(): boolean {
    return !!this.child || !!this.restartTimer;
  }

  constructor(private readonly account: AccountSession) {}

  /**
   * Interactive desktop defaults to `--on-conflict abort` so conflicts surface
   * instead of silently keeping local. A one-shot resolve restarts this child
   * with the user's explicit strategy for that pass; callers should return to
   * abort afterward so overwrite/keep never become a sticky bulk default.
   */
  start(root: string, scopeId: string, env: NodeJS.ProcessEnv, onConflict: ConflictChoice = 'abort'): void {
    if (this.child || this.stopping) throw new Error('Wait for sync to stop before starting again.');
    this.clearRestartTimer();
    const expectedSub = this.account.identity?.sub;
    if (!expectedSub) throw new Error('Sign in before starting sync.');
    // Validate argv up front (ownership helpers throw on bad scope/strategy).
    syncChildArgv(root, scopeId, onConflict);
    this.launch = { root, scopeId, env, onConflict };
    this.restartAttempts = 0;
    this.state = { ...pausedSync(), phase: 'syncing', message: 'Connecting your files' };
    this.spawnChild(expectedSub);
  }

  private spawnChild(expectedSub: string): void {
    const launch = this.launch;
    if (!launch) throw new Error('Sync launch is not configured.');
    const argv = syncChildArgv(launch.root, launch.scopeId, launch.onConflict);
    // `all` → hq-cloud `--companies` fanout (personal + every active membership).
    const child = fork(join(__dirname, '..', 'sync-child.js'), argv, {
      execPath: process.execPath,
      execArgv: [],
      detached: process.platform !== 'win32',
      cwd: launch.root,
      env: { ...launch.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    this.child = child;
    const consume = (event: Record<string, unknown>) => {
      if (this.child !== child || this.stopping) return;
      this.state = reduceSync(this.state, event);
      if (event.type === 'all-complete' && this.state.phase === 'idle' && this.state.lastSuccess) {
        this.restartAttempts = 0;
      }
    };
    for (const stream of [child.stdout, child.stderr]) {
      const lines = new RunnerLines(consume);
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk: string) => lines.push(chunk));
    }
    child.on('message', (raw: unknown) => {
      const message = raw as { type?: string; id?: number };
      if (this.child !== child || this.stopping) return;
      if (message?.type === 'auth-refused') {
        this.state = { ...this.state, phase: 'not-connected', message: 'Sign in again to continue syncing' };
        void this.stop().catch(error => {
          console.error('Sync stop failed', error instanceof Error ? error.name : 'unknown');
        });
        return;
      }
      if (message?.type !== 'token-request' || typeof message.id !== 'number') return;
      void this.account.bearer().then(token => {
        if (this.account.identity?.sub !== expectedSub) {
          void this.stop().catch(error => console.error('Sync stop failed', error instanceof Error ? error.name : 'unknown'));
          return;
        }
        if (this.child === child && child.connected && !this.stopping) {
          child.send(
            { type: 'token', id: message.id, token, sub: this.account.identity?.sub, name: this.account.identity?.label },
            error => {
              if (error) console.error('Sync account pipe closed');
            },
          );
        }
      }).catch((error: unknown) => {
        console.error('Sync account unavailable', error instanceof Error ? error.name : 'unknown');
        if (this.child === child && child.connected) {
          child.send({ type: 'token', id: message.id, retryable: !!this.account.identity }, err => {
            if (err) console.error('Sync account pipe closed');
          });
        }
        if (!this.account.identity) {
          this.state = { ...this.state, phase: 'not-connected', message: 'Sign in again to continue syncing' };
        }
      });
    });
    child.once('error', (error: Error) => {
      console.error('Sync could not start', error.name);
      this.state = { ...this.state, phase: 'error', message: 'Sync could not start. Please try again.' };
    });
    child.once('close', () => {
      if (this.child !== child) return;
      this.child = undefined;
      if (this.stopping) return;
      // Conflict / auth need user action; do not crash-loop.
      if (['not-connected', 'conflict', 'paused'].includes(this.state.phase)) return;
      this.scheduleRestart(expectedSub);
    });
  }

  private scheduleRestart(expectedSub: string): void {
    if (!this.launch || this.stopping) return;
    if (this.account.identity?.sub !== expectedSub) {
      this.state = { ...this.state, phase: 'not-connected', message: 'Sign in again to continue syncing' };
      return;
    }
    if (this.restartAttempts >= SYNC_RESTART_POLICY.maxAttempts) {
      this.state = {
        ...this.state,
        phase: 'error',
        message: 'Sync stopped after several retries. Please try again.',
      };
      return;
    }
    const delay = Math.min(
      SYNC_RESTART_POLICY.maxMs,
      SYNC_RESTART_POLICY.baseMs * (2 ** this.restartAttempts),
    );
    this.restartAttempts += 1;
    this.state = {
      ...this.state,
      phase: this.state.phase === 'offline' ? 'offline' : 'syncing',
      message: 'Reconnecting your files',
    };
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (this.stopping || !this.launch) return;
      if (this.account.identity?.sub !== expectedSub) {
        this.state = { ...this.state, phase: 'not-connected', message: 'Sign in again to continue syncing' };
        return;
      }
      // Reuse the same HQ_STATE_DIR / env so engine journals survive across restarts.
      try {
        this.spawnChild(expectedSub);
      } catch (error) {
        console.error('Sync restart failed', error instanceof Error ? error.name : 'unknown');
        this.state = { ...this.state, phase: 'error', message: 'Sync could not restart. Please try again.' };
      }
    }, delay);
    this.restartTimer.unref?.();
  }

  private clearRestartTimer(): void {
    if (!this.restartTimer) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
  }

  stop(): Promise<void> {
    this.clearRestartTimer();
    if (this.stopping) return this.stopping;
    const child = this.child;
    if (!child) return Promise.resolve();
    this.stopping = new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        if (child.pid && process.platform !== 'win32') {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
              console.error('Sync process group could not be stopped');
            }
          }
        } else {
          child.kill('SIGKILL');
        }
      }, 10_000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      // Prefer private IPC stop so an in-flight apply can finish/checkpoint journals.
      if (child.connected) {
        child.send({ type: 'stop' }, error => {
          if (error) {
            console.error('Sync stop connection unavailable');
            child.kill('SIGKILL');
          }
        });
      } else {
        child.kill('SIGKILL');
      }
    }).finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }

  async pause(): Promise<void> {
    await this.stop();
    this.state = { ...this.state, phase: 'paused', message: 'Sync is paused' };
  }

  async reset(): Promise<void> {
    await this.stop();
    this.launch = undefined;
    this.restartAttempts = 0;
    this.state = pausedSync();
  }
}
