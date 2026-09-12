/**
 * Typed platform boundary shared by main, preload, and renderer.
 * Native capabilities stay behind validated IPC; the renderer never touches Node.
 */

export const PLATFORM_BRIDGE_VERSION = '0.1.0' as const;

/** Exact HTTPS targets reviewed for shell.openExternal / window-open. */
export const REVIEWED_HTTPS_LINKS = Object.freeze([
  'https://github.com/indigoai-us/hq-desktop-os',
  'https://github.com/indigoai-us/hq-desktop-os/issues',
  'https://github.com/indigoai-us/hq-desktop-os/blob/main/README.md',
  'https://hq.computer/signup/team',
  'https://hq.computer/onboarding',
] as const);

export type ReviewedHttpsLink = (typeof REVIEWED_HTTPS_LINKS)[number];

export const IPC_CHANNELS = Object.freeze({
  getInfo: 'hq:platform:getInfo',
  companion: 'hq:companion:request',
  windowMinimize: 'hq:platform:windowMinimize',
  windowMaximizeToggle: 'hq:platform:windowMaximizeToggle',
  windowClose: 'hq:platform:windowClose',
  appRelaunch: 'hq:platform:appRelaunch',
  appQuit: 'hq:platform:appQuit',
  openExternal: 'hq:platform:openExternal',
  filesystemSelectDirectory: 'hq:platform:filesystemSelectDirectory',
  credentialsGetStatus: 'hq:platform:credentialsGetStatus',
  processListManaged: 'hq:platform:processListManaged',
  updaterGetStatus: 'hq:platform:updaterGetStatus',
} as const);

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const IPC_CHANNEL_LIST: readonly IpcChannel[] = Object.freeze(
  Object.values(IPC_CHANNELS),
);

export type PlatformAvailability = 'native' | 'unavailable';

export type PlatformErrorCode =
  | 'unavailable'
  | 'invalid_payload'
  | 'untrusted_sender'
  | 'rejected_link'
  | 'not_implemented'
  | 'window_missing';

export interface PlatformError {
  readonly code: PlatformErrorCode;
  readonly message: string;
}

export type PlatformResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PlatformError };

export interface PlatformInfo {
  readonly bridgeVersion: typeof PLATFORM_BRIDGE_VERSION;
  readonly platform: 'win32' | 'linux' | 'darwin' | 'unknown';
  readonly electron: boolean;
}

export interface OpenExternalPayload {
  readonly url: string;
}

/** Preload-exposed bridge: invoke-only, no Node primitives. */
export interface PlatformBridge {
  readonly kind: 'electron';
  readonly version: typeof PLATFORM_BRIDGE_VERSION;
  invoke(channel: IpcChannel, payload?: unknown): Promise<PlatformResult<unknown>>;
}

export interface PlatformClient {
  readonly availability: PlatformAvailability;
  getInfo(): Promise<PlatformResult<PlatformInfo>>;
  windowMinimize(): Promise<PlatformResult<void>>;
  windowMaximizeToggle(): Promise<PlatformResult<void>>;
  windowClose(): Promise<PlatformResult<void>>;
  appRelaunch(): Promise<PlatformResult<void>>;
  appQuit(): Promise<PlatformResult<void>>;
  openExternal(url: string): Promise<PlatformResult<void>>;
  /** Boundaries reserved for later stories; always fail closed for now. */
  filesystemSelectDirectory(): Promise<PlatformResult<never>>;
  credentialsGetStatus(): Promise<PlatformResult<never>>;
  processListManaged(): Promise<PlatformResult<never>>;
  updaterGetStatus(): Promise<PlatformResult<never>>;
}

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && (IPC_CHANNEL_LIST as readonly string[]).includes(value);
}

export function isReviewedHttpsLink(candidate: unknown): candidate is ReviewedHttpsLink {
  if (typeof candidate !== 'string') return false;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    if (url.hash) return false;
    // Exact reviewed href only (pathname + search preserved by URL href normalization).
    const normalized = url.href;
    return (REVIEWED_HTTPS_LINKS as readonly string[]).includes(normalized);
  } catch {
    return false;
  }
}

export function parseOpenExternalPayload(raw: unknown): OpenExternalPayload | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const url = (raw as { url?: unknown }).url;
  if (typeof url !== 'string') return null;
  if (url.length === 0 || url.length > 2048) return null;
  return { url };
}

export function unavailableError(
  message = 'Native platform bridge is unavailable.',
): PlatformError {
  return { code: 'unavailable', message };
}

export function failUnavailable<T = never>(
  message?: string,
): PlatformResult<T> {
  return { ok: false, error: unavailableError(message) };
}

export function failNotImplemented(operation: string): PlatformResult<never> {
  return {
    ok: false,
    error: {
      code: 'not_implemented',
      message: `${operation} is not available in this build.`,
    },
  };
}

export function createUnavailablePlatformClient(
  message = 'Native platform bridge is unavailable.',
): PlatformClient {
  const fail = async <T = never>(): Promise<PlatformResult<T>> => failUnavailable<T>(message);
  return Object.freeze({
    availability: 'unavailable',
    getInfo: fail,
    windowMinimize: fail,
    windowMaximizeToggle: fail,
    windowClose: fail,
    appRelaunch: fail,
    appQuit: fail,
    openExternal: fail,
    filesystemSelectDirectory: fail,
    credentialsGetStatus: fail,
    processListManaged: fail,
    updaterGetStatus: fail,
  });
}

export function createElectronPlatformClient(bridge: PlatformBridge): PlatformClient {
  const invoke = async <T>(
    channel: IpcChannel,
    payload?: unknown,
  ): Promise<PlatformResult<T>> => {
    // A rejected invoke must stay inside the PlatformResult contract. If it
    // escaped, the caller would see an unhandled rejection and the UI would
    // keep whatever it last displayed — which may be a previous success.
    let result: unknown;
    try {
      result = await bridge.invoke(channel, payload);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Platform invoke failed.';
      return failUnavailable<T>(message);
    }
    if (!result || typeof result !== 'object' || !('ok' in result)) {
      return failUnavailable('Malformed platform response.');
    }
    return result as PlatformResult<T>;
  };

  return Object.freeze({
    availability: 'native',
    getInfo: () => invoke<PlatformInfo>(IPC_CHANNELS.getInfo),
    windowMinimize: () => invoke<void>(IPC_CHANNELS.windowMinimize),
    windowMaximizeToggle: () => invoke<void>(IPC_CHANNELS.windowMaximizeToggle),
    windowClose: () => invoke<void>(IPC_CHANNELS.windowClose),
    appRelaunch: () => invoke<void>(IPC_CHANNELS.appRelaunch),
    appQuit: () => invoke<void>(IPC_CHANNELS.appQuit),
    openExternal: (url: string) => invoke<void>(IPC_CHANNELS.openExternal, { url }),
    filesystemSelectDirectory: () =>
      invoke<never>(IPC_CHANNELS.filesystemSelectDirectory),
    credentialsGetStatus: () => invoke<never>(IPC_CHANNELS.credentialsGetStatus),
    processListManaged: () => invoke<never>(IPC_CHANNELS.processListManaged),
    updaterGetStatus: () => invoke<never>(IPC_CHANNELS.updaterGetStatus),
  });
}

/** Resolve the renderer-facing client: native bridge or fail-closed unavailable. */
export function resolvePlatformClient(
  bridge: PlatformBridge | null | undefined,
): PlatformClient {
  if (!bridge || bridge.kind !== 'electron' || typeof bridge.invoke !== 'function') {
    return createUnavailablePlatformClient();
  }
  return createElectronPlatformClient(bridge);
}
