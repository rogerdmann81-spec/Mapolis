// Mapolis Service Worker - Offline Asset Pre-caching
// Version: mapolis-v1-pre-beta5

const CACHE_NAME = 'mapolis-cache-v1';

// Core assets required for 100% offline solo gameplay on classroom tablets
const PRECACHE_ASSETS = [
  '/',
  '/play/',
  '/play/index.html',
  '/play/styles.css',
  '/play/fonts.css',
  '/lib/d3.min.js',
  '/lib/topojson.min.js',
  '/assets/mapolis-globe.js',
  '/assets/shared.js',
  '/env.js',
  '/play/env.js',
  // Required TopoJSON & Game Data for Solo Mode
  '/data/countries-50m.json',
  '/play/data/countries-50m.json',
  '/map-data.js',
  '/play/map-data.js',
  '/avatar-assets.js',
  '/play/avatar-assets.js',
  // Manifest and icons
  '/manifest.json',
  '/play/manifest.json',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
  '/play/favicon.ico'
];

// Helper: Normalize URL to pathname for cache lookup
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch (e) {
    return url;
  }
}

// 1. Install: Pre-cache essential offline assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Pre-caching Mapolis offline assets...');
      // Use individual fetches with error handling to guarantee critical assets
      // (countries-50m.json, map-data.js, avatar-assets.js) are cached even if an optional asset 404s
      const cachePromises = PRECACHE_ASSETS.map(async (assetUrl) => {
        try {
          const resp = await fetch(assetUrl, { cache: 'no-cache' });
          if (resp && resp.ok) {
            await cache.put(assetUrl, resp);
            return { url: assetUrl, status: 'cached' };
          }
        } catch (err) {
          console.warn(`[SW] Non-critical cache skip for ${assetUrl}:`, err.message);
        }
        return { url: assetUrl, status: 'skipped' };
      });

      const results = await Promise.allSettled(cachePromises);
      const cachedCount = results.filter(r => r.value && r.value.status === 'cached').length;
      console.log(`[SW] Pre-caching complete: ${cachedCount}/${PRECACHE_ASSETS.length} assets ready for offline play.`);
    })
  );
});

// 2. Activate: Clean up previous caches & claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log(`[SW] Deleting old cache: ${name}`);
            return caches.delete(name);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// 3. Fetch Strategy
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Handle Supabase and external API requests: Network only with graceful offline JSON fallback
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(req).catch(() => {
        return new Response(
          JSON.stringify({ offline: true, error: 'Network unavailable: playing in offline solo mode' }),
          { headers: { 'Content-Type': 'application/json' }, status: 503 }
        );
      })
    );
    return;
  }

  // Handle same-origin requests
  if (url.origin === self.location.origin) {
    const pathname = url.pathname;

    // Navigation requests (HTML document loads)
    if (req.mode === 'navigate') {
      event.respondWith(
        fetch(req)
          .then((networkResp) => {
            if (networkResp && networkResp.ok) {
              const clone = networkResp.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
            }
            return networkResp;
          })
          .catch(async () => {
            // Offline fallback for navigation: serve cached play/index.html or /play/
            const cache = await caches.open(CACHE_NAME);
            const cachedNav = (await cache.match('/play/')) ||
                              (await cache.match('/play/index.html')) ||
                              (await cache.match(req));
            if (cachedNav) return cachedNav;
            return new Response('<h1>Mapolis Offline</h1><p>Please reconnect to launch for the first time.</p>', {
              headers: { 'Content-Type': 'text/html' }
            });
          })
      );
      return;
    }

    // Static assets (countries-50m.json, map-data.js, avatar-assets.js, CSS, JS, fonts)
    // Strategy: Cache-First with Network Fallback
    event.respondWith(
      caches.match(req).then(async (cachedResp) => {
        if (cachedResp) {
          return cachedResp;
        }

        // Secondary fallback matching for relative/absolute variants
        const cache = await caches.open(CACHE_NAME);
        if (pathname.endsWith('countries-50m.json')) {
          const jsonFallback = (await cache.match('/data/countries-50m.json')) ||
                               (await cache.match('/play/data/countries-50m.json'));
          if (jsonFallback) return jsonFallback;
        } else if (pathname.endsWith('map-data.js')) {
          const mapFallback = (await cache.match('/play/map-data.js')) || (await cache.match('/map-data.js'));
          if (mapFallback) return mapFallback;
        } else if (pathname.endsWith('avatar-assets.js')) {
          const avaFallback = (await cache.match('/play/avatar-assets.js')) || (await cache.match('/avatar-assets.js'));
          if (avaFallback) return avaFallback;
        }

        // If not in cache, fetch from network and dynamically cache
        return fetch(req)
          .then((networkResp) => {
            if (networkResp && networkResp.ok) {
              const clone = networkResp.clone();
              caches.open(CACHE_NAME).then((c) => c.put(req, clone));
            }
            return networkResp;
          })
          .catch(() => {
            // Network failed and not in cache
            console.warn(`[SW] Asset fetch failed offline: ${pathname}`);
            return new Response(null, { status: 404, statusText: 'Offline asset not found' });
          });
      })
    );
  }
});

// 4. Message Listener
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
