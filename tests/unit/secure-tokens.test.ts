import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const storage = vi.hoisted(() => ({ available: true, backend: 'gnome_libsecret' }));
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => storage.available,
  getSelectedStorageBackend: () => storage.backend,
  encryptString: (text: string) => Buffer.from(text).map(byte => byte ^ 0xff),
  decryptString: (data: Buffer) => data.map(byte => byte ^ 0xff).toString(),
} }));
import { SecureTokenStore } from '../../src/main/secure-tokens';
afterEach(() => { storage.available = true; storage.backend = 'gnome_libsecret'; });
describe('protected account storage', () => {
  const tokens = { idToken: 'private-identity', accessToken: 'private-access', refreshToken: 'private-refresh', expiresAt: 123 };
  it('uses the OS codec, private permissions, and serializes sign-out after writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-secure-store-'));
    try {
      const store = new SecureTokenStore(directory); await store.write(tokens);
      const file = join(directory, 'account.encrypted');
      expect((await readFile(file)).includes(Buffer.from('private'))).toBe(false);
      if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(await store.read()).toEqual(tokens);
      await Promise.all([store.write(tokens), store.clear()]);
      expect(await store.read()).toBeUndefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('never falls back to plaintext when secure storage is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-secure-store-'));
    try { storage.available = false; await expect(new SecureTokenStore(directory).write(tokens)).rejects.toThrow('secure password storage'); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
});
