import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, parse } from 'node:path';

/** Case-fold on Windows; preserve exact bytes on Linux (and WSL Linux paths). */
export function pathIdentity(root: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? root.toLowerCase() : root;
}

/** Resolve aliases to one physical root; refuse filesystem roots. */
export async function resolveWorkspaceRoot(selected: string): Promise<string> {
  const root = await realpath(selected);
  if (!(await stat(root)).isDirectory() || root === parse(root).root) {
    throw new Error('Choose an HQ workspace folder, not a filesystem root.');
  }
  return root;
}

/** Attach/select require a readable+writable directory owned by the user session. */
export async function assertReadableWritableDirectory(root: string): Promise<void> {
  try {
    await access(root, constants.R_OK | constants.W_OK);
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw new Error('HQ needs permission to read and write this folder. Check the folder permissions, then try again.');
    }
    throw error;
  }
}

/**
 * Existing workspaces must already look like HQ. Attaching never rewrites contents.
 * Markers are directory presence only — not a recursive ACL scan.
 */
export async function assertHqWorkspaceLayout(root: string): Promise<void> {
  const markers = await Promise.all(['companies', 'core'].map(async (name) => {
    try {
      return (await stat(join(root, name))).isDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }));
  if (!markers.every(Boolean)) {
    throw new Error('This folder does not look like an HQ workspace. Choose your HQ folder, or use Set up HQ to create one.');
  }
}
