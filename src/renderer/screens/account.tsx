import { ArrowUpRight, UserRound } from 'lucide-react';
import type { CompanionAction, CompanionSnapshot } from '../../shared/companion';
import { Button } from '../components/ui/button';

export function AccountScreen(props: {
  state: CompanionSnapshot;
  enabled: boolean;
  connected: boolean;
  run: (action: CompanionAction, label: string) => void;
  /** Compact row used on the Workspace screen; settings uses the denser layout. */
  layout?: 'row' | 'settings';
}) {
  const { state, enabled, connected, run, layout = 'row' } = props;
  const title = connected ? state.account.label ?? 'Your account' : 'Connect your account';
  const detail = connected
    ? layout === 'settings'
      ? state.account.label
      : 'You’re signed in to HQ.'
    : layout === 'settings'
      ? 'You’re not signed in on this computer.'
      : 'Sign in to bring your shared work to this computer.';
  const label = connected ? 'Sign out' : 'Sign in';
  const pending = connected ? 'Signing out' : 'Opening sign-in';

  if (layout === 'settings') {
    return (
      <section className="setting-row" data-testid="account-screen">
        <div>
          <h2>Your account</h2>
          <p>{detail}</p>
          {!state.credentials.available && (
            <p role="status" className="muted">
              OS encrypted storage is unavailable ({state.credentials.backend}). Persistent sign-in stays disabled until a secure keyring is available.
            </p>
          )}
        </div>
        <Button
          variant="outline"
          disabled={!enabled || (!connected && !state.credentials.available)}
          onClick={() => void run({ action: connected ? 'sign-out' : 'sign-in' }, pending)}
        >
          {label}
        </Button>
      </section>
    );
  }

  return (
    <section className="account-row" data-testid="account-screen">
      <UserRound size={23} />
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
        {!state.credentials.available && (
          <p role="status" className="muted">
            Unlock your computer’s secure password storage to keep a signed-in session.
          </p>
        )}
      </div>
      <Button
        variant="outline"
        disabled={!enabled || (!connected && !state.credentials.available)}
        onClick={() => void run({ action: connected ? 'sign-out' : 'sign-in' }, pending)}
      >
        {label}
        {!connected && <ArrowUpRight size={15} />}
      </Button>
    </section>
  );
}
