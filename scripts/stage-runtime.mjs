/** Stage the packager's real production dependency tree for native tests. */
import { execFile } from 'node:child_process';
import { cp, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const stageDir = join(repoRoot, 'dist-runtime');
const output = join(repoRoot, 'release/runtime-stage');
const isWindows = process.platform === 'win32';
const builderRequire = createRequire(require.resolve('electron-builder'));
const packagerRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const { extractAll } = packagerRequire('@electron/asar');
await promisify(execFile)(process.execPath, [join(dirname(require.resolve('electron-builder/package.json')), 'cli.js'), '--dir', isWindows ? '--win' : '--linux', '--x64', '--publish', 'never', `--config.directories.output=${output}`], { cwd: repoRoot, timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
const source = join(output, isWindows ? 'win-unpacked' : 'linux-unpacked');
await rm(stageDir, { recursive: true, force: true });
await cp(source, stageDir, { recursive: true });
const productBinary = isWindows ? 'hq-desktop-os.exe' : 'hq-desktop-os';
if (isWindows) await rename(join(stageDir, 'HQ Desktop OS.exe'), join(stageDir, productBinary));
// Native specs inspect renderer/preload bytes through ordinary Node fs. Unpack
// the exact archive, including native dependencies, without altering app code.
const archive = join(stageDir, 'resources/app.asar');
if (!existsSync(archive)) throw new Error('Packager did not produce the application archive');
extractAll(archive, join(stageDir, 'resources/app'));
await rm(archive);
console.log(`Staged production runtime: ${join(stageDir, productBinary)}`);
