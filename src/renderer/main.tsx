/// <reference types="vite/client" />
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './theme';
import { CompanionApp } from './companion-app';
import { isDevGalleryPath } from './dev/gallery-path';
import './styles.css';

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
        <CompanionApp />
      </ThemeProvider>
    </StrictMode>,
  );
}

void bootstrap();
