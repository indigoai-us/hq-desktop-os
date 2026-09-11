import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { AccountSession, authorize, callbackCode, HQ_AUTH, parseTokens, pkce, verifyIdentity } from '../../src/main/auth';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

describe('desktop PKCE callback', () => {
  it('uses unpredictable state, nonce and a matching S256 challenge', () => {
    const first = pkce(); const second = pkce();
    expect(first.verifier).toHaveLength(43); expect(first.state).not.toBe(second.state); expect(first.nonce).not.toBe(first.state);
    expect(first.challenge).toBe(createHash('sha256').update(first.verifier).digest('base64url'));
  });
  it('rejects other states, origins, paths and Unicode state confusion', () => {
    const state = 'x'.repeat(43);
    for (const path of ['/callback?code=abc&state=wrong', '/other?code=abc&state='+state, 'https://other.example/callback?code=abc&state='+state, '/callback?code=abc&state='+'é'.repeat(43)]) expect(callbackCode(path, state)).toBeUndefined();
    expect(callbackCode('/callback?code=abc&state='+state, state)).toBe('abc');
    expect(() => callbackCode('/callback?error=access_denied&state='+state, state)).toThrow('canceled');
  });
  it('closes a canceled loopback listener and permits another attempt', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const result = authorize(async url => {
        const login = new URL(url); expect(login.origin).toBe(HQ_AUTH.domain); expect(login.searchParams.get('redirect_uri')).toBe(HQ_AUTH.redirectUri);
        controller.abort();
      }, controller.signal);
      await expect(result).rejects.toThrow('canceled');
    }
  });
  it('keeps listening after an unrelated callback and completes exactly once', async () => {
    const controller = new AbortController();
    const get = (path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: HQ_AUTH.port, path, headers: { Host: `localhost:${HQ_AUTH.port}` } }, response => {
        let body = ''; response.on('data', data => { body += data; });
        response.on('end', () => resolve({ status: response.statusCode!, body }));
        response.on('error', reject);
      });
      req.on('error', reject); req.end();
    });
    const result = authorize(async url => {
      const state = new URL(url).searchParams.get('state')!;
      const wrong = await get('/callback?code=wrong&state=unrelated');
      expect(wrong.status).toBe(400);
      const good = await get(`/callback?code=accepted&state=${state}`);
      expect(good.status).toBe(200); expect(good.body).toContain('return to HQ');
    }, controller.signal);
    try { expect((await result).code).toBe('accepted'); } finally { controller.abort(); }
  });
});
describe('verified account identity', () => {
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  beforeAll(async () => {
    keys = await generateKeyPair('RS256', { extractable: true });
    const key = await exportJWK(keys.publicKey);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [{ ...key, kid: 'auth-test', alg: 'RS256', use: 'sig' }] }), { status: 200, headers: { 'content-type': 'application/json' } })));
  });
  afterAll(() => vi.unstubAllGlobals());
  const token = (options: { issuer?: string; audience?: string; expires?: string; nonce?: string; use?: string } = {}) => new SignJWT({ token_use: options.use ?? 'id', nonce: options.nonce ?? 'proof', name: 'Example' }).setProtectedHeader({ alg: 'RS256', kid: 'auth-test' }).setIssuer(options.issuer ?? HQ_AUTH.issuer).setAudience(options.audience ?? HQ_AUTH.clientId).setSubject('person-sub').setIssuedAt().setExpirationTime(options.expires ?? '5m').sign(keys.privateKey);
  it('requires a signed identity with the exact issuer, client and nonce', async () => {
    expect(await verifyIdentity(await token(), 'proof')).toMatchObject({ sub: 'person-sub', label: 'Example' });
    await expect(verifyIdentity(await token({ issuer: 'https://other.example' }))).rejects.toThrow();
    await expect(verifyIdentity(await token({ audience: 'other-client' }))).rejects.toThrow();
    await expect(verifyIdentity(await token({ expires: '-1s' }))).rejects.toThrow();
    await expect(verifyIdentity(await token(), 'wrong')).rejects.toThrow();
    await expect(verifyIdentity(await token({ use: 'access' }))).rejects.toThrow();
  });
  it.each([400, 429, 503])('handles refresh rejection %s without keeping a falsely connected account', async status => {
    const saved = { accessToken: 'access', idToken: await token(), refreshToken: 'refresh', expiresAt: Date.now() + 9999999 };
    const store = { read: vi.fn(async () => saved), write: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
    const session = new AccountSession(store); await session.restore();
    expect(session.identity?.sub).toBe('person-sub');
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 270000);
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status })));
    try {
      await expect(session.bearer()).rejects.toThrow();
      expect(session.identity === undefined).toBe(status === 400);
      expect(store.clear).toHaveBeenCalledTimes(status === 400 ? 1 : 0);
    } finally { now.mockRestore(); vi.stubGlobal('fetch', originalFetch); }
  });
  it('rejects incomplete token responses before storage', () => {
    expect(() => parseTokens({ accessToken: 'a', idToken: 'b', expiresAt: Date.now() })).toThrow();
    expect(parseTokens({ accessToken: 'a', idToken: 'b', refreshToken: 'c', expiresAt: 1 })).toEqual({ accessToken: 'a', idToken: 'b', refreshToken: 'c', expiresAt: 1 });
  });
});
