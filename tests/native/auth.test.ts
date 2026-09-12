import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const storage = vi.hoisted(() => ({ available: true, backend: 'gnome_libsecret' }));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => storage.available,
    getSelectedStorageBackend: () => storage.backend,
    encryptString: (text: string) => Buffer.from(text).map((byte) => byte ^ 0xff),
    decryptString: (data: Buffer) => data.map((byte) => byte ^ 0xff).toString(),
  },
}));

import { AccountSession } from '../../src/main/auth';
import {
  CLI_TOKEN_CACHE_SEGMENTS,
  CredentialStore,
  cliTokenCachePath,
  secureStorageAvailable,
} from '../../src/main/credential-store';
import { HQ_AUTH_PUBLIC, type PublicAccount } from '../../src/shared/auth';

const directories: string[] = [];

afterEach(async () => {
  storage.available = true;
  storage.backend = 'gnome_libsecret';
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixtureHome() {
  const root = await mkdtemp(join(tmpdir(), 'hq-auth-native-'));
  directories.push(root);
  const home = join(root, 'home');
  const userData = join(root, 'userData');
  await mkdir(join(home, '.hq'), { recursive: true, mode: 0o700 });
  await mkdir(userData, { recursive: true, mode: 0o700 });
  return { root, home, userData };
}

describe('US-010 credential lifecycle (native Linux)', () => {
  it('protects persisted credentials and refuses Linux basic_text', async () => {
    const { userData } = await fixtureHome();
    const tokens = {
      accessToken: 'private-access',
      idToken: 'private-identity',
      refreshToken: 'private-refresh',
      expiresAt: Date.now() + 60_000,
    };
    const store = new CredentialStore(userData);
    await store.write(tokens);
    const encrypted = await readFile(join(userData, 'account.encrypted'));
    expect(encrypted.includes(Buffer.from('private'))).toBe(false);
    expect(await store.read()).toEqual(tokens);

    storage.backend = 'basic_text';
    expect(secureStorageAvailable()).toBe(false);
    await expect(new CredentialStore(userData).write(tokens)).rejects.toThrow(/secure password storage/i);
  });

  it('never imports or overwrites the shared CLI token cache', async () => {
    const { home, userData } = await fixtureHome();
    const cliCache = cliTokenCachePath(home);
    expect(CLI_TOKEN_CACHE_SEGMENTS).toEqual(['.hq', 'cognito-tokens.json']);
    expect(cliCache).toBe(join(home, '.hq', 'cognito-tokens.json'));

    const marker = JSON.stringify({ access_token: 'cli-only-access', refresh_token: 'cli-only-refresh' });
    await writeFile(cliCache, marker, { mode: 0o600 });

    const store = new CredentialStore(userData);
    await store.write({
      accessToken: 'desktop-access',
      idToken: 'desktop-id',
      refreshToken: 'desktop-refresh',
      expiresAt: Date.now() + 60_000,
    });
    await store.clear();

    expect(await readFile(cliCache, 'utf8')).toBe(marker);
    await expect(readFile(join(userData, 'account.encrypted'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('clears owned credentials on sign-out without touching workspace files', async () => {
    const { root, userData } = await fixtureHome();
    const workspace = join(root, 'HQ');
    await mkdir(join(workspace, 'core'), { recursive: true });
    await mkdir(join(workspace, 'companies'));
    await writeFile(join(workspace, 'keep.txt'), 'user-owned');

    const store = new CredentialStore(userData);
    const session = new AccountSession(store);
    await store.write({
      accessToken: 'access',
      idToken: 'id',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 60_000,
    });
    // Restore only hydrates when verify succeeds; clear owned store directly via signOut.
    await session.signOut();
    expect(await store.read()).toBeUndefined();
    expect(await readFile(join(workspace, 'keep.txt'), 'utf8')).toBe('user-owned');
  });

  it('exposes renderer-safe account types without token fields and matches verified public auth config', () => {
    const account: PublicAccount = { status: 'signed-out', label: null };
    expect('accessToken' in account).toBe(false);
    expect('idToken' in account).toBe(false);
    expect('refreshToken' in account).toBe(false);
    expect(HQ_AUTH_PUBLIC.redirectUri).toBe('http://localhost:53682/callback');
    expect(HQ_AUTH_PUBLIC.clientId).toBe('7acei2c8v870enheptb1j5foln');
    expect(HQ_AUTH_PUBLIC.issuer).toContain('cognito-idp.us-east-1.amazonaws.com');
  });
});
