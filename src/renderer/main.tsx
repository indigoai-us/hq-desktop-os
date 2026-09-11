import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getPlatformClient, openReviewedDocsLink } from './platform';
import type { PlatformClient, PlatformResult } from '../shared/platform';
import './styles.css';

function describeResult(result: PlatformResult<unknown>): string {
  if (result.ok) return 'ok';
  return `${result.error.code}: ${result.error.message}`;
}

/**
 * The window's identity and its minimize / maximize / close controls come from
 * the native OS titlebar, and Relaunch and Quit live in the application menu.
 * The page deliberately repeats none of that: a second in-app title and a
 * second set of window controls would be two unrelated affordances for the
 * same action. The window-control IPC channels stay part of the typed
 * boundary and keep their native tests.
 */
function App() {
  const platform = useMemo<PlatformClient>(() => getPlatformClient(), []);
  const [lastResult, setLastResult] = useState<string>('No native action yet');

  const run = async (action: () => Promise<PlatformResult<unknown>>, label: string) => {
    // Pending is shown first so a slow or failing action can never leave a
    // stale success from an earlier action on screen.
    setLastResult(`${label} → pending`);
    try {
      const result = await action();
      setLastResult(`${label} → ${describeResult(result)}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Platform invoke failed.';
      setLastResult(`${label} → unavailable: ${message}`);
    }
  };

  const native = platform.availability === 'native';
  const unavailableNoteId = 'platform-unavailable-note';

  return (
    <main>
      <h1>Your desktop companion</h1>
      <p>
        The app foundation is ready. Workspace setup and sync are coming in the next development
        milestones.
      </p>

      {native ? null : (
        <p
          className="status unavailable"
          role="status"
          id={unavailableNoteId}
          data-testid="platform-unavailable"
        >
          Native platform unavailable · Preload bridge missing. Native actions are disabled rather
          than simulated.
        </p>
      )}

      <section className="actions" aria-label="Application actions">
        <button
          type="button"
          disabled={!native}
          aria-describedby={native ? undefined : unavailableNoteId}
          data-testid="open-docs"
          onClick={() => void run(() => openReviewedDocsLink(platform), 'Open docs')}
        >
          Open documentation in your browser
        </button>
        {/* Always live: asking for native state must report the truth, never a simulated success. */}
        <button
          type="button"
          data-testid="check-native"
          onClick={() => void run(() => platform.getInfo(), 'Check native')}
        >
          Check native connection
        </button>
      </section>

      <p className="status" data-testid="platform-availability">
        {native ? 'Native bridge connected' : 'Native bridge unavailable'}
      </p>
      <p className="status muted" role="status" data-testid="platform-last-result">
        {lastResult}
      </p>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Renderer root is missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
