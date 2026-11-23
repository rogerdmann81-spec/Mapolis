// Mapolis Service Worker - Offline Asset Pre-caching
// Version: mapolis-v5-pre-beta6

const CACHE_NAME = 'mapolis-cache-v5';

// Core assets required for 100% offline solo gameplay on classroom tablets
const PRECACHE_ASSETS = [
  '/play/',
  '/play/index.html',
  '/styles.css',
  '/fonts.css',
  '/lib/d3.min.js',
  '/lib/topojson.min.js',
  '/assets/mapolis-globe.js',
  '/assets/shared.js',
  '/assets/features-prebeta6.js',
  '/env.js',
  // Required TopoJSON & Game Data for Solo Mode & World Atlas
  '/data/countries-50m.json',
  '/data/genesis-cards.json',
  '/map-data.js',
  '/avatar-assets.js',
  // Manifest, icons, and Title/Solidarity imagery
  '/manifest.json',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
  '/icon.svg',
  '/assets/monarch-badge.webp',
  '/assets/pcrf-logo.jpeg',
  '/assets/cs-logo.png',
  '/assets/moco-irc.jpeg'
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

// App code & manifest paths that must stay version-synced with HTML (Network-First when online)
function isVersionSensitiveAsset(pathname) {
  if (pathname.startsWith('/lib/')) return false;
  return (
    pathname.endsWith('.js') ||
    pathname.endsWith('.css') ||
    pathname === '/manifest.json'
  );
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
          if (resp && resp.ok && !resp.redirected) {
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

async function matchStaticFallback(cache, req, pathname) {
  const exact = (await cache.match(req)) || (await cache.match(pathname));
  if (exact) return exact;
  if (pathname.endsWith('countries-50m.json')) {
    const jsonFallback = await cache.match('/data/countries-50m.json');
    if (jsonFallback) return jsonFallback;
  } else if (pathname.endsWith('map-data.js')) {
    const mapFallback = await cache.match('/map-data.js');
    if (mapFallback) return mapFallback;
  } else if (pathname.endsWith('avatar-assets.js')) {
    const avaFallback = await cache.match('/avatar-assets.js');
    if (avaFallback) return avaFallback;
  }
  return null;
}

// 3. Fetch Strategy
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Handle Supabase requests: Network only with graceful offline JSON fallback
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

    // Never cache or intercept serverless API / function endpoints
    if (pathname.startsWith('/api/') || pathname.startsWith('/.netlify/')) {
      return;
    }

    // Navigation requests (HTML document loads): Network-First with route-isolated offline fallback
    if (req.mode === 'navigate') {
      const isAdminRoute = pathname.startsWith('/admin') || pathname.startsWith('/play/admin');
      event.respondWith(
        fetch(req)
          .then((networkResp) => {
            if (networkResp && networkResp.ok && !networkResp.redirected) {
              const clone = networkResp.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(req, clone.clone());
                if (pathname && pathname !== '/' && req.url.includes('?')) {
                  cache.put(pathname, clone);
                }
              });
            }
            return networkResp;
          })
          .catch(async () => {
            const cache = await caches.open(CACHE_NAME);
            const exactNav = (await cache.match(req)) ||
                             (await cache.match(req, { ignoreSearch: true })) ||
                             (await cache.match(pathname));
            if (exactNav) return exactNav;

            if (isAdminRoute) {
              const adminCached = (await cache.match('/play/admin/index.html')) ||
                                  (await cache.match('/play/admin/')) ||
                                  (await cache.match('/admin/'));
              if (adminCached) return adminCached;
              return new Response('<h1>Admin Portal Offline</h1><p>Please reconnect to access the Mapolis Admin Portal.</p>', {
                headers: { 'Content-Type': 'text/html' },
                status: 503
              });
            }

            const playCached = (await cache.match('/play/')) ||
                               (await cache.match('/play/index.html'));
            if (playCached) return playCached;
            return new Response('<h1>Mapolis Offline</h1><p>Please reconnect to launch for the first time.</p>', {
              headers: { 'Content-Type': 'text/html' },
              status: 503
            });
          })
      );
      return;
    }

    // Version-sensitive assets (JS, CSS, manifest.json): Network-First with Cache Fallback
    // Prevents new HTML + old JS/CSS version skew after deployments while keeping offline play working.
    if (isVersionSensitiveAsset(pathname)) {
      event.respondWith(
        fetch(req)
          .then(async (networkResp) => {
            if (networkResp && networkResp.ok && !networkResp.redirected) {
              const clone = networkResp.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
              return networkResp;
            }
            const cache = await caches.open(CACHE_NAME);
            const fallback = await matchStaticFallback(cache, req, pathname);
            return fallback || networkResp;
          })
          .catch(async () => {
            const cache = await caches.open(CACHE_NAME);
            const fallback = await matchStaticFallback(cache, req, pathname);
            if (fallback) return fallback;
            console.warn(`[SW] Versioned asset fetch failed offline: ${pathname}`);
            return new Response(null, { status: 404, statusText: 'Offline asset not found' });
          })
      );
      return;
    }

    // Heavy static libs, TopoJSON map geometry, fonts, and imagery: Cache-First with Network Fallback
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResp = await matchStaticFallback(cache, req, pathname);
        if (cachedResp) {
          return cachedResp;
        }

        return fetch(req)
          .then((networkResp) => {
            if (networkResp && networkResp.ok && !networkResp.redirected) {
              const clone = networkResp.clone();
              cache.put(req, clone);
            }
            return networkResp;
          })
          .catch(() => {
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
