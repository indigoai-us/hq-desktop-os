import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, posix, relative, resolve } from 'node:path';
import { x, t } from 'tar';
export {
  SetupJournal,
  initialSetup,
  recoverInterruptedSetup,
  type SetupState,
  type SetupStep,
} from './setup-state.js';

/** Reviewed release asset. Updates to the scaffold go through code review. */
export const HQ_TEMPLATE = {
  version: '15.0.126',
  url: 'https://github.com/indigoai-us/hq-core/releases/download/v15.0.126/hq-core-v15.0.126.tar.gz',
  sha256: '9ce98cf2912dcc7fb8d94b6a0fb5da095fc5c6403625c7d51b444319466c8945',
};

export async function verifiedDownload(url: string, digest: string, maximum = 64 * 1024 * 1024, signal?: AbortSignal): Promise<Buffer> {
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000), redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error('The download did not finish. Check your connection and try again.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > maximum) throw new Error('This download was larger than expected. Please try again later.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks);
  if (!/^[a-f0-9]{64}$/.test(digest) || createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('We could not verify the download. Nothing has been installed.');
  return bytes;
}

export function safeArchivePath(path: string, link?: string): boolean {
  const parts = path.replaceAll('\\', '/').split('/');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || parts.includes('..')) return false;
  const stripped = parts.slice(1).join('/');
  if (!link) return true;
  if (link.startsWith('/') || /^[A-Za-z]:/.test(link) || link.includes('\\')) return false;
  const target = posix.resolve('/workspace', posix.dirname(stripped), link);
  return target === '/workspace' || target.startsWith('/workspace/');
}

export async function extractTemplate(archive: string, target: string): Promise<void> {
  let bytes = 0; let count = 0; let invalid = false;
  await t({ file: archive, strict: true, onReadEntry(entry) {
    bytes += entry.size; count++;
    if (bytes > 256 * 1024 * 1024 || count > 30_000 || !safeArchivePath(entry.path, entry.linkpath) || !['File', 'Directory', 'SymbolicLink'].includes(entry.type)) invalid = true;
  } });
  if (invalid) throw new Error('The workspace download could not be safely opened. Nothing has been installed.');
  await x({ file: archive, cwd: target, strip: 1, strict: true, preservePaths: false, noChmod: false });
  if (!(await stat(join(target, 'core'))).isDirectory()) throw new Error('The workspace download is incomplete. Please try again.');
}

/** Only a newly created, app-owned staging folder is extracted or removed. */
export async function createWorkspace(parent: string, download = () => verifiedDownload(HQ_TEMPLATE.url, HQ_TEMPLATE.sha256), ownerId?: string): Promise<string> {
  const base = await realpath(parent); const destination = join(base, 'HQ');
  if (ownerId) {
    try {
      const marker = JSON.parse(await readFile(join(destination, '.hq-desktop-setup.json'), 'utf8')) as { ownerId: string };
      if (marker.ownerId === ownerId && (await stat(join(destination, 'core'))).isDirectory() && (await realpath(destination)) === destination) return destination;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  try { await stat(destination); throw new Error('There is already an HQ folder here. Choose it as an existing folder, or select another location.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const staging = await mkdtemp(join(base, '.hq-setup-'));
  try {
    const archive = join(staging, 'template.tar.gz'); const content = join(staging, 'workspace');
    await mkdir(content, { mode: 0o700 }); await writeFile(archive, await download(), { mode: 0o600 });
    await extractTemplate(archive, content);
    for (const path of ['companies', 'personal/knowledge', 'personal/policies', 'personal/workers', 'personal/skills', 'personal/settings', 'workspace', 'repos/public', 'repos/private']) await mkdir(join(content, path), { recursive: true });
    if (ownerId) await writeFile(join(content, '.hq-desktop-setup.json'), JSON.stringify({ ownerId, version: HQ_TEMPLATE.version }), { mode: 0o600 });
    // Reserve the destination atomically so another setup or user folder is never replaced.
    await mkdir(destination, { mode: 0o700 });
    try { await rename(content, destination); }
    catch (error) { throw new Error('We could not finish creating your folder. Your existing files have not been changed.', { cause: error }); }
    return destination;
  } finally { await rm(staging, { recursive: true, force: true }); }
}

export function isWithin(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path)); return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}
