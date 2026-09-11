import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Host slice for install-id / sequence isolation (never invent platform `wsl`). */
export type HealthEnvironmentKey = 'native' | 'wsl2';

export interface HealthPersistedState {
  version: 1;
  /** Stable random installation identity for health reports — app userData only. */
  installationId: string;
  /** Monotonic per-installation heartbeat sequence. */
  sequence: number;
  lastHeartbeatAt: string | null;
  lastProbeAt: string | null;
  /** Last sync attempt (may fail) — distinct from success. */
  lastSyncAttemptAt: string | null;
  /** Genuine completed sync success only. */
  lastSyncSuccessAt: string | null;
  /** Engine/journal watermark — never treated as completed success. */
  syncEngineWatermarkAt: string | null;
  consecutiveFailures: number;
}

const emptyState = (): HealthPersistedState => ({
  version: 1,
  installationId: randomBytes(12).toString('hex'),
  sequence: 0,
  lastHeartbeatAt: null,
  lastProbeAt: null,
  lastSyncAttemptAt: null,
  lastSyncSuccessAt: null,
  syncEngineWatermarkAt: null,
  consecutiveFailures: 0,
});

function isValidState(raw: unknown): raw is HealthPersistedState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const state = raw as HealthPersistedState;
  return (
    state.version === 1
    && typeof state.installationId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(state.installationId)
    && typeof state.sequence === 'number'
    && Number.isSafeInteger(state.sequence)
    && state.sequence >= 0
    && (state.lastHeartbeatAt === null || typeof state.lastHeartbeatAt === 'string')
    && (state.lastProbeAt === null || typeof state.lastProbeAt === 'string')
    && (state.lastSyncAttemptAt === null || typeof state.lastSyncAttemptAt === 'string')
    && (state.lastSyncSuccessAt === null || typeof state.lastSyncSuccessAt === 'string')
    && (state.syncEngineWatermarkAt === null || typeof state.syncEngineWatermarkAt === 'string')
    && typeof state.consecutiveFailures === 'number'
    && Number.isSafeInteger(state.consecutiveFailures)
    && state.consecutiveFailures >= 0
  );
}

/** Normalize older scaffold files that lacked outcome fields. */
function migrateState(raw: Record<string, unknown>): HealthPersistedState | null {
  if (!isValidState({
    ...emptyState(),
    ...raw,
    lastSyncAttemptAt: raw.lastSyncAttemptAt ?? null,
    lastSyncSuccessAt: raw.lastSyncSuccessAt ?? null,
    syncEngineWatermarkAt: raw.syncEngineWatermarkAt ?? null,
    consecutiveFailures: typeof raw.consecutiveFailures === 'number' ? raw.consecutiveFailures : 0,
  })) {
    return null;
  }
  return {
    version: 1,
    installationId: String(raw.installationId),
    sequence: Number(raw.sequence),
    lastHeartbeatAt: (raw.lastHeartbeatAt as string | null) ?? null,
    lastProbeAt: (raw.lastProbeAt as string | null) ?? null,
    lastSyncAttemptAt: (raw.lastSyncAttemptAt as string | null) ?? null,
    lastSyncSuccessAt: (raw.lastSyncSuccessAt as string | null) ?? null,
    syncEngineWatermarkAt: (raw.syncEngineWatermarkAt as string | null) ?? null,
    consecutiveFailures: typeof raw.consecutiveFailures === 'number' ? raw.consecutiveFailures : 0,
  };
}

export interface HealthStateStoreOptions {
  /** Isolate native vs WSL install identity/sequence under userData. */
  environment?: HealthEnvironmentKey;
}

/**
 * Isolated health identity + sequence under app userData.
 * Never shares a sequence file with CLI (~/.hq) writers.
 */
export class HealthStateStore {
  private state: HealthPersistedState = emptyState();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly path: string;
  private readonly legacyPath: string;
  readonly environment: HealthEnvironmentKey;

  constructor(userDataDirectory: string, options?: HealthStateStoreOptions) {
    this.environment = options?.environment ?? 'native';
    // Environment-scoped path keeps native/WSL sequences from racing.
    this.path = join(userDataDirectory, 'client-health', this.environment, 'state.json');
    // Pre-US-022 flat path (still under userData — never ~/.hq).
    this.legacyPath = join(userDataDirectory, 'client-health-state.json');
  }

