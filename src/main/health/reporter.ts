import {
  CLIENT_HEALTH_ATTRIBUTION_HEADER,
  CLIENT_HEALTH_CLIENT_NAME,
  CLIENT_HEALTH_CONTRACT_VERSION,
  healthArchFromNode,
  healthPlatformFromNode,
  parseClientHealthHeartbeat,
  type ClientHealthFailureReason,
  type ClientHealthHeartbeat,
  type ClientHealthSyncState,
  type ClientHealthUpdaterState,
  type ClientHealthVersions,
} from './contract.js';
import type { HealthStateStore } from './state.js';

const SEMVER_LOOSE =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export interface HeartbeatFacts {
  versions: ClientHealthVersions;
  syncState: ClientHealthSyncState;
  lastSyncAttemptAt?: string;
  lastSyncSuccessAt?: string;
  syncEngineWatermarkAt?: string;
  consecutiveFailures: number;
  conflictCount?: number;
  updaterState?: ClientHealthUpdaterState;
  failureReason?: ClientHealthFailureReason;
}

export interface HealthTransport {
  /** Send an authenticated heartbeat. Must never throw into setup/sync callers. */
  sendHeartbeat(payload: ClientHealthHeartbeat, headers: Record<string, string>): Promise<void>;
}

/** Default transport: no network. Production send requires explicit opt-in + auth. */
export class DisabledHealthTransport implements HealthTransport {
  async sendHeartbeat(): Promise<void> {
    /* intentionally no-op — live reporting is gated off until release evidence */
  }
}

export interface HealthReporterOptions {
  state: HealthStateStore;
  transport?: HealthTransport;
  /** When false (default), build payloads but do not call transport. */
  reportingEnabled?: boolean;
  /** Required with reportingEnabled for any live send. */
  authToken?: string | null;
  platform?: NodeJS.Platform;
  arch?: string;
  appVersion?: string;
  now?: () => Date;
}

/**
 * Builds bounded heartbeats and optionally delivers them.
 * Transport failures are swallowed so setup/sync never block.
 */
export class HealthReporter {
  private readonly state: HealthStateStore;
  private readonly transport: HealthTransport;
  private reportingEnabled: boolean;
  private authToken: string | null;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly appVersion: string;
  private readonly now: () => Date;
  private lastFacts?: HeartbeatFacts;
  private debounceTimer?: ReturnType<typeof setTimeout>;

  constructor(options: HealthReporterOptions) {
    this.state = options.state;
    this.transport = options.transport ?? new DisabledHealthTransport();
    this.reportingEnabled = options.reportingEnabled === true;
    this.authToken = options.authToken ?? null;
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.appVersion = options.appVersion ?? '0.0.0';
    this.now = options.now ?? (() => new Date());
  }

  setReportingEnabled(enabled: boolean, authToken?: string | null): void {
    this.reportingEnabled = enabled;
    if (authToken !== undefined) this.authToken = authToken;
  }

  /** Build a validated heartbeat without sending. Advances the persisted sequence. */
  async buildHeartbeat(facts: HeartbeatFacts): Promise<ClientHealthHeartbeat> {
    this.lastFacts = facts;
    const sequence = await this.state.nextSequence();
    const snapshot = this.state.snapshot;
    const desktopVersion = SEMVER_LOOSE.test(this.appVersion) ? this.appVersion : undefined;
    const payload: ClientHealthHeartbeat = {
      contractVersion: CLIENT_HEALTH_CONTRACT_VERSION,
      installationId: snapshot.installationId,
      source: 'desktop',
      platform: healthPlatformFromNode(this.platform),
      arch: healthArchFromNode(this.arch),
      sentAt: this.now().toISOString(),
      sequence,
      versions: { ...(desktopVersion ? { desktop: desktopVersion } : {}), ...facts.versions },
      syncState: facts.syncState,
      consecutiveFailures: facts.consecutiveFailures,
    };
    if (facts.lastSyncAttemptAt) payload.lastSyncAttemptAt = facts.lastSyncAttemptAt;
    if (facts.lastSyncSuccessAt) payload.lastSyncSuccessAt = facts.lastSyncSuccessAt;
    if (facts.syncEngineWatermarkAt) payload.syncEngineWatermarkAt = facts.syncEngineWatermarkAt;
    if (facts.conflictCount !== undefined) payload.conflictCount = facts.conflictCount;
    if (facts.updaterState !== undefined) payload.updaterState = facts.updaterState;
    if (facts.failureReason !== undefined) payload.failureReason = facts.failureReason;
    return parseClientHealthHeartbeat(payload);
  }

  /**
   * Build + optionally deliver. Never throws to the caller for transport errors.
   * Returns the built heartbeat, or null if construction failed.
   */
  async report(facts: HeartbeatFacts): Promise<ClientHealthHeartbeat | null> {
    let heartbeat: ClientHealthHeartbeat;
    try {
      heartbeat = await this.buildHeartbeat(facts);
    } catch (error) {
      console.error('Client-health heartbeat could not be built:', error instanceof Error ? error.message : 'unknown');
      return null;
    }
    if (!this.reportingEnabled || !this.authToken) return heartbeat;
    try {
      await this.transport.sendHeartbeat(heartbeat, {
        Authorization: `Bearer ${this.authToken}`,
        [CLIENT_HEALTH_ATTRIBUTION_HEADER]: CLIENT_HEALTH_CLIENT_NAME,
        'User-Agent': `${CLIENT_HEALTH_CLIENT_NAME}/${this.appVersion}`,
      });
    } catch (error) {
      console.error('Client-health transport failed (non-blocking):', error instanceof Error ? error.message : 'unknown');
    }
    return heartbeat;
  }

  /** Debounced health-change report (default 2s). Never blocks the caller. */
  reportDebounced(facts: HeartbeatFacts, delayMs = 2_000): void {
    this.lastFacts = facts;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      if (this.lastFacts) void this.report(this.lastFacts);
    }, delayMs);
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
  }
}
