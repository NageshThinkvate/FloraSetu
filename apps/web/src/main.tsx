import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import '@fontsource-variable/inter';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource-variable/fraunces';
import './design/tokens.css';
import './design/components.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Phase 8 PWA: service worker with safe-cache policy (public/sw.js). The policy itself
// is dev-safe (cache-first only for hashed /assets|/icons|/brand; /api never cached;
// navigations network-first), so registration also runs on the preview for validation.
// The offline shell fallback is fully effective on production builds (hashed assets).
// A new worker activates immediately (skipWaiting + clients.claim); reload once so an
// obsolete frontend is never served indefinitely after a version upgrade.
if ('serviceWorker' in navigator && import.meta.env.MODE !== 'test') {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
