import { ArrowUpRight } from 'lucide-react';
import type { CompanionAction, CompanionSnapshot } from '../../shared/companion';
import { Button } from './ui/button';

export function CompanyPicker(props: {
  state: CompanionSnapshot;
  enabled: boolean;
  run: (action: CompanionAction, label: string) => void;
}) {
  const { state, enabled, run } = props;
  const memberships = state.memberships;
  const discoveryFailed = memberships.status === 'error';
  const ready = memberships.status === 'ready' && (state.syncScopes?.length ?? 0) > 0;

  return (
    <div className="sync-choice" data-testid="company-picker">
      {discoveryFailed && (
        <div role="alert" className="notice error" data-testid="memberships-error">
          <p>{memberships.error ?? 'Your shared workspaces could not be loaded.'}</p>
          <Button variant="outline" disabled={!enabled} onClick={() => void run({ action: 'load-sync-scopes' }, 'Finding your shared work')}>
            Try again
          </Button>
        </div>
      )}

      {ready ? (
        <>
          <label htmlFor="sync-workspace">Keep these files on this computer</label>
          <select
            id="sync-workspace"
            className="hq-select"
            value={state.selectedSyncScope ?? ''}
            disabled={!enabled}
            onChange={(event) => void run({ action: 'select-sync-scope', scopeId: event.target.value }, 'Choosing your shared work')}
          >
            <option value="" disabled>
              Choose your work
            </option>
            {state.syncScopes!.map((scope) => (
              <option key={scope.id} value={scope.id}>
                {scope.label}
              </option>
            ))}
          </select>
          {state.selectedSyncScope === 'all' && (
            <p className="muted">Syncs your personal files and every company you belong to, the same way HQ Desktop does.</p>
          )}
        </>
      ) : !discoveryFailed ? (
        <Button variant="outline" disabled={!enabled} onClick={() => void run({ action: 'load-sync-scopes' }, 'Finding your shared work')}>
          Find my shared work
        </Button>
      ) : null}

      <div className="welcome-actions" data-testid="company-web-flows">
        <Button
          variant="ghost"
          disabled={!enabled}
          onClick={() => void run({ action: 'open-hq-web', destination: 'create-company' }, 'Opening company setup')}
        >
          Create a company
          <ArrowUpRight size={15} />
        </Button>
        <Button
          variant="ghost"
          disabled={!enabled}
          onClick={() => void run({ action: 'open-hq-web', destination: 'accept-invite' }, 'Opening invitations')}
        >
          Join with an invite
          <ArrowUpRight size={15} />
        </Button>
        {ready && (
          <Button variant="ghost" disabled={!enabled} onClick={() => void run({ action: 'load-sync-scopes' }, 'Refreshing shared work')}>
            Refresh list
          </Button>
        )}
      </div>
    </div>
  );
}
