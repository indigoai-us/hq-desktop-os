import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { JWTVerifyGetKey } from 'jose' with { 'resolution-mode': 'import' };

/** Verified against a current HQ token, production web config and AWS on 2026-09-11. */
export const HQ_AUTH = {
  issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AXf6Kb5nE',
  clientId: '7acei2c8v870enheptb1j5foln',
  domain: 'https://vault-indigo-hq-prod.auth.us-east-1.amazoncognito.com',
  redirectUri: 'http://localhost:53682/callback',
  port: 53682,
};
export interface AccountTokens { accessToken: string; idToken: string; refreshToken: string; expiresAt: number }
export interface TokenStore { read(): Promise<AccountTokens | undefined>; write(tokens: AccountTokens): Promise<void>; clear(): Promise<void> }
export interface AccountIdentity { sub: string; label: string; expiresAt: number }
export function parseTokens(value: unknown): AccountTokens {
  if (!value || typeof value !== 'object') throw new Error('Your sign-in could not be verified. Please sign in again.');
  const data = value as AccountTokens;
  if (![data.accessToken, data.idToken, data.refreshToken].every(token => typeof token === 'string' && token.length > 0 && token.length <= 32_768) || typeof data.expiresAt !== 'number' || !Number.isFinite(data.expiresAt)) throw new Error('Your sign-in could not be verified. Please sign in again.');
  return { accessToken: data.accessToken, idToken: data.idToken, refreshToken: data.refreshToken, expiresAt: data.expiresAt };
}
export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url'), state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url') };
}
export function callbackCode(rawUrl: string, expectedState: string): string | undefined {
  const url = new URL(rawUrl, HQ_AUTH.redirectUri);
  const state = url.searchParams.get('state');
  if (url.origin !== new URL(HQ_AUTH.redirectUri).origin || url.pathname !== '/callback' || !state || !/^[A-Za-z0-9_-]+$/.test(state) || state.length !== expectedState.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))) return undefined;
  if (url.searchParams.has('error')) throw new Error('Sign-in was canceled. You can try again when you’re ready.');
  const code = url.searchParams.get('code');
  return code && code.length <= 4096 ? code : undefined;
}

/** One local callback, a finite lifetime, and no token cache shared with the CLI. */
export async function authorize(openBrowser: (url: string) => Promise<void>, signal: AbortSignal): Promise<{ code: string; verifier: string; nonce: string }> {
  const proof = pkce();
  const url = new URL(`${HQ_AUTH.domain}/oauth2/authorize`);
  url.search = new URLSearchParams({ response_type: 'code', client_id: HQ_AUTH.clientId, redirect_uri: HQ_AUTH.redirectUri, scope: 'openid email profile', state: proof.state, nonce: proof.nonce, code_challenge: proof.challenge, code_challenge_method: 'S256' }).toString();
  return new Promise((resolve, reject) => {
    let settled = false; let claimed = false;
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      if (request.method !== 'GET' || request.headers.host !== `localhost:${HQ_AUTH.port}` || !request.url || request.url.length > 8192) { response.writeHead(400).end('This sign-in request could not be recognized.'); return; }
      try {
        const code = callbackCode(request.url, proof.state);
        if (!code || settled || claimed) { response.writeHead(400).end('Please return to the sign-in window opened by HQ.'); return; }
        claimed = true;
        response.once('finish', () => finish(undefined, code));
        response.end('You can return to HQ. Your sign-in is being completed.');
      } catch { response.writeHead(400).end('Sign-in was canceled. You can return to HQ.'); finish(new Error('Sign-in was canceled. Please try again.')); }
    });
    server.requestTimeout = 10_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 1000;
    const abort = () => finish(new Error('Sign-in was canceled. You can try again when you’re ready.'));
    const timer = setTimeout(() => finish(new Error('Sign-in timed out. Please try again.')), 3 * 60_000);
    function finish(error?: Error, code?: string) {
      if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      server.close(); server.closeAllConnections();
      if (error) reject(error); else resolve({ code: code!, verifier: proof.verifier, nonce: proof.nonce });
    }
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    server.once('error', () => finish(new Error('Another sign-in window is already open. Close it, then try again.')));
    server.listen(HQ_AUTH.port, '127.0.0.1', () => {
      if (!settled) void openBrowser(url.href).catch(() => finish(new Error('Your browser could not be opened. Check your default browser and try again.')));
    });
  });
}

