import type { HeartbeatFacts } from './facts.js';
import type { ClientHealthHeartbeat } from './contract.js';
import type { HealthReporter } from './reporter.js';

/** Startup + cadence matching the shared desktop client-health channel. */
export const CLIENT_HEALTH_HEARTBEAT_INTERVAL_MS = 5 * 60_000;
export const CLIENT_HEALTH_DEBOUNCE_MS = 2_000;

export interface HealthHeartbeatSchedulerOptions {
  reporter: HealthReporter;
  /** Fresh facts for each emit — must stay cheap (no full journal scans). */
  facts: () => HeartbeatFacts | Promise<HeartbeatFacts>;
  intervalMs?: number;
  debounceMs?: number;
  /** Test seam — defaults to setInterval / setTimeout. */
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

/**
 * Emits heartbeats on startup, every five minutes, and after debounced health
 * changes. Transport delivery stays gated inside {@link HealthReporter}.
 */
export class HealthHeartbeatScheduler {
  private readonly reporter: HealthReporter;
  private readonly facts: () => HeartbeatFacts | Promise<HeartbeatFacts>;
  private readonly intervalMs: number;
  private readonly debounceMs: number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private intervalTimer?: ReturnType<typeof setInterval>;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private running = false;

  constructor(options: HealthHeartbeatSchedulerOptions) {
    this.reporter = options.reporter;
    this.facts = options.facts;
    this.intervalMs = options.intervalMs ?? CLIENT_HEALTH_HEARTBEAT_INTERVAL_MS;
    this.debounceMs = options.debounceMs ?? CLIENT_HEALTH_DEBOUNCE_MS;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  get active(): boolean {
    return this.running;
  }

  /** Fire one heartbeat immediately, then every intervalMs. Idempotent. */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.emit('startup');
    this.intervalTimer = this.setIntervalFn(() => {
      void this.emit('interval');
    }, this.intervalMs);
    this.intervalTimer.unref?.();
  }

  /** Debounced emit after sync/auth/updater/repair changes. */
  notifyHealthChanged(): void {
    if (!this.running) return;
    if (this.debounceTimer) this.clearTimeoutFn(this.debounceTimer);
    this.debounceTimer = this.setTimeoutFn(() => {
      this.debounceTimer = undefined;
      void this.emit('debounce');
    }, this.debounceMs);
    this.debounceTimer.unref?.();
  }

  stop(): void {
    this.running = false;
    if (this.intervalTimer) {
      this.clearIntervalFn(this.intervalTimer);
      this.intervalTimer = undefined;
    }
    if (this.debounceTimer) {
      this.clearTimeoutFn(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }

  private async emit(reason: 'startup' | 'interval' | 'debounce'): Promise<ClientHealthHeartbeat | null> {
    try {
      const facts = await this.facts();
      return await this.reporter.report(facts);
    } catch (error) {
      console.error(
        `Client-health scheduler ${reason} emit failed (non-blocking):`,
        error instanceof Error ? error.message : 'unknown',
      );
      return null;
    }
  }
}
