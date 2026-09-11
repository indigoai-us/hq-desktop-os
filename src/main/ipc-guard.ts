import { isAllowedNavigation } from './navigation.js';

export interface IpcSenderSnapshot {
  readonly senderDestroyed: boolean;
  readonly frameUrl: string | null;
  readonly isMainFrame: boolean;
}

/** Fail closed unless the invoke originates from the app renderer main frame. */
export function isTrustedIpcSender(
  snapshot: IpcSenderSnapshot,
  rendererUrl: string,
): boolean {
  if (snapshot.senderDestroyed) return false;
  if (!snapshot.isMainFrame) return false;
  if (!snapshot.frameUrl) return false;
  return isAllowedNavigation(snapshot.frameUrl, rendererUrl);
}
