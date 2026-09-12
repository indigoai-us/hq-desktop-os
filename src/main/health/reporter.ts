import {
  CLIENT_HEALTH_CONTRACT_VERSION,
  healthArchFromNode,
  healthPlatformFromNode,
  parseClientHealthHeartbeat,
  type ClientHealthHeartbeat,
} from './contract.js';
import type { HeartbeatFacts } from './facts.js';
import type { HealthStateStore } from './state.js';
import {
  clientHealthAttributionHeaders,
  DisabledHealthTransport,
  type HealthTransport,
} from './transport.js';

const SEMVER_LOOSE =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

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

  get isReportingEnabled(): boolean {
    return this.reportingEnabled && !!this.authToken;
  }

  setReportingEnabled(enabled: boolean, authToken?: string | null): void {
    this.reportingEnabled = enabled;
    if (authToken !== undefined) this.authToken = authToken;
  }

  /** Build a validated heartbeat without sending. Advances the persisted sequence. */
  async buildHeartbeat(facts: HeartbeatFacts): Promise<ClientHealthHeartbeat> {
    this.lastFacts = facts;
    const now = this.now();
    const sequence = await this.state.nextSequence(now.getTime());
    const snapshot = this.state.snapshot;
    const desktopVersion = SEMVER_LOOSE.test(this.appVersion) ? this.appVersion : undefined;
    const payload: ClientHealthHeartbeat = {
      contractVersion: CLIENT_HEALTH_CONTRACT_VERSION,
      installationId: snapshot.installationId,
      source: 'desktop',
      platform: healthPlatformFromNode(this.platform),
      arch: healthArchFromNode(this.arch),
      sentAt: now.toISOString(),
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
    if (facts.localFilesOverview) payload.localFilesOverview = facts.localFilesOverview;
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
      await this.transport.sendHeartbeat(
        heartbeat,
        clientHealthAttributionHeaders(this.appVersion, this.authToken),
      );
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
    this.debounceTimer.unref?.();
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
  }
}
