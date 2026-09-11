import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c } from 'tar';
import {
  createWorkspace,
  initialSetup,
  recoverInterruptedSetup,
  SetupJournal,
} from '../../src/main/setup';

const roots: string[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'hq-setup-native-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function archive() {
  const root = await temp();
  await mkdir(join(root, 'release/core'), { recursive: true });
  await writeFile(join(root, 'release/core/hello.txt'), 'HQ');
  const file = join(root, 'template.tar.gz');
  await c({ cwd: root, file, gzip: true }, ['release']);
  return readFile(file);
}

describe('US-011 resumable native workspace setup (Linux)', () => {
  it('creates a fresh HQ root without touching unrelated files', async () => {
    const root = await temp();
    await writeFile(join(root, 'keep.txt'), 'mine');
    const bytes = await archive();
    const workspace = await createWorkspace(root, async () => bytes);
    expect(await readFile(join(workspace, 'core/hello.txt'), 'utf8')).toBe('HQ');
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('mine');
    expect(await readdir(root)).toEqual(expect.arrayContaining(['HQ', 'keep.txt']));
  });

  it('recovers content owned by the same setup session after interruption', async () => {
    const root = await temp();
    const bytes = await archive();
    const owner = 'setup-session';
    const created = await createWorkspace(root, async () => bytes, owner);
    const recovered = await createWorkspace(root, async () => {
      throw new Error('must not download twice');
    }, owner);
    expect(recovered).toBe(created);
  });

  it('persists step outcomes and resumes failed steps after a crash marker', async () => {
    const root = await temp();
    const journal = new SetupJournal(join(root, 'setup.json'));
    const state = initialSetup(join(root, 'HQ'));
    state.steps[0]!.status = 'ready';
    state.steps[1]!.status = 'working';
    await journal.save(state);

    const loaded = await journal.load();
    expect(loaded).toEqual(state);
    const recovered = recoverInterruptedSetup(loaded!);
    expect(recovered.steps[0]!.status).toBe('ready');
    expect(recovered.steps[1]!.status).toBe('error');
    expect(recovered.complete).toBe(false);
    expect(recovered.error).toMatch(/stopped unexpectedly|continue/i);

    await journal.save(recovered);
    const again = await journal.load();
    expect(again?.steps.map((step) => step.status)).toEqual(['ready', 'error', 'waiting']);
  });

  it('refuses to treat corrupt journal state as resumable progress', async () => {
    const root = await temp();
    const journal = new SetupJournal(join(root, 'setup.json'));
    await writeFile(join(root, 'setup.json'), '{"id":"x"}');
    await expect(journal.load()).rejects.toThrow(/could not be read/i);
  });
});