let jwks: JWTVerifyGetKey | undefined;
export async function verifyIdentity(idToken: string, nonce?: string): Promise<AccountIdentity> {
  const jose = await import('jose');
  jwks ??= jose.createRemoteJWKSet(new URL(`${HQ_AUTH.issuer}/.well-known/jwks.json`), { timeoutDuration: 10_000 });
  const { payload } = await jose.jwtVerify(idToken, jwks, { issuer: HQ_AUTH.issuer, audience: HQ_AUTH.clientId, algorithms: ['RS256'] });
  if (typeof payload.exp !== 'number' || payload.token_use !== 'id' || !payload.sub || (nonce !== undefined && payload.nonce !== nonce)) throw new Error('Your account could not be verified. Please sign in again.');
  return { sub: payload.sub, expiresAt: payload.exp * 1000, label: typeof payload.name === 'string' ? payload.name : typeof payload.email === 'string' ? payload.email : 'Your HQ account' };
}
export class SignInRequired extends Error {
  constructor() { super('Your sign-in has expired. Please sign in again.'); this.name = 'SignInRequired'; }
}
async function exchange(parameters: Record<string, string>, refreshToken?: string): Promise<AccountTokens> {
  const response = await fetch(`${HQ_AUTH.domain}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...parameters, client_id: HQ_AUTH.clientId }), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      const failure = await response.json() as { error?: string };
      if (failure.error === 'invalid_grant') throw new SignInRequired();
    }
    throw new Error('HQ could not be reached. Please try again shortly.');
  }
  const result = await response.json() as Record<string, unknown>;
  if (result.token_type !== 'Bearer' || typeof result.expires_in !== 'number' || result.expires_in <= 0 || result.expires_in > 86_400) throw new Error('Your sign-in could not be verified. Please try again.');
  return parseTokens({ accessToken: result.access_token, idToken: result.id_token, refreshToken: result.refresh_token ?? refreshToken, expiresAt: Date.now() + result.expires_in * 1000 });
}
export class AccountSession {
  private tokens?: AccountTokens;
  identity?: AccountIdentity;
  private generation = 0;
  private refreshing?: Promise<string>;
  constructor(private readonly store: TokenStore) {}
  async restore(): Promise<void> {
    const generation = this.generation;
    const tokens = await this.store.read(); if (!tokens || generation !== this.generation) return;
    this.tokens = tokens; await this.bearer();
  }
  async signIn(openBrowser: (url: string) => Promise<void>, signal: AbortSignal): Promise<void> {
    const generation = ++this.generation;
    const callback = await authorize(openBrowser, signal);
    const tokens = await exchange({ grant_type: 'authorization_code', code: callback.code, code_verifier: callback.verifier, redirect_uri: HQ_AUTH.redirectUri });
    const identity = await verifyIdentity(tokens.idToken, callback.nonce);
    tokens.expiresAt = Math.min(tokens.expiresAt, identity.expiresAt);
    if (signal.aborted || generation !== this.generation) throw new Error('Sign-in was canceled.');
    await this.store.write(tokens);
    if (signal.aborted || generation !== this.generation) { await this.store.clear(); throw new Error('Sign-in was canceled.'); }
    this.tokens = tokens; this.identity = identity;
  }
  async bearer(): Promise<string> {
    if (this.tokens && this.identity && this.tokens.expiresAt > Date.now() + 60_000) return this.tokens.idToken;
    if (this.refreshing) return this.refreshing;
    const generation = this.generation;
    this.refreshing = (async () => {
      let tokens = this.tokens; if (!tokens) throw new Error('Sign in to continue.');
      if (tokens.expiresAt <= Date.now() + 60_000) tokens = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }, tokens.refreshToken);
      const identity = await verifyIdentity(tokens.idToken);
      tokens.expiresAt = Math.min(tokens.expiresAt, identity.expiresAt);
      if (generation !== this.generation) throw new Error('Sign in to continue.');
      await this.store.write(tokens);
      if (generation !== this.generation) throw new Error('Sign in to continue.');
      this.tokens = tokens; this.identity = identity;
      return tokens.idToken;
    })().catch(async (error: unknown) => {
      if (error instanceof SignInRequired && generation === this.generation) await this.signOut();
      throw error;
    }).finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
  async signOut(): Promise<void> { this.generation++; this.tokens = undefined; this.identity = undefined; await this.store.clear(); }
}
