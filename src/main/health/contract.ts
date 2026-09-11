/**
 * Client-health wire contract adapter for hq-desktop-os.
 *
 * Compatible with the shared canonical field names and closed enums used by
 * support. This is a public MIT rewrite of the published contract shape — not
 * a copy of private server internals. Client attribution uses
 * {@link CLIENT_HEALTH_CLIENT_NAME} (`hq-desktop-os`), never `hq-desktop-app`
 * or `hq-sync`.
 */

export const CLIENT_HEALTH_CONTRACT_VERSION = 1;
/** Support attribution id for this companion (x-hq-client-name). */
export const CLIENT_HEALTH_CLIENT_NAME = 'hq-desktop-os' as const;
export const CLIENT_HEALTH_ATTRIBUTION_HEADER = 'x-hq-client-name' as const;

export const CLIENT_HEALTH_PLATFORMS = ['macos', 'windows', 'linux'] as const;
export type ClientHealthPlatform = (typeof CLIENT_HEALTH_PLATFORMS)[number];

export const CLIENT_HEALTH_ARCHS = ['x64', 'arm64'] as const;
export type ClientHealthArch = (typeof CLIENT_HEALTH_ARCHS)[number];

export const CLIENT_HEALTH_SOURCES = ['desktop', 'cli'] as const;
export type ClientHealthSource = (typeof CLIENT_HEALTH_SOURCES)[number];

export const CLIENT_HEALTH_SYNC_STATES = [
  'idle',
  'syncing',
  'paused',
  'conflict_blocked',
  'error',
  'never_synced',
] as const;
export type ClientHealthSyncState = (typeof CLIENT_HEALTH_SYNC_STATES)[number];

export const CLIENT_HEALTH_UPDATER_STATES = [
  'unchecked',
  'up_to_date',
  'update_available',
  'update_downloading',
  'update_ready',
  'update_failed',
  'unsupported',
] as const;
export type ClientHealthUpdaterState = (typeof CLIENT_HEALTH_UPDATER_STATES)[number];

export const CLIENT_HEALTH_FAILURE_REASONS = [
  'SYNC_PAUSED',
  'CONFLICT_BLOCKED',
  'DESKTOP_OUTDATED',
  'CLI_OUTDATED',
  'CORE_OUTDATED',
  'AUTH_EXPIRED',
  'UPDATE_FAILED',
  'RUNNER_FAILED',
  'PERMISSION_DENIED',
  'DISK_FULL',
  'HEARTBEAT_STALE',
  'MANUAL_ACTION_REQUIRED',
] as const;
export type ClientHealthFailureReason = (typeof CLIENT_HEALTH_FAILURE_REASONS)[number];

export const CLIENT_HEALTH_REPAIR_KINDS = [
  'CHECK_NOW',
  'RETRY_SYNC',
  'RESUME_SYNC',
  'REPAIR_CLI',
  'UPDATE_CORE',
  'APPLY_DESKTOP_UPDATE',
  'RESTART_APP',
] as const;
export type ClientHealthRepairKind = (typeof CLIENT_HEALTH_REPAIR_KINDS)[number];

export const CLIENT_HEALTH_COMMAND_STATES = [
  'queued',
  'acknowledged',
  'running',
  'succeeded',
  'failed',
  'expired',
  'canceled',
] as const;
export type ClientHealthCommandState = (typeof CLIENT_HEALTH_COMMAND_STATES)[number];

export const CLIENT_HEALTH_DIAGNOSTIC_CHECKS = [
  'auth',
  'runner',
  'cli',
  'core',
  'updater',
  'sync',
  'conflicts',
  'storage',
  'permissions',
] as const;
export type ClientHealthDiagnosticCheck = (typeof CLIENT_HEALTH_DIAGNOSTIC_CHECKS)[number];

export const CLIENT_HEALTH_CHECK_STATUSES = ['pass', 'fail', 'skip'] as const;
export type ClientHealthCheckStatus = (typeof CLIENT_HEALTH_CHECK_STATUSES)[number];

export const CLIENT_HEALTH_MAX_STRING_LENGTH = 64;
export const CLIENT_HEALTH_MAX_CONSECUTIVE_FAILURES = 100_000;
export const CLIENT_HEALTH_MAX_CONFLICT_COUNT = 100_000;
export const CLIENT_HEALTH_MAX_CHECKS = 16;
export const CLIENT_HEALTH_MAX_ERROR_LINE_COUNT = 50;
export const CLIENT_HEALTH_MAX_FILE_SIZE_BYTES = 1_073_741_824;
export const CLIENT_HEALTH_MAX_FILE_AGE_SECONDS = 315_360_000;

