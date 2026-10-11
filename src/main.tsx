import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { trackVisualViewport } from './shell/viewport';
import './styles.css';

trackVisualViewport();

// A page from an older deploy can ask for a code chunk that no longer exists; load the current version instead.
window.addEventListener('vite:preloadError', () => {
  try {
    // Once a minute at most, so a chunk that's really missing can't cause a reload loop.
    const last = Number(sessionStorage.getItem('sbs-chunk-reload') ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem('sbs-chunk-reload', String(Date.now()));
  } catch {
    return;
  }
  location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
