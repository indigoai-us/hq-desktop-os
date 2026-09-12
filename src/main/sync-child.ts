import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RunnerDeps, RunnerPassResult } from '../../node_modules/@indigoai-us/hq-cloud/dist/bin/sync-runner.js' with { 'resolution-mode': 'import' };
import { DESKTOP_SYNC_LOCK, DESKTOP_SYNC_LOCK_MODE } from './sync/ownership.js';

// This entry point is started only by main with a private IPC pipe. Tokens never
// appear in argv, the environment, stdout, or a shared CLI token cache.
async function main(): Promise<void> {
  if (!process.send) throw new Error('Private parent connection required');
  const shutdownHandlers = new Set<() => void>();
  process.on('message', (raw: unknown) => {
    if ((raw as { type?: string })?.type !== 'stop') return;
    if (!shutdownHandlers.size) process.exit(0);
    for (const stop of shutdownHandlers) stop();
  });
  const packageDirectory = dirname(require.resolve('@indigoai-us/hq-cloud/package.json'));
  const locks = await import(pathToFileURL(join(packageDirectory, 'dist/operation-lock.js')).href) as typeof import('../../node_modules/@indigoai-us/hq-cloud/dist/operation-lock.js', { with: { 'resolution-mode': 'import' } });
  const stateDirectory = process.env.HQ_STATE_DIR;
  if (!stateDirectory || !process.env.HQ_DESKTOP_SHARED_STATE_DIR) throw new Error('Sync state directory required');
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  // Synchronous acquisition before any work; the returned SDK handle and exit hook
  // retain the concrete lock path when the journal environment is restored.
  // Private journals stay under HQ_STATE_DIR so a supervisor restart during apply
  // reuses recoverable engine state instead of discarding it.
  process.env.HQ_STATE_DIR = process.env.HQ_DESKTOP_SHARED_STATE_DIR;
  try {
    locks.acquireOperationLock(process.argv[process.argv.indexOf('--hq-root') + 1]!, DESKTOP_SYNC_LOCK, {
      wait: false,
      mode: DESKTOP_SYNC_LOCK_MODE,
    });
  } finally {
    process.env.HQ_STATE_DIR = stateDirectory;
  }
  const { CognitoRefreshError } = await import('@indigoai-us/hq-cloud');
  let sequence = 0;
  let claims: { sub: string; name: string } | null = null;
  const pending = new Map<number, { resolve: (token: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  process.on('message', (raw: unknown) => {
    const message = raw as { type?: string; id?: number; token?: string; sub?: string; name?: string; retryable?: boolean };
    if (message?.type !== 'token' || typeof message.id !== 'number') return;
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (typeof message.token !== 'string' || !message.sub) { request.reject(new CognitoRefreshError('Account connection unavailable', !message.retryable)); return; }
    claims = { sub: message.sub, name: message.name ?? '' }; request.resolve(message.token);
  });
  process.on('disconnect', () => process.exit(0));
  const getAccessToken = () => new Promise<string>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Account connection timed out')); }, 30_000);
    pending.set(id, { resolve, reject, timer });
    process.send!({ type: 'token-request', id }, error => { if (error) { clearTimeout(timer); pending.delete(id); reject(error); } });
  });
  const getIdTokenClaims = () => claims;
  const entry = join(dirname(require.resolve('@indigoai-us/hq-cloud/package.json')), 'dist/bin/sync-runner.js');
  const runner = await import(pathToFileURL(entry).href) as typeof import('../../node_modules/@indigoai-us/hq-cloud/dist/bin/sync-runner.js', { with: { 'resolution-mode': 'import' } });
  await getAccessToken();
  const deps: RunnerDeps = { getAccessToken, getIdTokenClaims, clearSession: () => { process.send!({ type: 'auth-refused' }); }, operationLockAlreadyHeld: true, authRequiredExitCode: runner.AUTH_REQUIRED_PASS_EXIT };
  const code = await runner.runRunnerWithLoop(process.argv.slice(2), {
    getAccessToken, getIdTokenClaims,
    onShutdownSignal: handler => { shutdownHandlers.add(handler); return () => { shutdownHandlers.delete(handler); }; },
    runPass: async argv => {
      let result: RunnerPassResult | undefined;
      const exitCode = await runner.runRunner(argv, { ...deps, onPassResult: value => { result = value; } });
      return { exitCode, ...(result ? { result } : {}) };
    },
  });
  process.exit(code);
}
void main().catch((error: unknown) => { console.error(JSON.stringify({ type: 'error', reason: error instanceof Error ? error.name : 'unknown' })); process.exit(1); });
