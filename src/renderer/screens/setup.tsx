import { ArrowRight, Check } from 'lucide-react';
import type { CompanionAction, CompanionSnapshot } from '../../shared/companion';
import { Button } from '../components/ui/button';
import { HqMark } from '../components/hq-mark';

export function SetupScreen(props: {
  setup: NonNullable<CompanionSnapshot['setup']>;
  setupRunning: boolean;
  pending: string;
  run: (action: CompanionAction, label: string) => void;
  screenState: string;
}) {
  const { setup, setupRunning, pending, run, screenState } = props;
  return (
    <section className="welcome" aria-label="HQ setup" data-screen="Workspace" data-screen-state={screenState} data-testid="screen-workspace">
      <HqMark className="welcome-mark" />
      <h1>{setupRunning ? 'Getting HQ ready' : 'Let’s finish setting up'}</h1>
      <p className="lead">We’ll prepare your workspace and the software it needs. This can take a few minutes.</p>
      <ol className="setup-steps setup-progress">
        {setup.steps.map((step, index) => (
          <li key={step.id}>
            <span className="step-symbol">{step.status === 'ready' ? <Check size={16} /> : index + 1}</span>
            <div>
              <h2>{step.label}</h2>
              <p>
                {step.status === 'ready'
                  ? 'Ready'
                  : step.status === 'working'
                    ? 'In progress…'
                    : step.status === 'error'
                      ? 'Needs another try'
                      : 'Up next'}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {setup.error && <p className="notice error" role="alert">{setup.error}</p>}
      <div className="welcome-actions">
        {setupRunning ? (
          <Button variant="outline" disabled={!!pending} onClick={() => void run({ action: 'cancel-setup' }, 'Stopping setup')}>
            Cancel setup
          </Button>
        ) : (
          <>
            <Button disabled={!!pending} onClick={() => void run({ action: 'resume-setup' }, 'Continuing setup')}>
              Continue setup
              <ArrowRight size={16} />
            </Button>
            <Button variant="ghost" disabled={!!pending} onClick={() => void run({ action: 'reset-setup' }, 'Choosing a different folder')}>
              Choose another folder
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
