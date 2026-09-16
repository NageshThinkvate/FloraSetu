// FloraSetu service worker (Phase 8, ADR-conformant safe-cache policy):
// - cache-first ONLY for immutable static assets (hashed /assets, /icons, /brand)
// - navigations are network-first with cached app-shell fallback when offline
// - /api/* is NEVER intercepted or cached (no authenticated data, no tokens,
//   no KYB/bank/claim/POD media, no signed URLs — all of those live under /api)
// - cache names are versioned; obsolete caches are deleted on activation
const VERSION = 'p8-1';
const STATIC_CACHE = `florasetu-static-${VERSION}`;
const SHELL_CACHE = `florasetu-shell-${VERSION}`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('florasetu-') && !k.endsWith(`-${VERSION}`)).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);

  // API and signed media: network only, never cached.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Document navigations: network-first, offline shell fallback.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) {
          cache.put('/index.html', response.clone());
        }
        return response;
      } catch (err) {
        const shell = await cache.match('/index.html');
        return shell ?? Response.error();
      }
    })());
    return;
  }

  // Immutable static assets: cache-first.
  if (url.origin === self.location.origin && /^\/(assets|icons|brand)\//.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) {
        return cached;
      }
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(STATIC_CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })());
  }
});
