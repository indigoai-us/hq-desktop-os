import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c } from 'tar';
import { createWorkspace, safeArchivePath, SetupJournal, initialSetup } from '../../src/main/setup';
import { runSetupCommand } from '../../src/main/setup-dependencies';
const roots: string[] = [];
async function temp() { const root = await mkdtemp(join(tmpdir(), 'hq-setup-test-')); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true }))); });
async function archive() {
  const root = await temp(); await mkdir(join(root, 'release/core'), { recursive: true });
  await writeFile(join(root, 'release/core/hello.txt'), 'HQ');
  const file = join(root, 'template.tar.gz'); await c({ cwd: root, file, gzip: true }, ['release']); return readFile(file);
}
describe('fresh HQ setup', () => {
  it('creates HQ from an archive with the real workspace layout and cleans staging', async () => {
    const root = await temp(); const bytes = await archive();
    const workspace = await createWorkspace(root, async () => bytes);
    expect(await readFile(join(workspace, 'core/hello.txt'), 'utf8')).toBe('HQ');
    expect(await readdir(workspace)).toEqual(expect.arrayContaining(['core', 'companies', 'personal', 'workspace', 'repos']));
    expect(await readdir(root)).toEqual(['HQ']);
  });
  it('never overwrites an existing folder or downloads before rejecting it', async () => {
    const root = await temp(); await mkdir(join(root, 'HQ')); await writeFile(join(root, 'HQ/keep.txt'), 'mine');
    let downloaded = false;
    await expect(createWorkspace(root, async () => { downloaded = true; return Buffer.alloc(0); })).rejects.toThrow('already an HQ folder');
    expect(downloaded).toBe(false); expect(await readFile(join(root, 'HQ/keep.txt'), 'utf8')).toBe('mine');
  });
  it('recovers content published before the journal recorded completion', async () => {
    const root = await temp(); const bytes = await archive(); const owner = 'setup-session';
    const created = await createWorkspace(root, async () => bytes, owner);
    const recovered = await createWorkspace(root, async () => { throw new Error('must not download twice'); }, owner);
    expect(recovered).toBe(created);
    await expect(createWorkspace(root, async () => bytes, 'different-session')).rejects.toThrow('already an HQ folder');
  });
  it('removes only its staging directory after a failed download', async () => {
    const root = await temp(); await writeFile(join(root, 'mine.txt'), 'mine');
    await expect(createWorkspace(root, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(await readdir(root)).toEqual(['mine.txt']);
  });
  it('rejects path traversal and escaping links, while allowing HQ internal links', () => {
    for (const path of ['/tmp/root', '../escape', 'release/../escape', 'C:\\escape', 'release\\..\\escape']) expect(safeArchivePath(path), path).toBe(false);
    expect(safeArchivePath('release/.claude/skills', '../core/skills')).toBe(true);
    expect(safeArchivePath('release/.claude/skills', '../../outside')).toBe(false);
    expect(safeArchivePath('release/core/link', '/outside')).toBe(false);
  });
  it('persists interrupted setup for recovery and rejects corrupt state', async () => {
    const root = await temp(); const journal = new SetupJournal(join(root, 'setup.json')); expect(await journal.load()).toBeUndefined();
    const state = initialSetup(join(root, 'HQ')); state.steps[0]!.status = 'ready'; state.steps[1]!.status = 'working';
    await journal.save(state); expect(await journal.load()).toEqual(state);
    await writeFile(join(root, 'setup.json'), '{}'); await expect(journal.load()).rejects.toThrow('could not be read');
  });
});
describe('owned setup commands', () => {
  it('captures success and rejects a failed exit', async () => {
    const root = await temp(); const options = { cwd: root, env: {}, signal: new AbortController().signal };
    expect(await runSetupCommand(process.execPath, ['-e', 'process.stdout.write("ready")'], options)).toBe('ready');
    await expect(runSetupCommand(process.execPath, ['-e', 'process.exit(3)'], options)).rejects.toThrow('did not finish');
  });
  it('terminates an owned long-running command on cancellation', async () => {
    const root = await temp(); const controller = new AbortController();
    const pending = runSetupCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: root, env: {}, signal: controller.signal, timeout: 1000 });
    controller.abort(); await expect(pending).rejects.toThrow('stopped before it finished');
  });
  it('bounds a command that never finishes', async () => {
    const root = await temp();
    await expect(runSetupCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: root, env: {}, signal: new AbortController().signal, timeout: 100 })).rejects.toThrow('stopped before it finished');
  });
});
