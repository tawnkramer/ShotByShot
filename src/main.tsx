import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { trackVisualViewport } from './shell/viewport';
import { reloadOnce } from './shell/reload';
import './styles.css';

trackVisualViewport();

// A page from an older deploy can ask for a code chunk that no longer exists; load the current version instead.
window.addEventListener('vite:preloadError', () => reloadOnce());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
