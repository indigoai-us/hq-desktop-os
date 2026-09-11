import { spawn } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join, isAbsolute } from 'node:path';
import { x } from 'tar';
import { verifiedDownload } from './setup.js';

export const REQUIRED_DEPENDENCIES = ['node', 'git', 'yq', 'qmd', 'hq', 'jq'] as const;
export const TOOL_VERSIONS = { node: '22.17.0', qmd: '2.5.3', hq: '5.109.6', yq: '4.47.1', jq: '1.8.1' };
interface BinaryAsset { url: string; sha256: string }
const LINUX_X64: Record<'node' | 'yq' | 'jq', BinaryAsset> = {
  node: { url: 'https://nodejs.org/dist/v22.17.0/node-v22.17.0-linux-x64.tar.gz', sha256: '0fa01328a0f3d10800623f7107fbcd654a60ec178fab1ef5b9779e94e0419e1a' },
  yq: { url: 'https://github.com/mikefarah/yq/releases/download/v4.47.1/yq_linux_amd64', sha256: '0fb28c6680193c41b364193d0c0fc4a03177aecde51cfc04d506b1517158c2fb' },
  jq: { url: 'https://github.com/jqlang/jq/releases/download/jq-1.8.1/jq-linux-amd64', sha256: '020468de7539ce70ef1bceaf7cde2e8c4f2ca6c3afb84642aabc5c97d9fc2a0d' },
};

export async function findExecutable(name: string, path: string): Promise<string | undefined> {
  for (const directory of path.split(delimiter)) {
    if (!isAbsolute(directory)) continue; // Never resolve tools from the selected workspace.
    const file = join(directory, process.platform === 'win32' ? `${name}.exe` : name);
    try { await access(file, constants.X_OK); return file; }
    catch (error) { if (!['ENOENT', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  }
  return undefined;
}

/** Setup owns these processes; no shell interpolation and no unbounded installer. */
export function runSetupCommand(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal; timeout?: number }): Promise<string> {
  if (options.signal.aborted) return Promise.reject(new Error('Setup was canceled. You can continue when you’re ready.'));
  return new Promise((resolve, reject) => {
    let output = ''; let ended = false; let stopped = false;
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    const stop = () => {
      stopped = true;
      if (child.pid && process.platform !== 'win32') {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') { console.error('Setup process could not be stopped', (error as Error).name); child.kill('SIGKILL'); } }
      } else child.kill('SIGKILL');
    };
    const timer = setTimeout(stop, options.timeout ?? 180_000);
    const finish = (error?: Error) => {
      if (ended) return; ended = true; clearTimeout(timer); options.signal.removeEventListener('abort', stop);
      if (error) reject(error); else resolve(output);
    };
    options.signal.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-16_384); });
    child.stderr.on('data', () => { /* Drain installer output; it can contain host paths. Exit status is handled below. */ });
    child.once('error', () => finish(new Error('A required setup tool could not start. Please try again.')));
    child.once('close', code => { if (code !== 0) console.error('Setup process ended before completion', { code, stopped }); finish(stopped ? new Error('Setup stopped before it finished. You can try again.') : code === 0 ? undefined : new Error('A setup step did not finish. Check your connection and try again.')); });
  });
}

export function toolchainPath(directory: string, systemPath = process.env.PATH ?? '/usr/bin:/bin'): string {
  return [join(directory, `node-${TOOL_VERSIONS.node}/bin`), join(directory, 'bin'), join(directory, 'packages/bin'), systemPath].join(delimiter);
}

/** A private toolchain does not change the user's Node installation or shell profile. */
export async function prepareDependencies(directory: string, signal: AbortSignal, progress: (label: string) => void): Promise<string> {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Automatic setup for this computer is not available yet. You can still add an existing HQ folder.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const nodeHome = join(directory, `node-${TOOL_VERSIONS.node}`); const bin = join(directory, 'bin'); const prefix = join(directory, 'packages');
  await mkdir(bin, { recursive: true });
  const node = join(nodeHome, 'bin/node');
  try { await access(node, constants.X_OK); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    progress('Preparing the software HQ needs');
    const staging = await mkdtemp(join(directory, '.node-'));
    try {
      const archive = join(staging, 'node.tar.gz'); const content = join(staging, 'node'); await mkdir(content);
      await writeFile(archive, await verifiedDownload(LINUX_X64.node.url, LINUX_X64.node.sha256, undefined, signal));
      await x({ file: archive, cwd: content, strip: 1, strict: true, preservePaths: false });
      await rename(content, nodeHome);
    } finally { await rm(staging, { force: true, recursive: true }); }
  }
  const path = toolchainPath(directory);
  const env = { HOME: join(directory, 'home'), HQ_STATE_DIR: join(directory, 'state'), PATH: path, npm_config_prefix: prefix, npm_config_cache: join(directory, 'npm-cache'), npm_config_userconfig: join(directory, 'npmrc'), npm_config_globalconfig: join(directory, 'global-npmrc') };
  await mkdir(env.HOME, { recursive: true, mode: 0o700 });
  // The app must not import a user's registry credentials or npm lifecycle configuration.
  await writeFile(env.npm_config_userconfig, 'registry=https://registry.npmjs.org/\n', { mode: 0o600 });
  await writeFile(env.npm_config_globalconfig, '', { mode: 0o600 });
  const run = (cmd: string, args: string[], timeout?: number) => runSetupCommand(cmd, args, { cwd: directory, env, signal, timeout });
  if ((await run(node, ['--version'], 10_000)).trim() !== `v${TOOL_VERSIONS.node}`) throw new Error('The setup software could not be verified. Please try again.');
  for (const name of ['yq', 'jq'] as const) {
    const executable = join(bin, name);
    try { await access(executable, constants.X_OK); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      progress('Adding tools for your workspace');
      await writeFile(`${executable}.tmp`, await verifiedDownload(LINUX_X64[name].url, LINUX_X64[name].sha256, undefined, signal), { mode: 0o700 });
      await chmod(`${executable}.tmp`, 0o700); await rename(`${executable}.tmp`, executable);
    }
    await run(executable, ['--version'], 10_000);
  }
  const git = await findExecutable('git', '/usr/local/bin:/usr/bin:/bin');
  if (!git) throw new Error('HQ needs Git on this computer. Install Git from your software center, then choose Continue setup.');
  await run(git, ['--version'], 10_000);
  const npm = join(nodeHome, 'lib/node_modules/npm/bin/npm-cli.js');
  for (const [name, packageName, version] of [['qmd', '@tobilu/qmd', TOOL_VERSIONS.qmd], ['hq', '@indigoai-us/hq-cli', TOOL_VERSIONS.hq]]) {
    const installedManifest = join(prefix, 'lib/node_modules', packageName!, 'package.json');
    let installed = false;
    try { installed = (JSON.parse(await readFile(installedManifest, 'utf8')) as { version: string }).version === version; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (!installed) {
      progress(name === 'qmd' ? 'Preparing search' : 'Installing HQ');
      await run(node, [npm, 'install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', `${packageName}@${version}`], 10 * 60_000);
    }
    await run(join(prefix, 'bin', name!), ['--version'], 30_000);
  }
  return path;
}
