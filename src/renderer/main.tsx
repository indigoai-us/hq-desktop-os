/// <reference types="vite/client" />
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getPlatformClient, openReviewedDocsLink } from './platform';
import type { PlatformClient, PlatformResult } from '../shared/platform';
import { ThemeControl, ThemeProvider } from './theme';
import { isDevGalleryPath } from './dev/gallery-path';
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
    <main className="hq-page" data-focus-shell tabIndex={-1}>
      <h1 className="hq-title">Your desktop companion</h1>
      <p className="hq-body">
        The app foundation is ready. Workspace setup and sync are coming in the next development
        milestones.
      </p>

      {native ? null : (
        <p
          className="hq-status"
          data-tone="unavailable"
          role="status"
          id={unavailableNoteId}
          data-testid="platform-unavailable"
        >
          Native platform unavailable · Preload bridge missing. Native actions are disabled rather
          than simulated.
        </p>
      )}

      <section className="hq-actions" aria-label="Application actions">
        <button
          type="button"
          className="hq-button"
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
          className="hq-button"
          data-testid="check-native"
          onClick={() => void run(() => platform.getInfo(), 'Check native')}
        >
          Check native connection
        </button>
        {/* Representative selected control for the HQ selection contract (background only). */}
        <button
          type="button"
          className="hq-button hq-nav-item"
          data-selected="true"
          data-testid="selected-sample"
          aria-current="page"
        >
          Companion
        </button>
      </section>

      <ThemeControl />

      <p className="hq-status" data-testid="platform-availability">
        {native ? 'Native bridge connected' : 'Native bridge unavailable'}
      </p>
      <p className="hq-status" data-tone="muted" role="status" data-testid="platform-last-result">
        {lastResult}
      </p>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Renderer root is missing');

async function bootstrap(): Promise<void> {
  // Gallery is development-only. Production builds evaluate `import.meta.env.DEV`
  // as false, so the dynamic import is dropped from the shipped graph — no
  // production debug escape via query, hash, or localStorage.
  if (import.meta.env.DEV && isDevGalleryPath(window.location.pathname)) {
    const { mountDevComponentGallery } = await import('./dev/components');
    mountDevComponentGallery(root!);
    return;
  }

  createRoot(root!).render(
    <StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </StrictMode>,
  );
}

void bootstrap();
