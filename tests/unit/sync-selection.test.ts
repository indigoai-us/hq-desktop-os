import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyncSelectionStore } from '../../src/main/sync-selection';

describe('saved sync intent', () => {
  it('restores only the same folder and account, including an explicit pause', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-sync-choice-'));
    try {
      const store = new SyncSelectionStore(directory);
      expect(await store.read('/HQ', 'alice')).toBeUndefined();
      const choice = { root: '/HQ', sub: 'alice', scope: 'cmp_A', enabled: true };
      await store.save(choice);
      expect(await new SyncSelectionStore(directory).read('/HQ', 'alice')).toEqual(choice);
      expect(await store.read('/other', 'alice')).toBeUndefined();
      expect(await store.read('/HQ', 'bob')).toBeUndefined();
      await store.save({ ...choice, enabled: false });
      expect(await store.read('/HQ', 'alice')).toMatchObject({ enabled: false });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('refuses malformed scope and intent instead of enabling sync', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-sync-choice-'));
    try {
      for (const choice of [{ root: '/HQ', sub: 'alice', scope: '../other', enabled: true }, { root: '/HQ', sub: 'alice', scope: 'personal', enabled: 'true' }]) {
        await writeFile(join(directory, 'sync-selection.json'), JSON.stringify(choice));
        await expect(new SyncSelectionStore(directory).read('/HQ', 'alice')).rejects.toThrow('could not be read');
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
