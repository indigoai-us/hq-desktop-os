import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface HealthPersistedState {
  version: 1;
  /** Stable random installation identity for health reports — app userData only. */
  installationId: string;
  /** Monotonic per-installation heartbeat sequence. */
  sequence: number;
  lastHeartbeatAt: string | null;
  lastProbeAt: string | null;
}

const emptyState = (): HealthPersistedState => ({
  version: 1,
  installationId: randomBytes(12).toString('hex'),
  sequence: 0,
  lastHeartbeatAt: null,
  lastProbeAt: null,
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
  );
}

/**
 * Isolated health identity + sequence under app userData.
 * Never shares a sequence file with CLI (~/.hq) writers.
 */
export class HealthStateStore {
  private state: HealthPersistedState = emptyState();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly path: string;

  constructor(userDataDirectory: string) {
    this.path = join(userDataDirectory, 'client-health-state.json');
  }

  get snapshot(): HealthPersistedState {
    return structuredClone(this.state);
  }

  async load(): Promise<HealthPersistedState> {
    await mkdir(join(this.path, '..'), { recursive: true, mode: 0o700 });
    try {
      const raw: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!isValidState(raw)) throw new Error('Invalid client-health state.');
      this.state = raw;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.persist(this.state);
    }
    return this.snapshot;
  }

  /** Advance sequence by one and persist. Returns the new sequence value. */
  nextSequence(): Promise<number> {
    return this.serialize(async () => {
      const sequence = this.state.sequence + 1;
      await this.persist({ ...this.state, sequence, lastHeartbeatAt: new Date().toISOString() });
      return sequence;
    });
  }

  markProbed(at = new Date().toISOString()): Promise<void> {
    return this.serialize(async () => {
      await this.persist({ ...this.state, lastProbeAt: at });
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
