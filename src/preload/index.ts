import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNEL_LIST,
  PLATFORM_BRIDGE_VERSION,
  isIpcChannel,
  type IpcChannel,
  type PlatformBridge,
  type PlatformResult,
} from '../shared/platform.js';

const allowed = new Set<string>(IPC_CHANNEL_LIST);

async function invoke(
  channel: IpcChannel,
  payload?: unknown,
): Promise<PlatformResult<unknown>> {
  if (!allowed.has(channel) || !isIpcChannel(channel)) {
    return {
      ok: false,
      error: {
        code: 'invalid_payload',
        message: 'IPC channel is not part of the platform boundary.',
      },
    };
  }
  return ipcRenderer.invoke(channel, payload) as Promise<PlatformResult<unknown>>;
}

const bridge: PlatformBridge = Object.freeze({
  kind: 'electron',
  version: PLATFORM_BRIDGE_VERSION,
  invoke,
});

contextBridge.exposeInMainWorld('hqDesktop', bridge);
