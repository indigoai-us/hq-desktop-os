import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompanionHealth } from '../shared/health.js';
import type { SyncStatus } from '../shared/sync.js';
import type { WorkspaceEnvironment } from '../shared/workspace.js';
import { prepareDependencies } from './setup-dependencies.js';

/** Closed diagnosis for the managed HQ Cloud / toolchain runtime. */
export type RuntimeDiagnosis = 'ok' | 'missing' | 'failed';

export interface DiagnosticsCheck {
  name: string;
  state: 'ok' | 'attention' | 'unavailable';
  detail: string;
}

export interface DiagnosticsReportInput {
  version: string;
  platform: string;
  workspaceCount: number;
  workspaceEnvironments: WorkspaceEnvironment[];
  runtime: { version: string; available: boolean; node: string; diagnosis: RuntimeDiagnosis };
  sync: Pick<SyncStatus, 'phase' | 'lastSuccess' | 'conflicts' | 'transport' | 'pass' | 'pendingCount'> & {
    message: string;
  };
  checks: DiagnosticsCheck[];
  health: CompanionHealth;
  /** Optional poisoned fields used only in tests to prove redaction. */
  extras?: Record<string, unknown>;
}

export interface DiagnosticsReport {
  generatedAt: string;
  app: 'hq-desktop-os';
  version: string;
  platform: string;
  workspaceCount: number;
  workspaceEnvironments: WorkspaceEnvironment[];
  runtime: { version: string; available: boolean; node: string; diagnosis: RuntimeDiagnosis };
  sync: {
    phase: string;
    lastSuccess: string | null;
    conflicts: number;
    transport: string | null;
    pass: string | null;
    pendingCount: number;
    message: string;
  };
  checks: DiagnosticsCheck[];
  health: {
    overall: string;
    lastCheckedAt: string | null;
    reportingEnabled: boolean;
    clientName: 'hq-desktop-os';
    checks: { id: string; label: string; status: string; detail: string }[];
  };
}

export interface RuntimeGuidance {
  diagnosis: RuntimeDiagnosis;
  title: string;
  detail: string;
  retryAvailable: boolean;
  repairAvailable: boolean;
}

export interface RepairOutcome {
  status: 'ready' | 'error' | 'unsupported';
  guidance: string;
  toolchainMarker?: string;
}

const SECRET_PREFIXES = [
  'AKIA',
  'ASIA',
  'ghp_',
  'gho_',
  'ghu_',
  'ghs_',
  'ghr_',
  'github_pat_',
  'xoxb-',
  'xoxp-',
  'xoxa-',
  'xoxr-',
  'sk-',
  'sk_live_',
  'sk_test_',
  'rk_live_',
  'rk_test_',
  'eyJ',
  '-----BEGIN',
];

const SENSITIVE_KEY = /(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|refresh[_-]?token|id[_-]?token|authorization|credential|bearer)/i;
const ABS_PATH = /(?:^|[\s="'`(])((?:\/(?:home|Users|var|tmp|private|mnt|opt|root)\/[^\s"'`)]+)|(?:[A-Za-z]:\\[^\s"'`)]+)|(?:\\\\wsl\$\\[^\s"'`)]+)|(?:~\/[^\s"'`)]+))/g;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const BEARER = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KEY_VALUE = /([A-Za-z0-9_-]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization|credential)[A-Za-z0-9_-]*)\s*[:=]\s*([^\s,;]+)/gi;
const REDACTED = '[REDACTED]';
const PATH_REDACTED = '[PATH]';

/** Strip credentials, absolute paths, and secret-shaped values from free text. */
export function redactSensitiveText(input: string): string {
  let text = input;
  text = text.replace(JWT, REDACTED);
  text = text.replace(BEARER, REDACTED);
  text = text.replace(KEY_VALUE, (_match, key: string) => `${key}=${REDACTED}`);
  text = text.replace(ABS_PATH, (match, path: string) => match.replace(path, PATH_REDACTED));
  for (const prefix of SECRET_PREFIXES) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`${escaped}[A-Za-z0-9/_+=.-]{4,}`, 'g'), REDACTED);
  }
  return text;
}

function redactUnknown(value: unknown, keyHint = ''): unknown {
  if (typeof value === 'string') {
    if (SENSITIVE_KEY.test(keyHint)) return REDACTED;
    if (value.includes('/') || value.includes('\\') || value.startsWith('~') || /^[A-Za-z]:/.test(value)) {
      // Path-shaped strings are never exported as-is.
      if (/^(\/|~\/|[A-Za-z]:\\|\\\\)/.test(value) || value.includes('/home/') || value.includes('/Users/')) {
        return PATH_REDACTED;
      }
    }
    for (const prefix of SECRET_PREFIXES) {
      if (value.startsWith(prefix) || value.includes(prefix)) return redactSensitiveText(value);
    }
    return redactSensitiveText(value);
  }
  if (Array.isArray(value)) return value.map((entry) => redactUnknown(entry, keyHint));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key) || /^(root|path|cwd|file|content|body|token|password)$/i.test(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = redactUnknown(nested, key);
    }
    return out;
  }
  return value;
}

