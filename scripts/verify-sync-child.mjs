import { fork, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const appRoot = resolve(process.argv[2] || '.');
const electron = process.argv[3] || require('electron');
const appRequire = createRequire(join(appRoot, 'package.json'));
const locks = pathToFileURL(join(dirname(appRequire.resolve('@indigoai-us/hq-cloud/package.json')), 'dist/operation-lock.js')).href;
const directory = await mkdtemp(join(tmpdir(), 'hq-runner-boundary-'));
const root = join(directory, 'HQ'); const shared = join(directory, 'shared'); const isolated = join(directory, 'isolated');
await mkdir(root);
let child;
try {
  child = fork(join(appRoot, 'dist/main/sync-child.js'), ['--hq-root', root, '--personal', '--watch', '--direction', 'both', '--on-conflict', 'keep'], {
    execPath: electron, execArgv: [], env: { HOME: directory, PATH: '/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '1', HQ_STATE_DIR: isolated, HQ_DESKTOP_SHARED_STATE_DIR: shared }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data.toString()).slice(-4096); });
  const closed = new Promise(resolve => child.once('close', code => resolve(code)));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Child did not reach its private token boundary: ' + output)), 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('message', message => { clearTimeout(timer); if (message.type !== 'token-request') reject(new Error('Unexpected child protocol')); else resolve(); });
  });
  const probe = () => spawnSync(electron, ['-e', `import(${JSON.stringify(locks)}).then(m => { try { const h = m.acquireOperationLock(${JSON.stringify(root)}, 'sync', {wait:false}); h.release(); process.exit(0); } catch(e) { process.exit(e.name === 'OperationLockedError' ? 17 : 1); } })`], { env: { HOME: directory, PATH: '/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '1', HQ_STATE_DIR: shared }, timeout: 10000 });
  if (probe().status !== 17) throw new Error('Desktop did not exclude a concurrent CLI writer');
  child.send({ type: 'stop' });
  const status = await Promise.race([closed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Child did not stop')), 10000); timer.unref(); })]);
  if (status !== 0 || probe().status !== 0) throw new Error('Child did not release its owned gate');
  if ((await readdir(shared)).some(name => name.includes('token') || name.includes('journal'))) throw new Error('Child wrote account or journal state into the shared directory');
  console.log('PASS: packaged Node starts the actual shared engine, private token IPC is required, concurrent CLI is excluded, and cancellation releases ownership. No token or network sync was used.');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Owned child did not exit; preserving its directory')), 5000);
      child.once('close', () => { clearTimeout(timer); resolve(); }); child.kill('SIGKILL');
    });
  }
  await rm(directory, { recursive: true, force: true });
}
