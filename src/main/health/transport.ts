import {
  CLIENT_HEALTH_ATTRIBUTION_HEADER,
  CLIENT_HEALTH_CLIENT_NAME,
  type ClientHealthHeartbeat,
} from './contract.js';

/** Default production gate — live POSTs require explicit opt-in. */
export function isClientHealthReportingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.HQ_CLIENT_HEALTH_REPORTING === '1';
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

export interface HttpHealthTransportOptions {
  /** Vault API origin, e.g. https://hqapi.hq.computer */
  baseUrl: string;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Authenticated POST to `/v1/client-health/heartbeat`.
 * Only constructed when reporting is explicitly enabled; still requires a bearer.
 */
export class HttpHealthTransport implements HealthTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpHealthTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async sendHeartbeat(payload: ClientHealthHeartbeat, headers: Record<string, string>): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/client-health/heartbeat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...headers,
        [CLIENT_HEALTH_ATTRIBUTION_HEADER]: CLIENT_HEALTH_CLIENT_NAME,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`client-health heartbeat HTTP ${response.status}`);
    }
  }
}

/** Attribution headers shared by any live transport. */
export function clientHealthAttributionHeaders(appVersion: string, authToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${authToken}`,
    [CLIENT_HEALTH_ATTRIBUTION_HEADER]: CLIENT_HEALTH_CLIENT_NAME,
    'User-Agent': `${CLIENT_HEALTH_CLIENT_NAME}/${appVersion}`,
  };
}