export interface ClientHealthVersions {
  desktop?: string;
  cli?: string;
  core?: string;
  syncRunner?: string;
}

export interface ClientHealthLocalFilesOverview {
  syncLogExists: boolean;
  syncLogSizeBytes: number;
  syncLogAgeSeconds: number;
  journalExists: boolean;
  journalSizeBytes: number;
  journalAgeSeconds: number;
  recentErrorLineCount: number;
}

export interface ClientHealthHeartbeat {
  contractVersion: number;
  installationId: string;
  source: ClientHealthSource;
  platform: ClientHealthPlatform;
  arch: ClientHealthArch;
  sentAt: string;
  sequence: number;
  versions: ClientHealthVersions;
  syncState: ClientHealthSyncState;
  lastSyncAttemptAt?: string;
  lastSyncSuccessAt?: string;
  syncEngineWatermarkAt?: string;
  consecutiveFailures: number;
  conflictCount?: number;
  updaterState?: ClientHealthUpdaterState;
  failureReason?: ClientHealthFailureReason;
  localFilesOverview?: ClientHealthLocalFilesOverview;
}

export interface ClientHealthCheckResult {
  check: ClientHealthDiagnosticCheck;
  status: ClientHealthCheckStatus;
  reason?: ClientHealthFailureReason;
}

export interface ClientHealthCommandReceipt {
  contractVersion: number;
  commandId: string;
  installationId: string;
  kind: ClientHealthRepairKind;
  state: ClientHealthCommandState;
  revision: number;
  occurredAt: string;
  checks?: ClientHealthCheckResult[];
  failureReason?: ClientHealthFailureReason;
  manualActionRequired?: boolean;
}

export type ClientHealthContractErrorCode =
  | 'MISSING_FIELD'
  | 'INVALID_TYPE'
  | 'UNKNOWN_ENUM_VALUE'
  | 'UNSAFE_VALUE'
  | 'OUT_OF_BOUNDS'
  | 'UNSUPPORTED_CONTRACT_VERSION';

export class ClientHealthContractError extends Error {
  readonly code: ClientHealthContractErrorCode;
  readonly field: string;
  constructor(code: ClientHealthContractErrorCode, field: string, detail?: string) {
    super(`client-health contract violation [${code}] at ${field}${detail ? `: ${detail}` : ''}`);
    this.name = 'ClientHealthContractError';
    this.code = code;
    this.field = field;
  }
}

const INSTALLATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SECRET_PREFIXES = ['AKIA', 'ASIA', 'ghp_', 'gho_', 'github_pat_', 'xox', 'sk-', 'eyJ', '-----BEGIN'];

