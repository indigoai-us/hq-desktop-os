import { IPC_CHANNELS, type PlatformResult } from '../shared/platform';
import type { CompanionAction, CompanionSnapshot } from '../shared/companion';
import { isDevCompanionPath } from './dev/preview-path';

export interface CompanionClient {
  simulated: boolean;
  request(action: CompanionAction): Promise<CompanionSnapshot>;
}

/**
 * Production builds compile `import.meta.env.DEV` to false, so the dynamic
 * preview import is dropped from the shipped graph. URL query, hash, and
 * browser storage keys never unlock the simulated adapter — only the
 * development `/dev/companion` path under a Vite DEV server does.
 */
export async function createCompanionClient(): Promise<CompanionClient> {
  if (import.meta.env.DEV && isDevCompanionPath(window.location.pathname)) {
    const { createPreviewClient } = await import('./dev/companion-preview');
    return createPreviewClient();
  }
  return {
    simulated: false,
    async request(action) {
      if (!window.hqDesktop) throw new Error('Open HQ on your computer to get started.');
      const result = (await window.hqDesktop.invoke(
        IPC_CHANNELS.companion,
        action,
      )) as PlatformResult<CompanionSnapshot>;
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  };
}