export function diagnoseRuntime(available: boolean, failure?: { code?: string; message?: string } | null): RuntimeDiagnosis {
  if (available && !failure) return 'ok';
  if (!available) {
    const code = failure?.code ?? '';
    // Resolution misses are "missing"; other errors are distinguishable failures.
    if (!failure || code === 'ENOENT' || code === 'MODULE_NOT_FOUND' || /not found|cannot find/i.test(failure.message ?? '')) {
      return 'missing';
    }
    return 'failed';
  }
  return failure ? 'failed' : 'ok';
}

export function runtimeGuidance(diagnosis: RuntimeDiagnosis): RuntimeGuidance {
  switch (diagnosis) {
    case 'ok':
      return {
        diagnosis,
        title: 'Managed runtime',
        detail: 'The managed HQ runtime is available.',
        retryAvailable: false,
        repairAvailable: false,
      };
    case 'missing':
      return {
        diagnosis,
        title: 'Managed runtime missing',
        detail: 'The managed runtime is not installed on this computer. Repair restores owned tools only and leaves your workspace files unchanged.',
        retryAvailable: true,
        repairAvailable: true,
      };
    case 'failed':
      return {
        diagnosis,
        title: 'Managed runtime failed',
        detail: 'The managed runtime failed a check. This is different from a missing install. Retry the check, or Repair to restore owned tools without changing your workspace files.',
        retryAvailable: true,
        repairAvailable: true,
      };
  }
}

/** Build an allowlisted report. Paths, tokens, account identity, and file contents stay out. */
export function buildDiagnosticsReport(input: DiagnosticsReportInput, now = () => new Date()): DiagnosticsReport {
  const report: DiagnosticsReport = {
    generatedAt: now().toISOString(),
    app: 'hq-desktop-os',
    version: input.version,
    platform: input.platform,
    workspaceCount: input.workspaceCount,
    workspaceEnvironments: [...input.workspaceEnvironments],
    runtime: { ...input.runtime },
    sync: {
      phase: input.sync.phase,
      lastSuccess: input.sync.lastSuccess,
      conflicts: input.sync.conflicts,
      transport: input.sync.transport,
      pass: input.sync.pass,
      pendingCount: input.sync.pendingCount,
      message: redactSensitiveText(input.sync.message),
    },
    checks: input.checks.map((check) => ({
      name: check.name,
      state: check.state,
      detail: redactSensitiveText(check.detail),
    })),
    health: {
      overall: input.health.overall,
      lastCheckedAt: input.health.lastCheckedAt,
      reportingEnabled: input.health.reportingEnabled,
      clientName: 'hq-desktop-os',
      checks: input.health.checks.map((check) => ({
        id: check.id,
        label: check.label,
        status: check.status,
        detail: redactSensitiveText(check.detail),
      })),
    },
  };
  return redactUnknown(report) as DiagnosticsReport;
}

/** Redacted JSON preview shown before the user chooses a save location. */
export function formatDiagnosticsPreview(report: DiagnosticsReport, extras?: Record<string, unknown>): string {
  const payload = extras ? redactUnknown({ ...report, ...extras }) : report;
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function assertReportRedacted(text: string, markers: string[]): void {
  for (const marker of markers) {
    if (marker && text.includes(marker)) {
      throw new Error(`Diagnostics export leaked sensitive marker: ${marker.slice(0, 24)}`);
    }
  }
}

/**
 * Narrowly scoped repair: recreate the owned userData toolchain only.
 * Never mutates workspace roots. Destructive or unsupported repairs stay manual.
 */
export async function repairOwnedRuntime(options: {
  toolchainDirectory: string;
  workspaceRoots: string[];
  signal?: AbortSignal;
  /** Injected for tests — default downloads/verifies the managed toolchain. */
  prepare?: (directory: string, signal: AbortSignal, progress: (label: string) => void) => Promise<string>;
  platform?: NodeJS.Platform;
}): Promise<RepairOutcome> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'linux') {
    return {
      status: 'unsupported',
      guidance: 'Automatic runtime repair is not available on this computer yet. Your workspace files were not changed.',
    };
  }

  const before = await snapshotWorkspaceRoots(options.workspaceRoots);
  const signal = options.signal ?? new AbortController().signal;
  const prepare = options.prepare ?? prepareDependencies;
  try {
    await mkdir(options.toolchainDirectory, { recursive: true, mode: 0o700 });
    await prepare(options.toolchainDirectory, signal, () => undefined);
    const marker = join(options.toolchainDirectory, '.hq-runtime-repaired');
    await writeFile(marker, new Date().toISOString(), { mode: 0o600 });
    await assertWorkspaceUnchanged(options.workspaceRoots, before);
    return {
      status: 'ready',
      guidance: 'Owned runtime tools were restored. Your workspace files were not changed.',
      toolchainMarker: marker,
    };
  } catch (error) {
    await assertWorkspaceUnchanged(options.workspaceRoots, before).catch(() => undefined);
    const message = error instanceof Error ? redactSensitiveText(error.message) : 'Repair did not finish.';
    return {
      status: 'error',
      guidance: `${message} Your workspace files were not changed.`,
    };
  }
}

