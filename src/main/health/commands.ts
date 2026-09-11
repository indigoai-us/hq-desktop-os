import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CLIENT_HEALTH_CONTRACT_VERSION,
  parseClientHealthCommandReceipt,
  type ClientHealthCheckResult,
  type ClientHealthCommandReceipt,
  type ClientHealthCommandState,
  type ClientHealthFailureReason,
  type ClientHealthRepairKind,
} from './contract.js';
import { runHealthProbes, type ProbeContext } from './probes.js';

export interface HealthCommandRecord {
  commandId: string;
  installationId: string;
  kind: ClientHealthRepairKind;
  state: ClientHealthCommandState;
  revision: number;
  issuedAt: string;
  expiresAt: string;
  occurredAt: string;
  checks?: ClientHealthCheckResult[];
  failureReason?: ClientHealthFailureReason;
  manualActionRequired?: boolean;
}

interface CommandLedgerFile {
  version: 1;
  commands: HealthCommandRecord[];
}

const TERMINAL: ReadonlySet<ClientHealthCommandState> = new Set(['succeeded', 'failed', 'expired', 'canceled']);
const MAX_LEDGER = 50;

function isRecord(raw: unknown): raw is HealthCommandRecord {
  if (!raw || typeof raw !== 'object') return false;
  const command = raw as HealthCommandRecord;
  return (
    typeof command.commandId === 'string'
    && typeof command.installationId === 'string'
    && typeof command.kind === 'string'
    && typeof command.state === 'string'
    && typeof command.revision === 'number'
    && typeof command.issuedAt === 'string'
    && typeof command.expiresAt === 'string'
    && typeof command.occurredAt === 'string'
  );
}

/**
 * Local CHECK_NOW command ledger: ack → running → terminal.
 * Persists across restarts. Rejects invalid/expired/duplicate execution.
 * Unsupported mutating kinds return a truthful failure and never run.
 */
export class HealthCommandLedger {
  private commands: HealthCommandRecord[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private readonly path: string;
  private readonly now: () => Date;

  constructor(userDataDirectory: string, now: () => Date = () => new Date()) {
    this.path = join(userDataDirectory, 'client-health-commands.json');
    this.now = now;
  }

  get snapshot(): HealthCommandRecord[] {
    return structuredClone(this.commands);
  }

  async load(): Promise<void> {
    await mkdir(join(this.path, '..'), { recursive: true, mode: 0o700 });
    try {
      const raw: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid command ledger.');
      const file = raw as CommandLedgerFile;
      if (file.version !== 1 || !Array.isArray(file.commands) || !file.commands.every(isRecord)) {
        throw new Error('Invalid command ledger.');
      }
      this.commands = file.commands;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.persist();
    }
  }

  /**
   * Accept a support-issued command into the ledger.
   * Rejects malformed, expired, wrong-installation, or already-terminal duplicates.
   */
  accept(input: {
    commandId: string;
    installationId: string;
    kind: ClientHealthRepairKind;
    issuedAt: string;
    expiresAt: string;
  }): Promise<HealthCommandRecord> {
    return this.serialize(async () => {
      const now = this.now();
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(input.commandId)) {
        throw new Error('Invalid health command id.');
      }
      if (Date.parse(input.expiresAt) <= now.getTime()) {
        const expired = this.upsert({
          commandId: input.commandId,
          installationId: input.installationId,
          kind: input.kind,
          state: 'expired',
          revision: 1,
          issuedAt: input.issuedAt,
          expiresAt: input.expiresAt,
          occurredAt: now.toISOString(),
          failureReason: 'HEARTBEAT_STALE',
        });
        await this.persist();
        return expired;
      }
      const existing = this.commands.find((command) => command.commandId === input.commandId);
      if (existing) {
        if (TERMINAL.has(existing.state) || existing.state === 'acknowledged' || existing.state === 'running') {
          return structuredClone(existing);
        }
      }
      const record = this.upsert({
        commandId: input.commandId,
        installationId: input.installationId,
        kind: input.kind,
        state: 'acknowledged',
        revision: (existing?.revision ?? 0) + 1,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        occurredAt: now.toISOString(),
      });
      await this.persist();
      return record;
    });
  }

  /**
   * Execute an acknowledged CHECK_NOW. Other repair kinds fail closed without mutation.
   */
  execute(commandId: string, installationId: string, context: ProbeContext): Promise<ClientHealthCommandReceipt> {
    return this.serialize(async () => {
      const now = this.now();
      const command = this.commands.find((entry) => entry.commandId === commandId);
      if (!command) throw new Error('Unknown health command.');
      if (command.installationId !== installationId) {
        return this.terminalReceipt(command, {
          state: 'failed',
          failureReason: 'PERMISSION_DENIED',
          occurredAt: now.toISOString(),
        });
      }
      if (TERMINAL.has(command.state)) return this.toReceipt(command);
      if (Date.parse(command.expiresAt) <= now.getTime()) {
        return this.terminalReceipt(command, {
          state: 'expired',
          failureReason: 'HEARTBEAT_STALE',
          occurredAt: now.toISOString(),
        });
      }
      if (command.kind !== 'CHECK_NOW') {
        return this.terminalReceipt(command, {
          state: 'failed',
          failureReason: 'MANUAL_ACTION_REQUIRED',
          manualActionRequired: true,
          occurredAt: now.toISOString(),
        });
      }
      this.upsert({
        ...command,
        state: 'running',
        revision: command.revision + 1,
        occurredAt: now.toISOString(),
      });
      await this.persist();

      const checks = await runHealthProbes(context);
      const failed = checks.some((check) => check.status === 'fail');
      return this.terminalReceipt(command, {
        state: failed ? 'failed' : 'succeeded',
        revision: command.revision + 2,
        occurredAt: this.now().toISOString(),
        checks,
        failureReason: failed ? checks.find((check) => check.status === 'fail')?.reason : undefined,
      });
    });
  }

  toReceipt(command: HealthCommandRecord): ClientHealthCommandReceipt {
    return parseClientHealthCommandReceipt({
      contractVersion: CLIENT_HEALTH_CONTRACT_VERSION,
      commandId: command.commandId,
      installationId: command.installationId,
      kind: command.kind,
      state: command.state,
      revision: command.revision,
      occurredAt: command.occurredAt,
      checks: command.checks,
      failureReason: command.failureReason,
      manualActionRequired: command.manualActionRequired,
    });
  }

  private async terminalReceipt(
    command: HealthCommandRecord,
    patch: Partial<HealthCommandRecord> & { state: ClientHealthCommandState },
  ): Promise<ClientHealthCommandReceipt> {
    const next = this.upsert({
      ...command,
      ...patch,
      revision: patch.revision ?? command.revision + 1,
    });
    await this.persist();
    return this.toReceipt(next);
  }

  private upsert(record: HealthCommandRecord): HealthCommandRecord {
    const index = this.commands.findIndex((command) => command.commandId === record.commandId);
    if (index >= 0) this.commands[index] = record;
    else this.commands.push(record);
    if (this.commands.length > MAX_LEDGER) {
      this.commands = this.commands.slice(this.commands.length - MAX_LEDGER);
    }
    return structuredClone(record);
  }

  private async persist(): Promise<void> {
    const body: CommandLedgerFile = { version: 1, commands: this.commands };
    await writeFile(`${this.path}.tmp`, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    await rename(`${this.path}.tmp`, this.path);
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.then(() => undefined, (error: unknown) => {
      console.error('Client-health command ledger failed:', error instanceof Error ? error.message : 'unknown');
    });
    return next;
  }
}
