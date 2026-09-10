import { spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = process.cwd();
let checkout: string;
let env: NodeJS.ProcessEnv;

// Run real commands asynchronously so test workers and child output keep moving.
function run(args: string[], timeout = 120_000) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn('pnpm', args, { cwd: checkout, env, timeout });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

beforeAll(async () => {
  checkout = await mkdtemp(join(tmpdir(), 'hq-us001-'));
  await cp(root, checkout, {
    recursive: true,
    filter: (source) => !['node_modules', '.git', 'dist', 'test-results', 'playwright-report'].includes(source.split('/').at(-1) ?? ''),
  });
  await writeFile(join(checkout, 'empty-user.npmrc'), '');
  await writeFile(join(checkout, 'empty-global.npmrc'), '');
  // Deliberate allowlist: no organization tokens or inherited npm configuration.
  const modules = await readFile(join(root, 'node_modules/.modules.yaml'), 'utf8');
  const store = modules.match(/^storeDir: (.+)$/m)?.[1];
  if (!store) throw new Error('Installed pnpm store metadata is required for offline replay');
  env = {
    PATH: process.env.PATH, HOME: process.env.HOME, CI: 'true',
    npm_config_userconfig: join(checkout, 'empty-user.npmrc'),
    npm_config_globalconfig: join(checkout, 'empty-global.npmrc'),
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_store_dir: dirname(store),
  };
}, 30_000);
afterAll(async () => { if (checkout) await rm(checkout, { recursive: true, force: true }); });

describe.sequential('US-001 contributor build foundation', () => {
  it('installs a clean checkout from the frozen public lockfile without credentials (cached/offline)', async () => {
    expect((await run(['--version'])).output.trim()).toBe('10.28.2');
    const before = await readFile(join(checkout, 'pnpm-lock.yaml'), 'utf8');
    const result = await run(['install', '--frozen-lockfile', '--offline']);
    expect(result.code, result.output).toBe(0);
    expect(await readFile(join(checkout, 'pnpm-lock.yaml'), 'utf8')).toBe(before);
    const react = await readFile(join(checkout, 'node_modules/react/package.json'), 'utf8');
    expect(JSON.parse(react).version).toBe('19.2.3');
  }, 130_000);

  it('typechecks and builds all three targets from a checkout without previous output', async () => {
    const checked = await run(['typecheck']);
    expect(checked.code, checked.output).toBe(0);
    const built = await run(['build']);
    expect(built.code, built.output).toBe(0);
    expect((await readFile(join(checkout, 'dist/main/index.js'))).length).toBeGreaterThan(0);
    expect((await readFile(join(checkout, 'dist/preload/index.js'))).length).toBeGreaterThan(0);
    expect(await readFile(join(checkout, 'dist/renderer/index.html'), 'utf8')).toContain('assets/');
    expect((await readdir(join(checkout, 'dist/renderer/assets'))).some((name) => name.endsWith('.js'))).toBe(true);
  }, 130_000);

  it('reports missing browser/native coverage as failure rather than placeholder success', async () => {
    await mkdir(join(checkout, 'empty-acceptance-suite'));
    await writeFile(join(checkout, 'empty-acceptance.config.ts'),
      "export default { testDir: './empty-acceptance-suite' };\n");
    for (const script of ['test:e2e', 'test:electron']) {
      const result = await run([script, '--config', 'empty-acceptance.config.ts', '--list']);
      expect(result.code, result.output).toBe(1);
      expect(result.output).toContain('No tests found');
    }
  }, 130_000);
});
