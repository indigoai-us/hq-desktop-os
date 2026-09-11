import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APP_ENTRY_URL,
  APP_ORIGIN,
  contentTypeFor,
  resolveAppAsset,
  serveAppAsset,
  statusForRefusal,
  type AppAssetRefusal,
} from '../../src/main/app-protocol';
import { PACKAGED_CSP } from '../../src/main/csp';

const root = resolve('/opt/hq-desktop-os/resources/app/dist/renderer');

function refusalFor(url: string): AppAssetRefusal | 'served' {
  const result = resolveAppAsset(url, root);
  return result.ok ? 'served' : result.reason;
}

describe('app:// asset resolution', () => {
  it('serves the renderer entry and its own bundled assets', () => {
    expect(resolveAppAsset(APP_ENTRY_URL, root)).toEqual({
      ok: true,
      path: resolve(root, 'index.html'),
    });
    expect(resolveAppAsset(`${APP_ORIGIN}/`, root)).toEqual({
      ok: true,
      path: resolve(root, 'index.html'),
    });
    expect(resolveAppAsset(`${APP_ORIGIN}/assets/index-B4sqDu1e.js`, root)).toEqual({
      ok: true,
      path: resolve(root, 'assets', 'index-B4sqDu1e.js'),
    });
  });

  it('never resolves outside the renderer root', () => {
    for (const url of [
      `${APP_ORIGIN}/../main/index.js`,
      `${APP_ORIGIN}/../preload/index.js`,
      `${APP_ORIGIN}/../../package.json`,
      `${APP_ORIGIN}/assets/../../main/index.js`,
      `${APP_ORIGIN}/../../../../../../etc/passwd`,
    ]) {
      expect(refusalFor(url), url).toBe('escapes_root');
    }
    // Even a refusal-free path must stay provably under the root.
    const served = resolveAppAsset(`${APP_ORIGIN}/assets/app.css`, root);
    expect(served.ok && served.path.startsWith(root + sep)).toBe(true);
  });

  it('refuses percent-encoded separators and traversal', () => {
    for (const url of [
      `${APP_ORIGIN}/%2e%2e/main/index.js`,
      `${APP_ORIGIN}/%2E%2E%2Fmain%2Findex.js`,
      `${APP_ORIGIN}/assets%2f..%2f..%2fmain%2findex.js`,
      `${APP_ORIGIN}/index.html%00.png`,
      `${APP_ORIGIN}/%5C..%5Cmain%5Cindex.js`,
    ]) {
      expect(refusalFor(url), url).toBe('bad_encoding');
    }
  });

  it('refuses UNC paths and Windows absolute paths', () => {
    expect(refusalFor(`${APP_ORIGIN}//attacker-share/payload.js`)).toBe('escapes_root');
    expect(refusalFor(`${APP_ORIGIN}/C:/Windows/win.ini`)).toBe('escapes_root');
    expect(refusalFor(`${APP_ORIGIN}/c:/Windows/win.ini`)).toBe('escapes_root');
  });

  it('refuses foreign hosts, credentials, ports, queries and other schemes', () => {
    expect(refusalFor('app://evil.example/index.html')).toBe('bad_host');
    expect(refusalFor('app://hq-desktop-os.evil.example/index.html')).toBe('bad_host');
    expect(refusalFor('app://user:pass@hq-desktop-os/index.html')).toBe('has_credentials');
    expect(refusalFor(`${APP_ORIGIN}/index.html?redirect=/etc/passwd`)).toBe('has_query');
    expect(refusalFor('file:///etc/passwd')).toBe('bad_scheme');
    expect(refusalFor('https://hq-desktop-os/index.html')).toBe('bad_scheme');
    expect(refusalFor('not a url')).toBe('bad_url');
  });

  it('refuses the root directory itself and file types the bundle never contains', () => {
    expect(refusalFor(`${APP_ORIGIN}/assets`)).toBe('unsupported_type');
    expect(refusalFor(`${APP_ORIGIN}/index.html.map`)).toBe('unsupported_type');
    expect(refusalFor(`${APP_ORIGIN}/node`)).toBe('unsupported_type');
  });

  it('labels every refusal with a client error status and every asset with a type', () => {
    expect(statusForRefusal('has_query')).toBe(400);
    expect(statusForRefusal('bad_encoding')).toBe(400);
    expect(statusForRefusal('escapes_root')).toBe(403);
    expect(statusForRefusal('bad_host')).toBe(403);
    expect(contentTypeFor('/x/index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('/x/index.JS')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('/x/index.js.map')).toBeNull();
  });
});

describe('app:// response delivery', () => {
  let root: string;
  let outside: string;

  beforeAll(async () => {
    const base = await mkdtemp(join(tmpdir(), 'hq-app-protocol-'));
    root = join(base, 'renderer');
    outside = join(base, 'outside');
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(root, 'index.html'), '<!doctype html><h1>hq</h1>');
    await writeFile(join(outside, 'secret.html'), 'OUTSIDE-ROOT-MARKER');
    await symlink(join(outside, 'secret.html'), join(root, 'escape.html'));
  });

  afterAll(async () => {
    await rm(resolve(root, '..'), { recursive: true, force: true });
  });

  const serve = (url: string, init?: RequestInit) =>
    serveAppAsset(new Request(url, init), root);

  it('carries the packaged CSP on a served asset', async () => {
    const response = await serve(APP_ENTRY_URL);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(PACKAGED_CSP);
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toContain('<h1>hq</h1>');
  });

  it('carries the packaged CSP on every refusal status', async () => {
    // Written the way Chromium hands them over: `Request` collapses dot
    // segments exactly as the browser does, so the traversal refusals that
    // survive that normalisation are the encoded and UNC forms.
    const cases: Array<[string, number]> = [
      [`${APP_ORIGIN}/index.html?x=1`, 400],
      [`${APP_ORIGIN}/index.html%00.png`, 400],
      [`${APP_ORIGIN}/%2f..%2fmain.js`, 400],
      [`${APP_ORIGIN}//attacker-share/payload.js`, 403],
      [`${APP_ORIGIN}/C:/Windows/win.ini`, 403],
      ['app://evil.example/index.html', 403],
      [`${APP_ORIGIN}/index.html.map`, 403],
      [`${APP_ORIGIN}/missing.html`, 404],
    ];
    for (const [url, status] of cases) {
      const response = await serve(url);
      expect(response.status, url).toBe(status);
      expect(response.headers.get('content-security-policy'), url).toBe(PACKAGED_CSP);
      expect(response.headers.get('x-content-type-options'), url).toBe('nosniff');
      expect((await response.arrayBuffer()).byteLength, url).toBe(0);
    }
  });

  it('refuses a symlink that leaves the renderer root without leaking its bytes', async () => {
    const response = await serve(`${APP_ORIGIN}/escape.html`);
    expect(response.status).toBe(403);
    expect(response.headers.get('x-refusal-reason')).toBe('escapes_root');
    expect(await response.text()).not.toContain('OUTSIDE-ROOT-MARKER');
  });

  it('answers HEAD with the headers of a GET and no body', async () => {
    const head = await serve(APP_ENTRY_URL, { method: 'HEAD' });
    const get = await serve(APP_ENTRY_URL);
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
    expect(head.headers.get('content-length')).toBe(get.headers.get('content-length'));
    expect(head.headers.get('content-security-policy')).toBe(PACKAGED_CSP);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0);
  });

  it('refuses every method that is not a read', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await serve(APP_ENTRY_URL, { method });
      expect(response.status, method).toBe(405);
      expect(response.headers.get('allow'), method).toBe('GET, HEAD');
      expect(response.headers.get('content-security-policy'), method).toBe(PACKAGED_CSP);
      expect((await response.arrayBuffer()).byteLength, method).toBe(0);
    }
  });

  it('labels not-found and unsupported-method refusals with their statuses', () => {
    expect(statusForRefusal('not_found')).toBe(404);
    expect(statusForRefusal('unsupported_method')).toBe(405);
  });
});
