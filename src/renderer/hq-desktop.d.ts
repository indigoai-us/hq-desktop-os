import type { PlatformBridge } from '../shared/platform';

declare global {
  interface Window {
    /** Present only when the Electron preload bridge loaded. */
    hqDesktop?: PlatformBridge;
  }
}

export {};
