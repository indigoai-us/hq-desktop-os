import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { productionRuntimePath } from './runtime';

const execFileAsync = promisify(execFile);

/**
 * Proof that a reviewed link is actually handed to the host, and that an
 * unreviewed one never reaches it.
 *
 * The companion spec (us-002-external-links) replaces `shell.openExternal` to
 * assert the allowlist cheaply. This one does the opposite: `shell.openExternal`
 * is left completely untouched, and the host handoff itself is observed. On
 * Linux Electron hands the URL to `xdg-open`, so the app is launched with a
 * recording `xdg-open` first on its PATH. Nothing global is changed: the
 * recorder lives in a temporary directory and is only on the PATH of this one
 * child process, which inherits the rest of the test process environment.
 */
const REVIEWED = 'https://github.com/indigoai-us/hq-desktop-os';

type BridgeResult = { ok: boolean; error?: { code: string; message: string } };

let app: ElectronApplication;
let appWindow: Page;
let handoffDir: string;
let recordPath: string;

async function recordedHandoffs(): Promise<string[]> {
  if (!existsSync(recordPath)) return [];
  const raw = await readFile(recordPath, 'utf8');
  return raw.split('\n').filter((line) => line.length > 0);
}

async function openExternal(url: unknown): Promise<BridgeResult> {
  return appWindow.evaluate(
    (target) =>
      (window as unknown as {
        hqDesktop: { invoke: (channel: string, payload?: unknown) => Promise<BridgeResult> };
      }).hqDesktop.invoke('hq:platform:openExternal', { url: target }),
    url,
  ) as Promise<BridgeResult>;
}

test.describe('US-002 external handoff to the host', () => {
  // Linux-only by configuration (playwright.electron.config.ts), not by a
  // runtime skip: the Windows handoff fixture does not exist yet and must stay
  // visibly outstanding rather than appear as a skipped pass.

  test.beforeAll(async () => {
    handoffDir = await mkdtemp(join(tmpdir(), 'hq-external-handoff-'));
    recordPath = join(handoffDir, 'handoffs.txt');
    const recorder = join(handoffDir, 'xdg-open');
    // Records the argument vector the OS layer was called with and exits.
    // It opens nothing, so no browser is launched by the suite.
    await writeFile(
      recorder,
      `#!/bin/sh\nfor arg in "$@"; do printf '%s\\n' "$arg" >> ${JSON.stringify(recordPath)}; done\nexit 0\n`,
    );
    await chmod(recorder, 0o755);

    app = await electron.launch({
      executablePath: productionRuntimePath(),
      args: [],
      timeout: 120_000,
      env: { ...process.env, PATH: `${handoffDir}:${process.env.PATH ?? ''}` } as Record<string, string>,
    });
    appWindow = await app.firstWindow();
    await appWindow.waitForLoadState('domcontentloaded');
    await appWindow.waitForSelector('[data-testid="platform-availability"]');
  });

  test.afterAll(async () => {
    await app?.close();
    if (handoffDir) await rm(handoffDir, { recursive: true, force: true });
  });

  test('hands the reviewed HTTPS target to the operating system unchanged', async () => {
    const before = await recordedHandoffs();
    const result = await openExternal(REVIEWED);
    expect(result.ok).toBe(true);
    await expect.poll(async () => (await recordedHandoffs()).slice(before.length), {
      timeout: 20_000,
    }).toEqual([REVIEWED]);
  });

  test('hands over the docs link when the user clicks it in the app', async () => {
    const before = await recordedHandoffs();
    await appWindow.getByTestId('open-docs').click();
    await expect(appWindow.getByTestId('platform-last-result')).toHaveText('Open docs → ok');
    await expect.poll(async () => (await recordedHandoffs()).slice(before.length), {
      timeout: 20_000,
    }).toEqual([REVIEWED]);
  });

  test('never reaches the operating system for a refused target', async () => {
    const refused = [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<h1>x</h1>',
      'smb://192.168.0.5/share',
      'http://github.com/indigoai-us/hq-desktop-os',
      'https://evil.example/indigoai-us/hq-desktop-os',
      'https://github.com.evil.example/indigoai-us/hq-desktop-os',
      'https://user:pass@github.com/indigoai-us/hq-desktop-os',
      'https://github.com/indigoai-us/hq-desktop-os/',
      'https://evil.example/?next=https://github.com/indigoai-us/hq-desktop-os',
    ];
    const before = await recordedHandoffs();

    for (const url of refused) {
      const result = await openExternal(url);
      expect(result.ok, url).toBe(false);
      expect(result.error?.code, url).toBe('rejected_link');
    }
    for (const url of ['https://evil.example', 'javascript:alert(1)', 'file:///etc/passwd']) {
      expect(await appWindow.evaluate((target) => window.open(target) === null, url)).toBe(true);
    }

    // Give any handoff that was going to happen time to land before asserting
    // that none did.
    await appWindow.waitForTimeout(1_500);
    expect(await recordedHandoffs()).toEqual(before);
  });

  test('the recorder really is the process the host layer would run', async () => {
    // Guards the test itself: if `xdg-open` ever stopped resolving to the
    // recorder, the negative assertions above would pass vacuously.
    const { stdout } = await execFileAsync('sh', ['-c', 'command -v xdg-open'], {
      env: { ...process.env, PATH: `${handoffDir}:${process.env.PATH ?? ''}` },
    });
    expect(stdout.trim()).toBe(join(handoffDir, 'xdg-open'));
    expect((await recordedHandoffs()).length).toBeGreaterThan(0);
  });
});