function assertSafeBoundedString(field: string, value: unknown): string {
  if (value === undefined || value === null) throw new ClientHealthContractError('MISSING_FIELD', field);
  if (typeof value !== 'string') throw new ClientHealthContractError('INVALID_TYPE', field, 'expected string');
  if (value.length === 0 || value.length > CLIENT_HEALTH_MAX_STRING_LENGTH) {
    throw new ClientHealthContractError('OUT_OF_BOUNDS', field, `length must be 1..${CLIENT_HEALTH_MAX_STRING_LENGTH}`);
  }
  if (/[\s;|&$<>`'"(){}*?!#=,]/.test(value)) {
    throw new ClientHealthContractError('UNSAFE_VALUE', field, 'free-form text is not a contract value');
  }
  if (value.includes('/') || value.includes('\\') || value.startsWith('~') || /^[A-Za-z]:/.test(value)) {
    throw new ClientHealthContractError('UNSAFE_VALUE', field, 'path-shaped value rejected');
  }
  for (const prefix of SECRET_PREFIXES) {
    if (value.startsWith(prefix)) throw new ClientHealthContractError('UNSAFE_VALUE', field, 'secret-shaped value rejected');
  }
  return value;
}

function assertVersion(field: string, value: unknown): string {
  const safe = assertSafeBoundedString(field, value);
  if (!SEMVER.test(safe)) throw new ClientHealthContractError('UNSAFE_VALUE', field, 'expected a SemVer version');
  return safe;
}

function assertIsoUtc(field: string, value: unknown): string {
  const safe = assertSafeBoundedString(field, value);
  if (!ISO_UTC.test(safe) || !Number.isFinite(Date.parse(safe))) {
    throw new ClientHealthContractError('UNSAFE_VALUE', field, 'expected ISO-8601 UTC timestamp');
  }
  return safe;
}

function assertEnum<T extends string>(field: string, value: unknown, allowed: readonly T[]): T {
  const safe = assertSafeBoundedString(field, value);
  if (!(allowed as readonly string[]).includes(safe)) {
    throw new ClientHealthContractError('UNKNOWN_ENUM_VALUE', field, `"${safe.slice(0, 32)}" is not allowed`);
  }
  return safe as T;
}

function assertBoundedInt(field: string, value: unknown, max: number): number {
  if (value === undefined || value === null) throw new ClientHealthContractError('MISSING_FIELD', field);
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ClientHealthContractError('INVALID_TYPE', field, 'expected integer');
  }
  if (value < 0 || value > max) throw new ClientHealthContractError('OUT_OF_BOUNDS', field);
  return value;
}

function assertBoolean(field: string, value: unknown): boolean {
  if (value === undefined || value === null) throw new ClientHealthContractError('MISSING_FIELD', field);
  if (typeof value !== 'boolean') throw new ClientHealthContractError('INVALID_TYPE', field, 'expected boolean');
  return value;
}

function asRecord(field: string, value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ClientHealthContractError('INVALID_TYPE', field, 'expected object');
  }
  return value as Record<string, unknown>;
}

function parseVersions(field: string, input: unknown): ClientHealthVersions {
  const raw = asRecord(field, input);
  const versions: ClientHealthVersions = {};
  for (const key of ['desktop', 'cli', 'core', 'syncRunner'] as const) {
    if (raw[key] !== undefined) versions[key] = assertVersion(`${field}.${key}`, raw[key]);
  }
  return versions;
}

function parseLocalFilesOverview(field: string, input: unknown): ClientHealthLocalFilesOverview {
  const raw = asRecord(field, input);
  return {
    syncLogExists: assertBoolean(`${field}.syncLogExists`, raw.syncLogExists),
    syncLogSizeBytes: assertBoundedInt(`${field}.syncLogSizeBytes`, raw.syncLogSizeBytes, CLIENT_HEALTH_MAX_FILE_SIZE_BYTES),
    syncLogAgeSeconds: assertBoundedInt(`${field}.syncLogAgeSeconds`, raw.syncLogAgeSeconds, CLIENT_HEALTH_MAX_FILE_AGE_SECONDS),
    journalExists: assertBoolean(`${field}.journalExists`, raw.journalExists),
    journalSizeBytes: assertBoundedInt(`${field}.journalSizeBytes`, raw.journalSizeBytes, CLIENT_HEALTH_MAX_FILE_SIZE_BYTES),
    journalAgeSeconds: assertBoundedInt(`${field}.journalAgeSeconds`, raw.journalAgeSeconds, CLIENT_HEALTH_MAX_FILE_AGE_SECONDS),
    recentErrorLineCount: assertBoundedInt(`${field}.recentErrorLineCount`, raw.recentErrorLineCount, CLIENT_HEALTH_MAX_ERROR_LINE_COUNT),
  };
}

/** Parse + validate one heartbeat. Extra fields are ignored; unsafe values fail closed. */
export function parseClientHealthHeartbeat(input: unknown): ClientHealthHeartbeat {
  const raw = asRecord('heartbeat', input);
  const contractVersion = assertBoundedInt('contractVersion', raw.contractVersion, 1_000);
  if (contractVersion < 1 || contractVersion > CLIENT_HEALTH_CONTRACT_VERSION) {
    throw new ClientHealthContractError('UNSUPPORTED_CONTRACT_VERSION', 'contractVersion');
  }
  const installationId = assertSafeBoundedString('installationId', raw.installationId);
  if (!INSTALLATION_ID.test(installationId)) throw new ClientHealthContractError('UNSAFE_VALUE', 'installationId');
  const heartbeat: ClientHealthHeartbeat = {
    contractVersion,
    installationId,
    source: assertEnum('source', raw.source, CLIENT_HEALTH_SOURCES),
    platform: assertEnum('platform', raw.platform, CLIENT_HEALTH_PLATFORMS),
    arch: assertEnum('arch', raw.arch, CLIENT_HEALTH_ARCHS),
    sentAt: assertIsoUtc('sentAt', raw.sentAt),
    sequence: assertBoundedInt('sequence', raw.sequence, Number.MAX_SAFE_INTEGER),
    versions: parseVersions('versions', raw.versions),
    syncState: assertEnum('syncState', raw.syncState, CLIENT_HEALTH_SYNC_STATES),
    consecutiveFailures: assertBoundedInt('consecutiveFailures', raw.consecutiveFailures, CLIENT_HEALTH_MAX_CONSECUTIVE_FAILURES),
  };
  if (raw.lastSyncAttemptAt !== undefined) heartbeat.lastSyncAttemptAt = assertIsoUtc('lastSyncAttemptAt', raw.lastSyncAttemptAt);
  if (raw.lastSyncSuccessAt !== undefined) heartbeat.lastSyncSuccessAt = assertIsoUtc('lastSyncSuccessAt', raw.lastSyncSuccessAt);
  if (raw.syncEngineWatermarkAt !== undefined) heartbeat.syncEngineWatermarkAt = assertIsoUtc('syncEngineWatermarkAt', raw.syncEngineWatermarkAt);
  if (raw.conflictCount !== undefined) heartbeat.conflictCount = assertBoundedInt('conflictCount', raw.conflictCount, CLIENT_HEALTH_MAX_CONFLICT_COUNT);
  if (raw.updaterState !== undefined) heartbeat.updaterState = assertEnum('updaterState', raw.updaterState, CLIENT_HEALTH_UPDATER_STATES);
  if (raw.failureReason !== undefined) heartbeat.failureReason = assertEnum('failureReason', raw.failureReason, CLIENT_HEALTH_FAILURE_REASONS);
  if (raw.localFilesOverview !== undefined) heartbeat.localFilesOverview = parseLocalFilesOverview('localFilesOverview', raw.localFilesOverview);
  return heartbeat;
}

/** Parse + validate one diagnostic/repair command receipt. */
export function parseClientHealthCommandReceipt(input: unknown): ClientHealthCommandReceipt {
  const raw = asRecord('receipt', input);
  const contractVersion = assertBoundedInt('contractVersion', raw.contractVersion, 1_000);
  if (contractVersion < 1 || contractVersion > CLIENT_HEALTH_CONTRACT_VERSION) {
    throw new ClientHealthContractError('UNSUPPORTED_CONTRACT_VERSION', 'contractVersion');
  }
  const commandId = assertSafeBoundedString('commandId', raw.commandId);
  if (!COMMAND_ID.test(commandId)) throw new ClientHealthContractError('UNSAFE_VALUE', 'commandId');
  const installationId = assertSafeBoundedString('installationId', raw.installationId);
  if (!INSTALLATION_ID.test(installationId)) throw new ClientHealthContractError('UNSAFE_VALUE', 'installationId');
  const receipt: ClientHealthCommandReceipt = {
    contractVersion,
    commandId,
    installationId,
    kind: assertEnum('kind', raw.kind, CLIENT_HEALTH_REPAIR_KINDS),
    state: assertEnum('state', raw.state, CLIENT_HEALTH_COMMAND_STATES),
    revision: assertBoundedInt('revision', raw.revision, Number.MAX_SAFE_INTEGER),
    occurredAt: assertIsoUtc('occurredAt', raw.occurredAt),
  };
  if (raw.failureReason !== undefined) receipt.failureReason = assertEnum('failureReason', raw.failureReason, CLIENT_HEALTH_FAILURE_REASONS);
  if (raw.manualActionRequired !== undefined) receipt.manualActionRequired = assertBoolean('manualActionRequired', raw.manualActionRequired);
  if (raw.checks !== undefined) {
    if (!Array.isArray(raw.checks)) throw new ClientHealthContractError('INVALID_TYPE', 'checks', 'expected array');
    if (raw.checks.length > CLIENT_HEALTH_MAX_CHECKS) throw new ClientHealthContractError('OUT_OF_BOUNDS', 'checks');
    receipt.checks = raw.checks.map((entry, index) => {
      const check = asRecord(`checks[${index}]`, entry);
      const result: ClientHealthCheckResult = {
        check: assertEnum(`checks[${index}].check`, check.check, CLIENT_HEALTH_DIAGNOSTIC_CHECKS),
        status: assertEnum(`checks[${index}].status`, check.status, CLIENT_HEALTH_CHECK_STATUSES),
      };
      if (check.reason !== undefined) result.reason = assertEnum(`checks[${index}].reason`, check.reason, CLIENT_HEALTH_FAILURE_REASONS);
      return result;
    });
  }
  return receipt;
}

/** True when an incoming heartbeat sequence may replace the stored snapshot. */
export function shouldApplyHeartbeat(storedSequence: number | undefined, incomingSequence: number): boolean {
  if (storedSequence === undefined) return true;
  return incomingSequence > storedSequence;
}

/** Map process.platform to the closed health platform enum (no invented `wsl`). */
export function healthPlatformFromNode(platform: NodeJS.Platform = process.platform): ClientHealthPlatform {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  return 'linux';
}

/** Map process.arch to the closed health arch enum. */
export function healthArchFromNode(arch: string = process.arch): ClientHealthArch {
  return arch === 'arm64' ? 'arm64' : 'x64';
}
