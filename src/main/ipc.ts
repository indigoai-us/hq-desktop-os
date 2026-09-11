import {
  BrowserWindow,
  app,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  IPC_CHANNELS,
  PLATFORM_BRIDGE_VERSION,
  failNotImplemented,
  failUnavailable,
  isReviewedHttpsLink,
  parseOpenExternalPayload,
  type PlatformInfo,
  type PlatformResult,
} from '../shared/platform.js';
import { isTrustedIpcSender, type IpcSenderSnapshot } from './ipc-guard.js';

export type { IpcSenderSnapshot } from './ipc-guard.js';
export { isTrustedIpcSender } from './ipc-guard.js';

export function snapshotIpcSender(event: IpcMainInvokeEvent): IpcSenderSnapshot {
  const frame = event.senderFrame;
  return {
    senderDestroyed: event.sender.isDestroyed(),
    frameUrl: frame?.url ?? null,
    isMainFrame: frame != null && frame === event.sender.mainFrame,
  };
}

function rejectUntrusted(): PlatformResult<never> {
  return {
    ok: false,
    error: {
      code: 'untrusted_sender',
      message: 'IPC sender is not the application renderer.',
    },
  };
}

function rejectInvalidPayload(message: string): PlatformResult<never> {
  return {
    ok: false,
    error: { code: 'invalid_payload', message },
  };
}

function windowForEvent(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function hostPlatform(): PlatformInfo['platform'] {
  if (process.platform === 'win32' || process.platform === 'linux' || process.platform === 'darwin') {
    return process.platform;
  }
  return 'unknown';
}

export async function openReviewedExternal(rawUrl: unknown): Promise<PlatformResult<void>> {
  if (typeof rawUrl !== 'string' || !isReviewedHttpsLink(rawUrl)) {
    return {
      ok: false,
      error: {
        code: 'rejected_link',
        message: 'Only reviewed HTTPS links may be opened.',
      },
    };
  }
  try {
    await shell.openExternal(rawUrl);
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to open external link.';
    return failUnavailable(message);
  }
}

type Handler = (
  event: IpcMainInvokeEvent,
  payload: unknown,
) => Promise<PlatformResult<unknown>> | PlatformResult<unknown>;

export function registerPlatformIpc(rendererUrl: string): void {
  const guard = (handler: Handler) => {
    return async (
      event: IpcMainInvokeEvent,
      payload: unknown,
    ): Promise<PlatformResult<unknown>> => {
      if (!isTrustedIpcSender(snapshotIpcSender(event), rendererUrl)) {
        return rejectUntrusted();
      }
      return handler(event, payload);
    };
  };

  const handlers: Record<string, Handler> = {
    [IPC_CHANNELS.getInfo]: async (): Promise<PlatformResult<PlatformInfo>> => ({
      ok: true,
      value: {
        bridgeVersion: PLATFORM_BRIDGE_VERSION,
        platform: hostPlatform(),
        electron: true,
      },
    }),

    [IPC_CHANNELS.windowMinimize]: async (event) => {
      const window = windowForEvent(event);
      if (!window) {
        return { ok: false, error: { code: 'window_missing', message: 'No BrowserWindow for sender.' } };
      }
      window.minimize();
      return { ok: true, value: undefined };
    },

    [IPC_CHANNELS.windowMaximizeToggle]: async (event) => {
      const window = windowForEvent(event);
      if (!window) {
        return { ok: false, error: { code: 'window_missing', message: 'No BrowserWindow for sender.' } };
      }
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
      return { ok: true, value: undefined };
    },

    [IPC_CHANNELS.windowClose]: async (event) => {
      const window = windowForEvent(event);
      if (!window) {
        return { ok: false, error: { code: 'window_missing', message: 'No BrowserWindow for sender.' } };
      }
      window.close();
      return { ok: true, value: undefined };
    },

    [IPC_CHANNELS.appRelaunch]: async () => {
      app.relaunch();
      app.exit(0);
      return { ok: true, value: undefined };
    },

    [IPC_CHANNELS.appQuit]: async () => {
      app.quit();
      return { ok: true, value: undefined };
    },

    [IPC_CHANNELS.openExternal]: async (_event, payload) => {
      const parsed = parseOpenExternalPayload(payload);
      if (!parsed) return rejectInvalidPayload('openExternal requires { url: string }.');
      return openReviewedExternal(parsed.url);
    },

    [IPC_CHANNELS.filesystemSelectDirectory]: async () =>
      failNotImplemented('Filesystem selection'),

    [IPC_CHANNELS.credentialsGetStatus]: async () =>
      failNotImplemented('Credential access'),

    [IPC_CHANNELS.processListManaged]: async () =>
      failNotImplemented('Managed process listing'),

    [IPC_CHANNELS.updaterGetStatus]: async () =>
      failNotImplemented('Updater status'),
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, guard(handler));
  }
}
