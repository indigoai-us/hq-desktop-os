import { FileDown } from 'lucide-react';
import type { CompanionAction, CompanionSnapshot } from '../../shared/companion';
import type { CompanionHealth } from '../../shared/health';
import { ThemeControl } from '../theme';
import { HealthChecks } from '../components/health-checks';
import { Button } from '../components/ui/button';
import { AccountScreen } from './account';

export function SettingsScreen(props: {
  state: CompanionSnapshot;
  health: CompanionHealth;
  enabled: boolean;
  connected: boolean;
  run: (action: CompanionAction, label: string) => void;
}) {
  const { state, health, enabled, connected, run } = props;
  return (
    <>
      <header className="page-heading">
        <h1>Settings</h1>
        <p className="lead">Make HQ feel at home.</p>
      </header>
      <section className="content-section"><ThemeControl /></section>
      <AccountScreen state={state} enabled={enabled} connected={connected} run={run} layout="settings" />
      <section className="setting-row">
        <div>
          <h2>Keep HQ running</h2>
          <p>Continue syncing after you close this window.</p>
        </div>
        <input
          type="checkbox"
          aria-label="Keep HQ running"
          checked={state.preferences.closeToTray}
          disabled={!enabled}
          onChange={(event) => void run({ action: 'set-preference', preference: 'closeToTray', enabled: event.target.checked }, 'Saving your preference')}
        />
      </section>
      <section className="setting-row">
        <div>
          <h2>Open HQ when I sign in</h2>
          <p>Start HQ when you sign in to this computer.</p>
        </div>
        <input
          type="checkbox"
          aria-label="Open HQ when I sign in"
          checked={state.preferences.launchAtLogin}
          disabled={!enabled}
          onChange={(event) => void run({ action: 'set-preference', preference: 'launchAtLogin', enabled: event.target.checked }, 'Saving your preference')}
        />
      </section>
      <HealthChecks
        health={health}
        disabled={!enabled}
        onRunChecks={() => void run({ action: 'diagnostics' }, 'Running health checks')}
      />
      <section className="setting-row">
        <div>
          <h2>Need a hand?</h2>
          <p>Save a private report to share when asking for help.</p>
        </div>
        <Button variant="ghost" disabled={!enabled} onClick={() => void run({ action: 'export-diagnostics' }, 'Saving your support report')}>
          <FileDown size={16} />
          Save support report
        </Button>
      </section>
      <details className="support-details">
        <summary>What’s included in the report?</summary>
        <p>
          The report lists the app version and checks that help find a problem. It does not include your files, folder locations, account details, or passwords. Nothing is sent automatically.
        </p>
      </details>
      <p className="about">HQ · {state.version}</p>
    </>
  );
}
