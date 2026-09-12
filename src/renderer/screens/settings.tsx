import { FileDown, Eye, Wrench } from 'lucide-react';
import type { CompanionAction, CompanionSnapshot } from '../../shared/companion';
import type { CompanionHealth } from '../../shared/health';
import { ThemeControl } from '../theme';
import { HealthChecks } from '../components/health-checks';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog';
import { AccountScreen } from './account';

function diagnosisLabel(diagnosis: 'ok' | 'missing' | 'failed'): string {
  switch (diagnosis) {
    case 'ok': return 'Available';
    case 'missing': return 'Missing';
    case 'failed': return 'Failed';
  }
}

export function SettingsScreen(props: {
  state: CompanionSnapshot;
  health: CompanionHealth;
  enabled: boolean;
  connected: boolean;
  run: (action: CompanionAction, label: string) => void;
}) {
  const { state, health, enabled, connected, run } = props;
  const preview = state.diagnosticsPreview ?? null;
  const repair = state.runtimeRepair;
  const showRepair = !!repair && repair.diagnosis !== 'ok';
  return (
    <>
      <header className="page-heading">
        <h1>Settings</h1>
        <p className="lead">Make HQ feel at home.</p>
      </header>
      <section className="content-section"><ThemeControl /></section>
      <AccountScreen state={state} enabled={enabled} connected={connected} run={run} layout="settings" />
      <section className="setting-row" data-testid="setting-close-to-tray">
        <div>
          <h2>Keep HQ running</h2>
          <p>
            {state.trayAvailable
              ? 'Continue syncing after you close this window. Use Quit HQ in the tray to stop owned sync.'
              : 'This desktop does not support a tray. Keep this window open to continue syncing, or Quit from the app menu.'}
          </p>
        </div>
        <input
          type="checkbox"
          aria-label="Keep HQ running"
          checked={state.preferences.closeToTray}
          disabled={!enabled || !state.trayAvailable}
          onChange={(event) => void run({ action: 'set-preference', preference: 'closeToTray', enabled: event.target.checked }, 'Saving your preference')}
        />
      </section>
      <section className="setting-row" data-testid="setting-launch-at-login">
        <div>
          <h2>Open HQ when I sign in</h2>
          <p>
            {state.launchAtLoginSupported
              ? 'Start HQ when you sign in to this computer. Uses your per-user startup settings — no admin privileges.'
              : 'Automatic startup is not available here (install HQ first, or open it from Windows when using WSL).'}
          </p>
        </div>
        <input
          type="checkbox"
          aria-label="Open HQ when I sign in"
          checked={state.preferences.launchAtLogin}
          disabled={!enabled || !state.launchAtLoginSupported}
          onChange={(event) => void run({ action: 'set-preference', preference: 'launchAtLogin', enabled: event.target.checked }, 'Saving your preference')}
        />
      </section>

      <section className="diagnostics-panel" aria-label="Diagnostics" data-testid="diagnostics-panel">
        <div className="diagnostics-heading">
          <div>
            <h2>Diagnostics</h2>
            <p>
              App {state.version} · Runtime {state.runtime.version} · Node {state.runtime.node}
              {repair ? ` · Runtime ${diagnosisLabel(repair.diagnosis)}` : ''}
            </p>
          </div>
          <Button
            variant="outline"
            disabled={!enabled}
            onClick={() => void run({ action: 'diagnostics' }, 'Running health checks')}
          >
            Retry checks
          </Button>
        </div>
        <ul className="diagnostics-list" data-testid="diagnostics-list">
          {state.diagnostics.map((item) => (
            <li key={item.name} data-state={item.state} data-testid={`diagnostics-${item.name}`}>
              <strong>{item.name}</strong>
              <p>{item.detail}</p>
              <span className="diagnostics-state">{item.state}</span>
            </li>
          ))}
        </ul>
        {showRepair && (
          <div className="diagnostics-repair" data-testid="diagnostics-repair">
            <div>
              <h3>{repair.diagnosis === 'failed' ? 'Runtime failed' : 'Runtime missing'}</h3>
              <p>{repair.guidance}</p>
              <p className="diagnostics-repair-note">
                Repair restores owned tools only. Your workspace files stay unchanged. Unsupported repairs never run automatically.
              </p>
            </div>
            <Button
              variant="outline"
              disabled={!enabled || repair.status === 'running'}
              onClick={() => void run({ action: 'repair-runtime' }, 'Repairing owned runtime')}
            >
              <Wrench size={16} />
              {repair.status === 'running' ? 'Repairing…' : 'Repair runtime'}
            </Button>
          </div>
        )}
        {repair && (repair.status === 'ready' || repair.status === 'error' || repair.status === 'unsupported') && (
          <p className="diagnostics-repair-result" role="status" data-testid="diagnostics-repair-result">
            {repair.guidance}
          </p>
        )}
      </section>

      <HealthChecks
        health={health}
        disabled={!enabled}
        onRunChecks={() => void run({ action: 'diagnostics' }, 'Running health checks')}
      />
      <section className="setting-row">
        <div>
          <h2>Need a hand?</h2>
          <p>Preview a private report, then save it when you ask for help. Nothing is sent automatically.</p>
        </div>
        <div className="diagnostics-export-actions">
          <Button
            variant="ghost"
            disabled={!enabled}
            onClick={() => void run({ action: 'preview-diagnostics' }, 'Preparing your support report')}
          >
            <Eye size={16} />
            Preview support report
          </Button>
          <Button
            variant="ghost"
            disabled={!enabled}
            onClick={() => void run({ action: 'export-diagnostics' }, 'Saving your support report')}
          >
            <FileDown size={16} />
            Save support report
          </Button>
        </div>
      </section>
      <details className="support-details">
        <summary>What’s included in the report?</summary>
        <p>
          The report lists the app version, workspace environment, recent sync outcomes, and health checks that help find a problem. Credentials, file contents, and folder locations are removed before you see or save it. Nothing is sent automatically.
        </p>
      </details>
      <p className="about">HQ · {state.version}</p>

      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) void run({ action: 'dismiss-diagnostics-preview' }, 'Closing support report preview');
        }}
      >
        <DialogContent className="sm:max-w-2xl" data-testid="diagnostics-preview-dialog">
          <DialogTitle>Support report preview</DialogTitle>
          <DialogDescription>
            Review the redacted report before saving. Secrets, file contents, and sensitive paths are already removed. Nothing is uploaded.
          </DialogDescription>
          <pre className="diagnostics-preview" data-testid="diagnostics-preview">{preview?.text}</pre>
          <div className="dialog-actions">
            <Button variant="outline" onClick={() => void run({ action: 'dismiss-diagnostics-preview' }, 'Closing support report preview')}>
              Close
            </Button>
            <Button onClick={() => void run({ action: 'export-diagnostics' }, 'Saving your support report')}>
              <FileDown size={16} />
              Save report
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
