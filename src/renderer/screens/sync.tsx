import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { CompanionAction, CompanionSnapshot, ConflictChoice } from '../../shared/companion';
import { CompanyPicker } from '../components/company-picker';
import { ConflictList } from '../components/conflict-list';
import { SyncDetails, SyncStatusView } from '../components/sync-status';
import { Button } from '../components/ui/button';

function syncActionLabel(phase: CompanionSnapshot['sync']['phase']): string {
  if (['syncing', 'idle', 'offline'].includes(phase)) return 'Pause sync';
  if (phase === 'paused') return 'Start syncing';
  return 'Try sync again';
}

export function SyncScreen(props: {
  state: CompanionSnapshot;
  workspaceName?: string;
  connected: boolean;
  enabled: boolean;
  screenState: string;
  onGoWorkspace: () => void;
  run: (action: CompanionAction, label: string) => void;
}) {
  const { state, workspaceName, connected, enabled, screenState, onGoWorkspace, run } = props;
  const sync = state.sync;
  const scopeLabel = state.syncScopes?.find((scope) => scope.id === state.selectedSyncScope)?.label ?? 'Not selected';
  const showConflicts = !!workspaceName && connected && (sync.phase === 'conflict' || sync.conflicts > 0);
  const showControls = !!workspaceName && connected && sync.phase !== 'conflict';

  return (
    <div data-screen="Sync" data-screen-state={screenState} data-testid="screen-sync">
      <header className="page-heading">
        <h1>Sync</h1>
        <p className="lead">Your latest work, wherever you need it.</p>
      </header>

      <SyncStatusView sync={sync} workspaceName={workspaceName} connected={connected}>
        {workspaceName && connected && (
          <CompanyPicker state={state} enabled={enabled} run={run} />
        )}

        {showConflicts && (
          <ConflictList
            paths={sync.conflictPaths}
            disabled={!enabled}
            onResolve={(choice: ConflictChoice) =>
              void run(
                { action: 'resolve-conflicts', choice },
                choice === 'abort' ? 'Pausing sync' : 'Applying your choice',
              )}
          />
        )}

        <div className="welcome-actions">
          {!workspaceName ? (
            <Button onClick={onGoWorkspace}>
              Go to workspace
              <ArrowRight size={16} />
            </Button>
          ) : !connected || sync.phase === 'not-connected' ? (
            <Button disabled={!enabled} onClick={() => void run({ action: 'sign-in' }, 'Opening sign-in')}>
              Sign in
              <ArrowUpRight size={15} />
            </Button>
          ) : showControls ? (
            <Button
              disabled={!enabled || !state.selectedSyncScope}
              data-testid="sync-lifecycle"
              onClick={() =>
                void run(
                  {
                    action: ['syncing', 'idle', 'offline'].includes(sync.phase) ? 'pause-sync' : 'resume-sync',
                  },
                  'Updating sync',
                )}
            >
              {syncActionLabel(sync.phase)}
            </Button>
          ) : null}
        </div>

        <SyncDetails sync={sync} workspaceName={workspaceName} scopeLabel={scopeLabel} />
      </SyncStatusView>
    </div>
  );
}