async function snapshotWorkspaceRoots(roots: string[]): Promise<Map<string, string>> {
  const snap = new Map<string, string>();
  for (const root of roots) {
    snap.set(root, await fingerprintTree(root));
  }
  return snap;
}

async function assertWorkspaceUnchanged(roots: string[], before: Map<string, string>): Promise<void> {
  for (const root of roots) {
    const prior = before.get(root) ?? '';
    const next = await fingerprintTree(root);
    if (prior !== next) {
      throw new Error('Repair refused to continue because workspace content changed unexpectedly.');
    }
  }
}

async function fingerprintTree(root: string): Promise<string> {
  try {
    await access(root);
  } catch {
    return 'missing';
  }
  const entries: string[] = [];
  async function walk(dir: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    names.sort();
    for (const name of names) {
      const full = join(dir, name);
      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) await walk(full);
      else if (info.isFile()) {
        const body = await readFile(full);
        entries.push(`${full}:${info.size}:${body.length}`);
      }
    }
  }
  await walk(root);
  return entries.join('|');
}

/** Compose the Settings diagnostics rows without embedding tokens or absolute roots. */
export function buildDiagnosticsChecks(input: {
  workspaceCount: number;
  workspaceEnvironment: WorkspaceEnvironment | null;
  runtimeAvailable: boolean;
  runtimeDiagnosis: RuntimeDiagnosis;
  runtimeVersion: string;
  nodeVersion: string;
  credentialsAvailable: boolean;
  signedIn: boolean;
  sync: SyncStatus;
  healthOverall: CompanionHealth['overall'];
  healthReportingEnabled: boolean;
}): DiagnosticsCheck[] {
  const guidance = runtimeGuidance(input.runtimeDiagnosis);
  const envDetail = input.workspaceEnvironment
    ? `Active environment: ${input.workspaceEnvironment}.`
    : 'No workspace selected.';
  const syncDetail = input.signedIn
    ? redactSensitiveText(
      [
        input.sync.message,
        input.sync.lastSuccess ? `Last confirmed sync ${input.sync.lastSuccess}` : 'No confirmed sync yet',
        input.sync.conflicts ? `${input.sync.conflicts} conflict${input.sync.conflicts === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' · '),
    )
    : 'Sign in to sync your files.';

  return [
    {
      name: 'App version',
      state: 'ok',
      detail: `HQ Desktop OS`,
    },
    {
      name: 'Workspace environment',
      state: input.workspaceCount ? 'ok' : 'attention',
      detail: `${input.workspaceCount} registered workspace${input.workspaceCount === 1 ? '' : 's'}. ${envDetail}`,
    },
    {
      name: 'Bundled runtime',
      state: input.runtimeDiagnosis === 'ok' ? 'ok' : input.runtimeDiagnosis === 'missing' ? 'unavailable' : 'attention',
      detail: `${guidance.detail} HQ Cloud ${input.runtimeVersion} · Node ${input.nodeVersion}`,
    },
    {
      name: 'Credential storage',
      state: input.credentialsAvailable ? 'ok' : 'attention',
      detail: input.credentialsAvailable
        ? 'OS encrypted storage is available.'
        : 'OS encrypted storage is unavailable. Sign-in stays disabled.',
    },
    {
      name: 'Account',
      state: input.signedIn ? 'ok' : 'attention',
      detail: input.signedIn ? 'Account verified.' : 'Not signed in.',
    },
    {
      name: 'Sync',
      state: !input.signedIn ? 'attention' : input.sync.phase === 'error' || input.sync.conflicts > 0 ? 'attention' : input.sync.phase === 'idle' || input.sync.phase === 'syncing' || input.sync.phase === 'paused' ? 'ok' : 'attention',
      detail: syncDetail,
    },
    {
      name: 'Updates',
      state: 'unavailable',
      detail: 'Local test build. Automatic updates and release signing are not configured.',
    },
    {
      name: 'Client health',
      state: input.healthOverall === 'healthy' ? 'ok' : input.healthOverall === 'degraded' || input.healthOverall === 'retry' ? 'attention' : 'unavailable',
      detail: input.healthReportingEnabled
        ? 'Reporting enabled.'
        : 'Local checks only. Server attribution and support commands are not enabled.',
    },
  ];
}
