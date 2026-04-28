/* Mapolis Service Worker — play/sw.js */
const CACHE_NAME = 'mapolis-v1';
const PRECACHE_ASSETS = [
  './',
  './index.html'
  // Add other critical assets here if needed:
  // '../assets/shared.js',
  // '../assets/styles.css',
];

// Install: pre-cache shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).catch(() => {
      // Some assets may 404; don't fail install
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for same-origin, network for everything else
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, Supabase API, and external requests
  if (request.method !== 'GET') return;
  if (url.hostname.includes('supabase')) return;
  if (!url.pathname.startsWith('/Mapolis/')) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Cache successful same-origin GETs
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
