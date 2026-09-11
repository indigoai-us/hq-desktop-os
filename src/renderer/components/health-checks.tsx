import type { CompanionHealth, HealthUiState } from '../../shared/health';
import { HEALTH_UI_STATE_LABELS } from '../../shared/health';
import { Button } from './ui/button';

function statusClass(status: HealthUiState): string {
  return `health-status health-status-${status}`;
}

export function HealthChecks(props: {
  health: CompanionHealth;
  onRunChecks?: () => void;
  disabled?: boolean;
}) {
  const { health, onRunChecks, disabled } = props;
  return (
    <section className="health-panel" aria-label="Health checks" data-testid="health-checks">
      <div className="health-heading">
        <div>
          <h2>Health checks</h2>
          <p>
            {HEALTH_UI_STATE_LABELS[health.overall]}
            {health.lastCheckedAt ? ` · Last checked ${new Date(health.lastCheckedAt).toLocaleString()}` : ''}
          </p>
        </div>
        {onRunChecks && (
          <Button
            variant="outline"
            disabled={disabled || health.overall === 'checking'}
            onClick={onRunChecks}
          >
            {health.overall === 'checking' ? 'Checking…' : 'Run checks'}
          </Button>
        )}
      </div>
      <ul className="health-check-list">
        {health.checks.map((check) => (
          <li key={check.id} data-status={check.status} data-testid={`health-check-${check.id}`}>
            <span className={statusClass(check.status)} aria-label={HEALTH_UI_STATE_LABELS[check.status]} />
            <div>
              <strong>{check.label}</strong>
              <p>{check.detail}</p>
            </div>
            <span className="health-check-state">{HEALTH_UI_STATE_LABELS[check.status]}</span>
          </li>
        ))}
      </ul>
      {!health.reportingEnabled && (
        <p className="health-footnote">
          Local checks only. Server attribution and support commands are not enabled in this build.
        </p>
      )}
    </section>
  );
}
