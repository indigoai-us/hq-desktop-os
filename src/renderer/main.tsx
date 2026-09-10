import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Renderer root is missing');
createRoot(root).render(
  <StrictMode>
    <main>
      <p className="eyebrow">HQ Desktop OS</p>
      <h1>Your desktop companion</h1>
      <p>The app foundation is ready. Workspace setup and sync are coming in the next development milestones.</p>
      <p className="status">Development build · No workspace connected</p>
    </main>
  </StrictMode>,
);