  get snapshot(): HealthPersistedState {
    return structuredClone(this.state);
  }

  /** Absolute path for tests — still under app userData, never ~/.hq. */
  get filePath(): string {
    return this.path;
  }

  async load(): Promise<HealthPersistedState> {
    await mkdir(join(this.path, '..'), { recursive: true, mode: 0o700 });
    try {
      const raw: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      this.state = this.parseRaw(raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // One-shot lift from the flat scaffold file into the environment path.
      try {
        const legacyRaw: unknown = JSON.parse(await readFile(this.legacyPath, 'utf8'));
        this.state = this.parseRaw(legacyRaw);
      } catch (legacyError) {
        if ((legacyError as NodeJS.ErrnoException).code !== 'ENOENT') throw legacyError;
      }
      await this.persist(this.state);
    }
    return this.snapshot;
  }

  private parseRaw(raw: unknown): HealthPersistedState {
    if (isValidState(raw)) return raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const migrated = migrateState(raw as Record<string, unknown>);
      if (migrated) return migrated;
    }
    throw new Error('Invalid client-health state.');
  }

  /**
   * Advance sequence by one (or wall-clock ms when ahead) and persist.
   * Wall-clock floor keeps out-of-order multi-process reports monotonic.
   */
  nextSequence(nowMs = Date.now()): Promise<number> {
    return this.serialize(async () => {
      const sequence = Math.max(this.state.sequence + 1, nowMs);
      await this.persist({
        ...this.state,
        sequence,
        lastHeartbeatAt: new Date(nowMs).toISOString(),
      });
      return sequence;
    });
  }

  markProbed(at = new Date().toISOString()): Promise<void> {
    return this.serialize(async () => {
      await this.persist({ ...this.state, lastProbeAt: at });
    });
  }

  recordSyncAttempt(at = new Date().toISOString()): Promise<void> {
    return this.serialize(async () => {
      await this.persist({ ...this.state, lastSyncAttemptAt: at });
    });
  }

  recordSyncSuccess(at = new Date().toISOString()): Promise<void> {
    return this.serialize(async () => {
      await this.persist({
        ...this.state,
        lastSyncAttemptAt: this.state.lastSyncAttemptAt ?? at,
        lastSyncSuccessAt: at,
        consecutiveFailures: 0,
      });
    });
  }

  recordSyncFailure(at = new Date().toISOString()): Promise<void> {
    return this.serialize(async () => {
      await this.persist({
        ...this.state,
        lastSyncAttemptAt: this.state.lastSyncAttemptAt ?? at,
        consecutiveFailures: Math.min(this.state.consecutiveFailures + 1, 100_000),
      });
    });
  }

  /**
   * Persist an engine/journal watermark without advancing completed success.
   */
  recordEngineWatermark(at: string): Promise<void> {
    return this.serialize(async () => {
      await this.persist({ ...this.state, syncEngineWatermarkAt: at });
    });
  }

  /** Replace installation id only when empty/invalid — never overwrite a stable id. */
  ensureInstallationId(preferred?: string): Promise<string> {
    return this.serialize(async () => {
      if (/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(this.state.installationId)) return this.state.installationId;
      const installationId = preferred && /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(preferred)
        ? preferred
        : randomBytes(12).toString('hex');
      await this.persist({ ...this.state, installationId });
      return installationId;
    });
  }

  private async persist(next: HealthPersistedState): Promise<void> {
    await mkdir(join(this.path, '..'), { recursive: true, mode: 0o700 });
    await writeFile(`${this.path}.tmp`, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(`${this.path}.tmp`, this.path);
    this.state = next;
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.then(() => undefined, (error: unknown) => {
      console.error('Client-health state update failed:', error instanceof Error ? error.message : 'unknown');
    });
    return next;
  }
}

/** Resolve environment key for health state isolation. */
export function healthEnvironmentKey(isWsl: boolean): HealthEnvironmentKey {
  return isWsl ? 'wsl2' : 'native';
}
