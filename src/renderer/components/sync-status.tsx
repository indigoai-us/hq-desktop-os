import type { ReactNode } from 'react';
import { Cloud } from 'lucide-react';
import type { SyncStatus as SyncStatusModel } from '../../shared/sync';

function transportLabel(sync: SyncStatusModel): string | null {
  if (sync.phase === 'paused' || sync.phase === 'not-connected') return null;
  if (sync.transport === 'realtime') return 'Connected · live updates';
  if (sync.transport === 'polling') return 'Connected · checking periodically';
  if (sync.transport === 'offline' || sync.phase === 'offline') return 'Offline';
  if (sync.pass === 'reconciling') return 'Initial reconciliation';
  if (sync.pass === 'pending') {
    return sync.pendingCount === 1 ? '1 pending change' : `${sync.pendingCount} pending changes`;
  }
  if (sync.pass === 'transferring') return 'Applying changes';
  return null;
}

function headline(input: {
  sync: SyncStatusModel;
  workspaceName?: string;
  connected: boolean;
}): string {
  const { sync, workspaceName, connected } = input;
  if (!workspaceName) return 'Choose a workspace to get started';
  if (!connected || sync.phase === 'not-connected') return 'Bring your work together';
  return sync.message;
}

function lead(input: {
  sync: SyncStatusModel;
  workspaceName?: string;
  connected: boolean;
}): string {
  const { sync, workspaceName, connected } = input;
  if (!workspaceName) return 'Set up HQ or choose your existing folder first.';
  if (!connected || sync.phase === 'not-connected') {
    return 'Sign in to keep your files up to date across your devices.';
  }
  // Receiver connectivity alone never means sync finished — require lastSuccess.
  if (sync.phase === 'idle' && !sync.lastSuccess) {
    return 'Connected to HQ, waiting for the first confirmed sync.';
  }
  if (sync.phase === 'syncing' && sync.pass === 'reconciling') {
    return 'Comparing this computer with HQ before transferring files.';
  }
  if (sync.phase === 'syncing' && sync.pass === 'pending') {
    return 'Pending changes are queued from the latest sync plan.';
  }
  if (sync.transport === 'polling') {
    return 'Live updates are unavailable, so HQ is checking periodically instead.';
  }
  if (sync.transport === 'realtime' && sync.phase === 'idle') {
    return 'Live updates are on. Your files stay on this computer, even when you’re offline.';
  }
  return 'Your files stay on this computer, even when you’re offline.';
}

export function SyncStatusView(props: {
  sync: SyncStatusModel;
  workspaceName?: string;
  connected: boolean;
  children?: ReactNode;
}) {
  const { sync, workspaceName, connected, children } = props;
  const link = transportLabel(sync);
  return (
    <section className="status-view" data-testid="sync-status" data-sync-phase={sync.phase} data-sync-transport={sync.transport ?? ''} data-sync-pass={sync.pass ?? ''}>
      <div className="status-orb" aria-hidden="true">
        <Cloud size={30} strokeWidth={1.5} />
      </div>
      <h2 data-testid="sync-headline">{headline({ sync, workspaceName, connected })}</h2>
      <p className="lead" data-testid="sync-lead">{lead({ sync, workspaceName, connected })}</p>
      {link && (
        <p className="muted" role="status" data-testid="sync-transport">
          {link}
        </p>
      )}
      {children}
    </section>
  );
}

export function SyncDetails(props: {
  sync: SyncStatusModel;
  workspaceName?: string;
  scopeLabel: string;
}) {
  const { sync, workspaceName, scopeLabel } = props;
  return (
    <dl className="sync-details">
      <div>
        <dt>Workspace</dt>
        <dd>{workspaceName ?? 'Not selected'}</dd>
      </div>
      <div>
        <dt>Syncing</dt>
        <dd>{scopeLabel}</dd>
      </div>
      <div>
        <dt>Last confirmed sync</dt>
        <dd data-testid="sync-last-success">
          {sync.lastSuccess ? new Date(sync.lastSuccess).toLocaleString() : 'Not yet'}
        </dd>
      </div>
      {sync.pendingCount > 0 && (
        <div>
          <dt>Pending changes</dt>
          <dd data-testid="sync-pending-count">
            {sync.pendingCount === 1 ? '1 file' : `${sync.pendingCount} files`}
          </dd>
        </div>
      )}
      {sync.phase === 'error' && (
        <div>
          <dt>Status</dt>
          <dd data-testid="sync-error">Needs attention</dd>
        </div>
      )}
      {sync.conflicts > 0 && (
        <div>
          <dt>Needs a choice</dt>
          <dd>{sync.conflicts === 1 ? '1 file' : `${sync.conflicts} files`}</dd>
        </div>
      )}
    </dl>
  );
}
