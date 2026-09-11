import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SyncSelection { root: string; sub: string; scope: string; enabled: boolean }
/** A single explicit choice. It never grants membership or folder access. */
export class SyncSelectionStore {
  constructor(private readonly directory: string) {}
  async read(root: string, sub: string): Promise<SyncSelection | undefined> {
    let value: unknown;
    try { value = JSON.parse(await readFile(join(this.directory, 'sync-selection.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (!value || typeof value !== 'object') throw new Error('Your saved sync choice could not be read.');
    const saved = value as SyncSelection;
    if (typeof saved.root !== 'string' || typeof saved.sub !== 'string' || typeof saved.scope !== 'string' || typeof saved.enabled !== 'boolean' || (saved.scope !== 'all' && saved.scope !== 'personal' && !/^cmp_[a-zA-Z0-9]+$/.test(saved.scope))) throw new Error('Your saved sync choice could not be read.');
    return saved.root === root && saved.sub === sub ? saved : undefined;
  }
  async save(selection: SyncSelection): Promise<void> {
    const file = join(this.directory, 'sync-selection.json');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(`${file}.tmp`, JSON.stringify(selection), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }
}
