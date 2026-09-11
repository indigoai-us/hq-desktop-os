import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function readJson<T>(rel: string): T {
  return JSON.parse(read(rel)) as T;
}

describe('US-010 HQ sign-in and protected credential lifecycle', () => {
  it('ships the PRD auth modules and renderer-safe account surface', () => {
    for (const rel of [
      'src/main/auth.ts',
      'src/main/credential-store.ts',
      'src/shared/auth.ts',
      'src/renderer/screens/account.tsx',
      'tests/native/auth.test.ts',
    ]) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }

    const shared = read('src/shared/auth.ts');
    expect(shared).toContain('PublicAccount');
    expect(shared).toContain('HQ_AUTH_PUBLIC');
    expect(shared).not.toMatch(/accessToken|refreshToken/);

    const store = read('src/main/credential-store.ts');
    expect(store).toContain('basic_text');
    expect(store).toContain('account.encrypted');
    expect(store).toContain('cognito-tokens.json');
    expect(store).toContain('CredentialStore');

    const auth = read('src/main/auth.ts');
    expect(auth).toContain('pkce');
    expect(auth).toContain('authorize');
    expect(auth).toContain('verifyIdentity');
    expect(auth).toContain('refresh_token');
    expect(auth).toContain('signOut');

    const account = read('src/renderer/screens/account.tsx');
    expect(account).toContain('AccountScreen');
    expect(account).toContain("action: connected ? 'sign-out' : 'sign-in'");
    expect(account).not.toMatch(/accessToken|idToken|refreshToken/);
  });

  it('verifies membership before sync and keeps tokens off the renderer snapshot', () => {
    const companion = read('src/main/companion.ts');
    expect(companion).toContain('prepareScopesAfterAuth');
    expect(companion).toContain('CredentialStore');
    expect(companion).toContain('workspaceAccounts.bind');
    expect(companion).toContain("case 'sign-out'");
    expect(companion).toContain('sync.reset');
    expect(companion).not.toMatch(/cognito-tokens\.json/);

    const snapshot = read('src/shared/companion.ts');
    expect(snapshot).toContain('PublicAccount');
    expect(snapshot).toContain('CredentialStorageStatus');

    const syncChild = read('src/main/sync-child.ts');
    expect(syncChild).toMatch(/Tokens never[\s\S]*shared CLI token cache/);
    expect(syncChild).toContain("type: 'token-request'");
  });

  it('records Linux credential coverage and deferred Windows secure store', () => {
    const manifest = readJson<{
      platformEvidence: {
        linux: { credentialLifecycle?: string };
        windows: { credentialLifecycle?: string };
      };
    }>('runtime/manifest.json');
    expect(manifest.platformEvidence.linux.credentialLifecycle).toBe('covered');
    expect(manifest.platformEvidence.windows.credentialLifecycle).toBe('deferred');

    const docs = read('docs/auth-verification.md');
    expect(docs).toContain('CLI token cache');
    expect(docs).toContain('basic_text');
    expect(docs).toContain('account.encrypted');

    const boundary = read('docs/platform-boundary.md');
    expect(boundary).toContain('Credential lifecycle (US-010 Linux slice)');
    expect(boundary).toContain('Windows Credential Manager');
  });
});
