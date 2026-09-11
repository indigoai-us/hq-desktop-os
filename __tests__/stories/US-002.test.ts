import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  IPC_CHANNELS,
  IPC_CHANNEL_LIST,
  REVIEWED_HTTPS_LINKS,
  createUnavailablePlatformClient,
  isReviewedHttpsLink,
  parseOpenExternalPayload,
  resolvePlatformClient,
  type PlatformBridge,
  type PlatformResult,
} from '../../src/shared/platform';
import { APP_ENTRY_URL, APP_ORIGIN, resolveAppAsset } from '../../src/main/app-protocol';
import { isTrustedIpcSender } from '../../src/main/ipc-guard';
import { isAllowedNavigation } from '../../src/main/navigation';
import { REQUIRED_CSP_DIRECTIVES, cspFromHtml, parseCsp } from '../../tests/helpers/csp';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const builtPreload = join(root, 'dist/preload/index.js');
const builtRenderer = join(root, 'dist/renderer/index.html');

function recordingBridge(reply: PlatformResult<unknown> = { ok: true, value: 'stub' }) {
  const calls: Array<{ channel: string; payload: unknown }> = [];
  const bridge: PlatformBridge = {
    kind: 'electron',
    version: '0.1.0',
    invoke: async (channel, payload) => {
      calls.push({ channel, payload });
      return reply;
    },
  };
  return { bridge, calls };
}

describe('US-002 typed platform boundary behaviour', () => {
  it('routes each client method to its own bounded channel', async () => {
    const { bridge, calls } = recordingBridge();
    const client = resolvePlatformClient(bridge);
    expect(client.availability).toBe('native');

    await client.getInfo();
    await client.windowMinimize();
    await client.windowMaximizeToggle();
    await client.windowClose();
    await client.appRelaunch();
    await client.appQuit();
    await client.openExternal(REVIEWED_HTTPS_LINKS[0]);
    await client.filesystemSelectDirectory();
    await client.credentialsGetStatus();
    await client.processListManaged();
    await client.updaterGetStatus();

    expect(calls.map((call) => call.channel)).toEqual([...IPC_CHANNEL_LIST]);
    expect(calls.find((call) => call.channel === IPC_CHANNELS.openExternal)?.payload).toEqual({
      url: REVIEWED_HTTPS_LINKS[0],
    });
    // Only openExternal carries data across the boundary.
    expect(calls.filter((call) => call.payload !== undefined)).toHaveLength(1);
  });

  it('fails closed when the bridge is missing, foreign or malformed', async () => {
    const missing = resolvePlatformClient(undefined);
    expect(missing.availability).toBe('unavailable');
    expect(await missing.appRelaunch()).toEqual({
      ok: false,
      error: { code: 'unavailable', message: 'Native platform bridge is unavailable.' },
    });
    expect(await missing.openExternal(REVIEWED_HTTPS_LINKS[0])).toMatchObject({ ok: false });
    expect(await missing.credentialsGetStatus()).toMatchObject({ ok: false });

    const foreign = resolvePlatformClient({ kind: 'web', invoke: async () => ({ ok: true, value: 1 }) } as unknown as PlatformBridge);
    expect(foreign.availability).toBe('unavailable');
    expect(await foreign.getInfo()).toMatchObject({ ok: false, error: { code: 'unavailable' } });

    // A native-looking bridge that answers with junk must not read as success.
    const { bridge } = recordingBridge('surprise' as unknown as PlatformResult<unknown>);
    expect(await resolvePlatformClient(bridge).getInfo()).toEqual({
      ok: false,
      error: { code: 'unavailable', message: 'Malformed platform response.' },
    });
    expect(createUnavailablePlatformClient().availability).toBe('unavailable');
  });

  it('accepts only the exact reviewed HTTPS targets', () => {
    for (const link of REVIEWED_HTTPS_LINKS) expect(isReviewedHttpsLink(link)).toBe(true);
    for (const unsafe of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<h1>x</h1>',
      'http://github.com/indigoai-us/hq-desktop-os',
      'https://github.com/indigoai-us/hq-desktop-os/',
      'https://github.com.evil.example/indigoai-us/hq-desktop-os',
      'https://user:pass@github.com/indigoai-us/hq-desktop-os',
      'https://github.com/indigoai-us/hq-desktop-os#x',
    ]) {
      expect(isReviewedHttpsLink(unsafe), `${unsafe} must be refused`).toBe(false);
    }
  });

  it('rejects untrusted IPC senders and malformed IPC payloads', () => {
    const renderer = APP_ENTRY_URL;
    expect(isTrustedIpcSender({ senderDestroyed: false, frameUrl: renderer, isMainFrame: true }, renderer)).toBe(true);
    for (const snapshot of [
      { senderDestroyed: true, frameUrl: renderer, isMainFrame: true },
      { senderDestroyed: false, frameUrl: renderer, isMainFrame: false },
      { senderDestroyed: false, frameUrl: null, isMainFrame: true },
      { senderDestroyed: false, frameUrl: 'file:///tmp/attacker.html', isMainFrame: true },
      { senderDestroyed: false, frameUrl: 'https://evil.example', isMainFrame: true },
      { senderDestroyed: false, frameUrl: 'app://evil.example/index.html', isMainFrame: true },
      { senderDestroyed: false, frameUrl: 'app://hq-desktop-os/other.html', isMainFrame: true },
    ]) {
      expect(isTrustedIpcSender(snapshot, renderer), JSON.stringify(snapshot)).toBe(false);
    }

    for (const payload of [undefined, null, [], {}, 'https://github.com', { url: 42 }, { url: '' }, { url: 'x'.repeat(2049) }]) {
      expect(parseOpenExternalPayload(payload), JSON.stringify(payload)).toBeNull();
    }
    expect(isAllowedNavigation('https://example.com', renderer)).toBe(false);
    expect(isAllowedNavigation('file:///etc/passwd', renderer)).toBe(false);
    expect(isAllowedNavigation(`${APP_ORIGIN}/index.html`, renderer)).toBe(true);
    expect(isAllowedNavigation(`${APP_ORIGIN}/other.html`, renderer)).toBe(false);
    expect(isAllowedNavigation('app://evil.example/index.html', renderer)).toBe(false);
  });

  it('confines the packaged renderer to its own asset root', () => {
    const root = '/opt/hq-desktop-os/resources/app/dist/renderer';
    expect(resolveAppAsset(APP_ENTRY_URL, root)).toMatchObject({ ok: true });
    // Nothing outside the renderer directory is addressable, so a renderer with
    // script execution has no unmediated route to the host filesystem.
    for (const escape of [
      `${APP_ORIGIN}/../main/index.js`,
      `${APP_ORIGIN}/../preload/index.js`,
      `${APP_ORIGIN}/%2e%2e/../../../etc/passwd`,
      `${APP_ORIGIN}//unc-share/payload.js`,
      `${APP_ORIGIN}/C:/Windows/win.ini`,
      'file:///etc/passwd',
      'app://evil.example/index.html',
    ]) {
      expect(resolveAppAsset(escape, root).ok, escape).toBe(false);
    }
  });
});

