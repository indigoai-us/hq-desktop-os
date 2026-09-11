import { safeStorage } from 'electron';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseTokens, type AccountTokens, type TokenStore } from './auth.js';

/** Shared HQ CLI cache under `$HOME/.hq` — desktop never reads or writes it. */
export const CLI_TOKEN_CACHE_SEGMENTS = ['.hq', 'cognito-tokens.json'] as const;

export function cliTokenCachePath(homeDirectory: string): string {
  return join(homeDirectory, ...CLI_TOKEN_CACHE_SEGMENTS);
}

export function secureStorageAvailable(): boolean {
  return (
    safeStorage.isEncryptionAvailable()
    && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
  );
}

/**
 * OS-encrypted account session under Electron userData.
 * Isolated from the CLI cache at `~/.hq/cognito-tokens.json`.
 */
export class CredentialStore implements TokenStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly directory: string) {}

  private get file() {
    return join(this.directory, 'account.encrypted');
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch((error: unknown) => {
      console.error('Account storage operation failed', error instanceof Error ? error.name : 'unknown');
    });
    return result;
  }

  read(): Promise<AccountTokens | undefined> {
    return this.serialize(async () => {
      if (!secureStorageAvailable()) return undefined;
      try {
        if ((await stat(this.file)).size > 128 * 1024) {
          throw new Error('The saved account could not be read. Please sign in again.');
        }
        return parseTokens(JSON.parse(safeStorage.decryptString(await readFile(this.file))));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    });
  }

  write(tokens: AccountTokens): Promise<void> {
    return this.serialize(async () => {
      if (!secureStorageAvailable()) {
        throw new Error('Unlock your computer’s secure password storage, then try signing in again.');
      }
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const encrypted = safeStorage.encryptString(JSON.stringify(parseTokens(tokens)));
      await writeFile(`${this.file}.tmp`, encrypted, { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
    });
  }

  clear(): Promise<void> {
    return this.serialize(async () => {
      await rm(this.file, { force: true });
      await rm(`${this.file}.tmp`, { force: true });
    });
  }
}

/** Backward-compatible alias used by earlier modules/tests. */
export class SecureTokenStore extends CredentialStore {}
