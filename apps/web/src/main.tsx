import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import '@fontsource-variable/inter';
import '@fontsource/cormorant-garamond/600.css';
import './design/tokens.css';
import './design/components.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Phase 8 PWA: production-only service worker (safe-cache policy in public/sw.js).
// A new worker activates immediately (skipWaiting + clients.claim); reload once so an
// obsolete frontend is never served indefinitely after a version upgrade.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
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
