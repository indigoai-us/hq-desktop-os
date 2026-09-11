import { describe, expect, it } from 'vitest';
import {
  IPC_CHANNELS,
  IPC_CHANNEL_LIST,
  REVIEWED_HTTPS_LINKS,
  createUnavailablePlatformClient,
  failNotImplemented,
  isIpcChannel,
  isReviewedHttpsLink,
  parseOpenExternalPayload,
  resolvePlatformClient,
  type PlatformBridge,
  type PlatformResult,
} from '../../src/shared/platform';

describe('reviewed HTTPS allowlist', () => {
  it('accepts only exact reviewed https hrefs', () => {
    for (const link of REVIEWED_HTTPS_LINKS) {
      expect(isReviewedHttpsLink(link)).toBe(true);
    }
  });

  it.each([
    'http://github.com/indigoai-us/hq-desktop-os',
    'https://github.com/indigoai-us/hq-desktop-os/',
    'https://github.com/indigoai-us/hq-desktop-os/issues/1',
    'https://evil.example/https://github.com/indigoai-us/hq-desktop-os',
    'https://user:pass@github.com/indigoai-us/hq-desktop-os',
    'javascript:alert(1)',
    'file:///etc/passwd',
    '',
    null,
    42,
  ])('rejects unreviewed target: %s', (candidate) => {
    expect(isReviewedHttpsLink(candidate)).toBe(false);
  });
});

describe('openExternal payload validation', () => {
  it('accepts a bounded string url field', () => {
    expect(parseOpenExternalPayload({ url: REVIEWED_HTTPS_LINKS[0] })).toEqual({
      url: REVIEWED_HTTPS_LINKS[0],
    });
  });

  it.each([
    undefined,
    null,
    'https://example.com',
    [],
    {},
    { url: '' },
    { url: 'x'.repeat(2049) },
    { url: 12 },
    { href: REVIEWED_HTTPS_LINKS[0] },
  ])('rejects malformed payload: %j', (payload) => {
    expect(parseOpenExternalPayload(payload)).toBeNull();
  });
});

describe('IPC channel boundary', () => {
  it('publishes a small frozen channel list', () => {
    expect(IPC_CHANNEL_LIST.length).toBeGreaterThanOrEqual(8);
    expect(IPC_CHANNEL_LIST.length).toBeLessThanOrEqual(16);
    expect(new Set(IPC_CHANNEL_LIST).size).toBe(IPC_CHANNEL_LIST.length);
    expect(isIpcChannel(IPC_CHANNELS.openExternal)).toBe(true);
    expect(isIpcChannel('hq:platform:not-a-real-channel')).toBe(false);
  });
});

describe('fail-closed platform client', () => {
  it('never reports native success when the preload bridge is missing', async () => {
    const client = resolvePlatformClient(undefined);
    expect(client.availability).toBe('unavailable');

    const actions: Array<() => Promise<PlatformResult<unknown>>> = [
      () => client.getInfo(),
      () => client.windowMinimize(),
      () => client.windowMaximizeToggle(),
      () => client.windowClose(),
      () => client.appRelaunch(),
      () => client.appQuit(),
      () => client.openExternal(REVIEWED_HTTPS_LINKS[0]),
      () => client.filesystemSelectDirectory(),
      () => client.credentialsGetStatus(),
      () => client.processListManaged(),
      () => client.updaterGetStatus(),
    ];

    for (const action of actions) {
      const result = await action();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('unavailable');
    }
  });

  it('rejects forged bridges that omit invoke', () => {
    const forged = { kind: 'electron', version: '0.1.0' } as unknown as PlatformBridge;
    expect(resolvePlatformClient(forged).availability).toBe('unavailable');
  });

  it('routes native bridge invokes without inventing success for reserved ops', async () => {
    const calls: Array<{ channel: string; payload: unknown }> = [];
    const bridge: PlatformBridge = {
      kind: 'electron',
      version: '0.1.0',
      async invoke(channel, payload) {
        calls.push({ channel, payload });
        if (channel === IPC_CHANNELS.filesystemSelectDirectory) {
          return failNotImplemented('Filesystem selection');
        }
        return { ok: true, value: { bridgeVersion: '0.1.0', platform: 'linux', electron: true } };
      },
    };

    const client = resolvePlatformClient(bridge);
    expect(client.availability).toBe('native');
    const info = await client.getInfo();
    expect(info.ok).toBe(true);
    const fs = await client.filesystemSelectDirectory();
    expect(fs.ok).toBe(false);
    if (!fs.ok) expect(fs.error.code).toBe('not_implemented');
    expect(calls.map((c) => c.channel)).toEqual([
      IPC_CHANNELS.getInfo,
      IPC_CHANNELS.filesystemSelectDirectory,
    ]);
  });

  it('contains a rejected bridge invoke as an unavailable result', async () => {
    const rejecting: PlatformBridge = {
      kind: 'electron',
      version: '0.1.0',
      invoke: async () => {
        throw new Error('boom');
      },
    };
    const client = resolvePlatformClient(rejecting);
    expect(client.availability).toBe('native');
    // Nothing may escape the PlatformResult contract: an unhandled rejection
    // would leave the UI showing whatever it last displayed, possibly a
    // previous success.
    for (const action of [
      () => client.getInfo(),
      () => client.windowMinimize(),
      () => client.appRelaunch(),
      () => client.openExternal(REVIEWED_HTTPS_LINKS[0]),
      () => client.credentialsGetStatus(),
    ]) {
      await expect(action()).resolves.toEqual({
        ok: false,
        error: { code: 'unavailable', message: 'boom' },
      });
    }
  });

  it('contains a non-Error rejection too', async () => {
    const client = resolvePlatformClient({
      kind: 'electron',
      version: '0.1.0',
      invoke: async () => {
        throw 'string rejection';
      },
    } as unknown as PlatformBridge);
    expect(await client.getInfo()).toEqual({
      ok: false,
      error: { code: 'unavailable', message: 'Platform invoke failed.' },
    });
  });

  it('createUnavailablePlatformClient freezes availability', async () => {
    const client = createUnavailablePlatformClient('missing preload');
    expect(Object.isFrozen(client)).toBe(true);
    const result = await client.openExternal('https://example.com');
    expect(result).toEqual({
      ok: false,
      error: { code: 'unavailable', message: 'missing preload' },
    });
  });
});
