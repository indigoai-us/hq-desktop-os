/**
 * Assemble a real Electron production runtime from the built output.
 *
 * Installers are a later story; this stages the same layout an installer ships:
 * the Electron binary renamed to the product, with `resources/app` holding the
 * compiled main, preload and renderer. Because the executable is no longer
 * named `electron`, `app.isPackaged` is genuinely true and the app takes its
 * production branches (the confined app:// renderer scheme and the packaged
 * CSP) with no test overrides.
 */
import { chmod, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const electronDist = join(repoRoot, 'node_modules', 'electron', 'dist');
const stageDir = join(repoRoot, 'dist-runtime');
const isWindows = process.platform === 'win32';
const productBinary = isWindows ? 'hq-desktop-os.exe' : 'hq-desktop-os';
const electronBinary = isWindows ? 'electron.exe' : 'electron';

async function main() {
  if (!existsSync(electronDist)) {
    throw new Error(`Electron runtime is not installed at ${electronDist}`);
  }
  for (const required of ['main/index.js', 'preload/index.js', 'renderer/index.html']) {
    if (!existsSync(join(repoRoot, 'dist', required))) {
      throw new Error(`Run "pnpm build" first: dist/${required} is missing`);
    }
  }

  await rm(stageDir, { recursive: true, force: true });
  await cp(electronDist, stageDir, { recursive: true, verbatimSymlinks: true });
  await rename(join(stageDir, electronBinary), join(stageDir, productBinary));

  const appDir = join(stageDir, 'resources', 'app');
  await mkdir(appDir, { recursive: true });
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  await writeFile(
    join(appDir, 'package.json'),
    `${JSON.stringify({ name: pkg.name, productName: 'HQ Desktop OS', version: pkg.version, main: 'dist/main/index.js' }, null, 2)}\n`,
  );
  await cp(join(repoRoot, 'dist'), join(appDir, 'dist'), { recursive: true });

  if (!isWindows) {
    await chmod(join(stageDir, productBinary), 0o755);
  }
  process.stdout.write(`Staged production runtime: ${join(stageDir, productBinary)}\n`);
}

await main();
