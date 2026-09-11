import { describe, expect, it } from 'vitest';
import { isTrustedIpcSender, type IpcSenderSnapshot } from '../../src/main/ipc-guard';
import { isReviewedHttpsLink, parseOpenExternalPayload } from '../../src/shared/platform';

const preview = 'http://127.0.0.1:4173';
const packaged = 'file:///app/index.html';

describe('IPC sender validation', () => {
  it('accepts the renderer main frame for preview and packaged URLs', () => {
    const previewSender: IpcSenderSnapshot = {
      senderDestroyed: false,
      frameUrl: `${preview}/`,
      isMainFrame: true,
    };
    // Preview origin match: navigation helper permits same-origin http paths.
    expect(isTrustedIpcSender({
      senderDestroyed: false,
      frameUrl: preview,
      isMainFrame: true,
    }, preview)).toBe(true);
    expect(isTrustedIpcSender({
      senderDestroyed: false,
      frameUrl: `${preview}/setup`,
      isMainFrame: true,
    }, preview)).toBe(true);
    expect(isTrustedIpcSender({
      senderDestroyed: false,
      frameUrl: packaged,
      isMainFrame: true,
    }, packaged)).toBe(true);
    void previewSender;
  });

  it.each([
    {
      name: 'destroyed sender',
      snapshot: { senderDestroyed: true, frameUrl: preview, isMainFrame: true },
    },
    {
      name: 'child frame',
      snapshot: { senderDestroyed: false, frameUrl: preview, isMainFrame: false },
    },
    {
      name: 'missing frame url',
      snapshot: { senderDestroyed: false, frameUrl: null, isMainFrame: true },
    },
    {
      name: 'foreign origin',
      snapshot: { senderDestroyed: false, frameUrl: 'https://evil.example', isMainFrame: true },
    },
    {
      name: 'javascript url',
      snapshot: { senderDestroyed: false, frameUrl: 'javascript:alert(1)', isMainFrame: true },
    },
    {
      name: 'other packaged file',
      snapshot: { senderDestroyed: false, frameUrl: 'file:///etc/passwd', isMainFrame: true },
    },
  ])('rejects $name', ({ snapshot }) => {
    const renderer = snapshot.frameUrl?.startsWith('file:') ? packaged : preview;
    expect(isTrustedIpcSender(snapshot, renderer)).toBe(false);
  });
});

describe('openExternal IPC payload path', () => {
  it('requires a validated payload before allowlist checks', () => {
    expect(parseOpenExternalPayload({ url: 'javascript:alert(1)' })).toEqual({
      url: 'javascript:alert(1)',
    });
    expect(isReviewedHttpsLink('javascript:alert(1)')).toBe(false);
  });
});
