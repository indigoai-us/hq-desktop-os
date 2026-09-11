import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);
const repoRoot = join(__dirname, '..', '..');

/**
 * Build the app and stage the real production runtime once per run so every
 * native spec exercises the same honest packaged artifact.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.HQ_SKIP_RUNTIME_STAGE === '1') return;
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  for (const script of ['build', 'stage:runtime']) {
    await execFileAsync(pnpm, ['run', script], {
      cwd: repoRoot,
      maxBuffer: 32 * 1024 * 1024,
      shell: process.platform === 'win32',
    });
  }
}
