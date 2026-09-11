import { IPC_CHANNELS, type PlatformResult } from '../shared/platform';
import type { CompanionAction, CompanionSnapshot } from '../shared/companion';
export interface CompanionClient {
  simulated: boolean;
  request(action: CompanionAction): Promise<CompanionSnapshot>;
}
export async function createCompanionClient(): Promise<CompanionClient> {
  if (import.meta.env.DEV && window.location.pathname === '/dev/companion') {
    const { createPreviewClient } = await import('./dev/companion-preview');
    return createPreviewClient();
  }
  return {
    simulated: false,
    async request(action) {
      if (!window.hqDesktop) throw new Error('Native platform unavailable. Open the installed desktop app to manage a workspace.');
      const result = await window.hqDesktop.invoke(IPC_CHANNELS.companion, action) as PlatformResult<CompanionSnapshot>;
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  };
}