describe.runIf(existsSync(builtPreload))('US-002 built production artifacts', () => {
  it('emits a preload the Electron sandbox can load with no local requires', async () => {
    // Regression: a sandboxed preload only receives a polyfilled require, so a
    // relative require here drops window.hqDesktop and the app never goes native.
    const bundle = await readFile(builtPreload, 'utf8');
    const required = [...bundle.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
    expect(required.length).toBeGreaterThan(0);
    expect(new Set(required)).toEqual(new Set(['electron']));
    expect(bundle).toContain('hqDesktop');
    for (const channel of IPC_CHANNEL_LIST) expect(bundle).toContain(channel);
  });

  it('emits a production renderer document with a restrictive CSP', async () => {
    const policy = cspFromHtml(await readFile(builtRenderer, 'utf8'));
    expect(policy).toBeTruthy();
    const directives = parseCsp(policy!);
    for (const [name, sources] of Object.entries(REQUIRED_CSP_DIRECTIVES)) {
      expect(directives[name], `CSP ${name}`).toEqual(sources);
    }
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toContain('127.0.0.1:4173');
  });

  it('cannot have its sandbox-safe preload bundle overwritten by the typecheck config', async () => {
    // tsconfig.preload.json is typecheck-only. If it could emit, a bare
    // `tsc -p tsconfig.preload.json` would replace the bundled preload with one
    // that requires '../shared/platform.js' — a require a sandboxed preload
    // cannot resolve, which silently drops window.hqDesktop.
    const before = await readFile(builtPreload, 'utf8');
    await execFileAsync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['tsc', '-p', 'tsconfig.preload.json'],
      { cwd: root, shell: process.platform === 'win32' },
    );
    expect(await readFile(builtPreload, 'utf8')).toBe(before);
  }, 60_000);

  it('emits a renderer document that references no absolute local path', async () => {
    // Relative asset URLs are what let the document be served from the
    // confined app:// origin instead of the file: scheme.
    const html = await readFile(builtRenderer, 'utf8');
    expect(html).not.toContain('file://');
    for (const reference of [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]!)) {
      expect(reference.startsWith('./'), reference).toBe(true);
    }
  });
});
