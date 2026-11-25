// Mapolis Service Worker - Offline Asset Pre-caching
// Version: mapolis-v5-pre-beta6

const CACHE_NAME = 'mapolis-cache-v13';

// Core assets required for 100% offline solo gameplay on classroom tablets
const PRECACHE_ASSETS = [
  '/play/',
  '/play/index.html',
  '/styles.css',
  '/fonts.css',
  '/lib/d3.min.js',
  '/lib/topojson.min.js',
  '/assets/mapolis-globe.js',
  '/assets/compliance-helpers.js',
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

// All 121 badge & animal preserve icons precached for cold offline play
const BADGE_PRECACHE_ASSETS = [
  '/assets/badges/1f300.webp',
  '/assets/badges/1f303.webp',
  '/assets/badges/1f305.webp',
  '/assets/badges/1f306.webp',
  '/assets/badges/1f30a.webp',
  '/assets/badges/1f30b.webp',
  '/assets/badges/1f30d.webp',
  '/assets/badges/1f310.webp',
  '/assets/badges/1f31e.webp',
  '/assets/badges/1f334.webp',
  '/assets/badges/1f38c.webp',
  '/assets/badges/1f38f.webp',
  '/assets/badges/1f393.webp',
  '/assets/badges/1f3ae.webp',
  '/assets/badges/1f3af.webp',
  '/assets/badges/1f3c1.webp',
  '/assets/badges/1f3c5.webp',
  '/assets/badges/1f3c6.webp',
  '/assets/badges/1f3db.webp',
  '/assets/badges/1f3ef.webp',
  '/assets/badges/1f3f0.webp',
  '/assets/badges/1f3f4.webp',
  '/assets/badges/1f3f9.webp',
  '/assets/badges/1f403.webp',
  '/assets/badges/1f405.webp',
  '/assets/badges/1f406.webp',
  '/assets/badges/1f40a.webp',
  '/assets/badges/1f40b.webp',
  '/assets/badges/1f40d.webp',
  '/assets/badges/1f415.webp',
  '/assets/badges/1f418.webp',
  '/assets/badges/1f419.webp',
  '/assets/badges/1f41f.webp',
  '/assets/badges/1f420.webp',
  '/assets/badges/1f422.webp',
  '/assets/badges/1f426.webp',
  '/assets/badges/1f427.webp',
  '/assets/badges/1f428.webp',
  '/assets/badges/1f42a.webp',
  '/assets/badges/1f42b.webp',
  '/assets/badges/1f42c.webp',
  '/assets/badges/1f42f.webp',
  '/assets/badges/1f43a.webp',
  '/assets/badges/1f43b-200d-2744-fe0f.webp',
  '/assets/badges/1f43b.webp',
  '/assets/badges/1f43c.webp',
  '/assets/badges/1f451.webp',
  '/assets/badges/1f4a5.webp',
  '/assets/badges/1f4a8.webp',
  '/assets/badges/1f4ac.webp',
  '/assets/badges/1f4af.webp',
  '/assets/badges/1f4c5.webp',
  '/assets/badges/1f4c6.webp',
  '/assets/badges/1f4da.webp',
  '/assets/badges/1f501.webp',
  '/assets/badges/1f51f.webp',
  '/assets/badges/1f525.webp',
  '/assets/badges/1f54c.webp',
  '/assets/badges/1f5fa.webp',
  '/assets/badges/1f5fb.webp',
  '/assets/badges/1f5fc.webp',
  '/assets/badges/1f5fd.webp',
  '/assets/badges/1f5fe.webp',
  '/assets/badges/1f6a4.webp',
  '/assets/badges/1f6a9.webp',
  '/assets/badges/1f6d6.webp',
  '/assets/badges/1f947.webp',
  '/assets/badges/1f981.webp',
  '/assets/badges/1f983.webp',
  '/assets/badges/1f985.webp',
  '/assets/badges/1f988.webp',
  '/assets/badges/1f989.webp',
  '/assets/badges/1f98a.webp',
  '/assets/badges/1f98b.webp',
  '/assets/badges/1f98c.webp',
  '/assets/badges/1f98d.webp',
  '/assets/badges/1f98e.webp',
  '/assets/badges/1f98f.webp',
  '/assets/badges/1f992.webp',
  '/assets/badges/1f993.webp',
  '/assets/badges/1f994.webp',
  '/assets/badges/1f998.webp',
  '/assets/badges/1f999.webp',
  '/assets/badges/1f99a.webp',
  '/assets/badges/1f99b.webp',
  '/assets/badges/1f99c.webp',
  '/assets/badges/1f99d.webp',
  '/assets/badges/1f9a1.webp',
  '/assets/badges/1f9a2.webp',
  '/assets/badges/1f9a5.webp',
  '/assets/badges/1f9a6.webp',
  '/assets/badges/1f9a7.webp',
  '/assets/badges/1f9a9.webp',
  '/assets/badges/1f9ab.webp',
  '/assets/badges/1f9ac.webp',
  '/assets/badges/1f9ad.webp',
  '/assets/badges/1f9d7.webp',
  '/assets/badges/1f9e0.webp',
  '/assets/badges/1f9ea.webp',
  '/assets/badges/1fa81.webp',
  '/assets/badges/1fabc.webp',
  '/assets/badges/1face.webp',
  '/assets/badges/1fae8.webp',
  '/assets/badges/23f1.webp',
  '/assets/badges/26a1.webp',
  '/assets/badges/26ea.webp',
  '/assets/badges/26f5.webp',
  '/assets/badges/a_axolotl.webp',
  '/assets/badges/a_capybara.webp',
  '/assets/badges/a_clownfish.webp',
  '/assets/badges/a_dingo.webp',
  '/assets/badges/a_dragon.webp',
  '/assets/badges/a_fennec.webp',
  '/assets/badges/a_jaguar.webp',
  '/assets/badges/a_kiwi.webp',
  '/assets/badges/a_leopard.webp',
  '/assets/badges/a_platypus.webp',
  '/assets/badges/a_puffin.webp',
  '/assets/badges/a_redpanda.webp',
  '/assets/badges/a_toucan.webp',
  '/assets/badges/a_turtle.webp'
];

// All 200 self-hosted SVG flags background-warmed after activate
const FLAG_WARM_ASSETS = [
  '/assets/flags/ad.svg',
  '/assets/flags/ae.svg',
  '/assets/flags/af.svg',
  '/assets/flags/ag.svg',
  '/assets/flags/al.svg',
  '/assets/flags/am.svg',
  '/assets/flags/ao.svg',
  '/assets/flags/ar.svg',
  '/assets/flags/at.svg',
  '/assets/flags/au.svg',
  '/assets/flags/az.svg',
  '/assets/flags/ba.svg',
  '/assets/flags/bb.svg',
  '/assets/flags/bd.svg',
  '/assets/flags/be.svg',
  '/assets/flags/bf.svg',
  '/assets/flags/bg.svg',
  '/assets/flags/bh.svg',
  '/assets/flags/bi.svg',
  '/assets/flags/bj.svg',
  '/assets/flags/bn.svg',
  '/assets/flags/bo.svg',
  '/assets/flags/br.svg',
  '/assets/flags/bs.svg',
  '/assets/flags/bt.svg',
  '/assets/flags/bw.svg',
  '/assets/flags/by.svg',
  '/assets/flags/bz.svg',
  '/assets/flags/ca.svg',
  '/assets/flags/cd.svg',
  '/assets/flags/cf.svg',
  '/assets/flags/cg.svg',
  '/assets/flags/ch.svg',
  '/assets/flags/ci.svg',
  '/assets/flags/cl.svg',
  '/assets/flags/cm.svg',
  '/assets/flags/cn.svg',
  '/assets/flags/co.svg',
  '/assets/flags/cr.svg',
  '/assets/flags/cu.svg',
  '/assets/flags/cv.svg',
  '/assets/flags/cy.svg',
  '/assets/flags/cz.svg',
  '/assets/flags/de.svg',
  '/assets/flags/dj.svg',
  '/assets/flags/dk.svg',
  '/assets/flags/dm.svg',
  '/assets/flags/do.svg',
  '/assets/flags/dz.svg',
  '/assets/flags/ec.svg',
  '/assets/flags/ee.svg',
  '/assets/flags/eg.svg',
  '/assets/flags/eh.svg',
  '/assets/flags/er.svg',
  '/assets/flags/es.svg',
  '/assets/flags/et.svg',
  '/assets/flags/fi.svg',
  '/assets/flags/fj.svg',
  '/assets/flags/fm.svg',
  '/assets/flags/fr.svg',
  '/assets/flags/ga.svg',
  '/assets/flags/gb.svg',
  '/assets/flags/gd.svg',
  '/assets/flags/ge.svg',
  '/assets/flags/gf.svg',
  '/assets/flags/gh.svg',
  '/assets/flags/gm.svg',
  '/assets/flags/gn.svg',
  '/assets/flags/gq.svg',
  '/assets/flags/gr.svg',
  '/assets/flags/gt.svg',
  '/assets/flags/gw.svg',
  '/assets/flags/gy.svg',
  '/assets/flags/hn.svg',
  '/assets/flags/hr.svg',
  '/assets/flags/ht.svg',
  '/assets/flags/hu.svg',
  '/assets/flags/id.svg',
  '/assets/flags/ie.svg',
  '/assets/flags/il.svg',
  '/assets/flags/in.svg',
  '/assets/flags/iq.svg',
  '/assets/flags/ir.svg',
  '/assets/flags/is.svg',
  '/assets/flags/it.svg',
  '/assets/flags/jm.svg',
  '/assets/flags/jo.svg',
  '/assets/flags/jp.svg',
  '/assets/flags/ke.svg',
  '/assets/flags/kg.svg',
  '/assets/flags/kh.svg',
  '/assets/flags/ki.svg',
  '/assets/flags/km.svg',
  '/assets/flags/kn.svg',
  '/assets/flags/kp.svg',
  '/assets/flags/kr.svg',
  '/assets/flags/kw.svg',
  '/assets/flags/kz.svg',
  '/assets/flags/la.svg',
  '/assets/flags/lb.svg',
  '/assets/flags/lc.svg',
  '/assets/flags/li.svg',
  '/assets/flags/lk.svg',
  '/assets/flags/lr.svg',
  '/assets/flags/ls.svg',
  '/assets/flags/lt.svg',
  '/assets/flags/lu.svg',
  '/assets/flags/lv.svg',
  '/assets/flags/ly.svg',
  '/assets/flags/ma.svg',
  '/assets/flags/mc.svg',
  '/assets/flags/md.svg',
  '/assets/flags/me.svg',
  '/assets/flags/mg.svg',
  '/assets/flags/mh.svg',
  '/assets/flags/mk.svg',
  '/assets/flags/ml.svg',
  '/assets/flags/mm.svg',
  '/assets/flags/mn.svg',
  '/assets/flags/mr.svg',
  '/assets/flags/mt.svg',
  '/assets/flags/mu.svg',
  '/assets/flags/mv.svg',
  '/assets/flags/mw.svg',
  '/assets/flags/mx.svg',
  '/assets/flags/my.svg',
  '/assets/flags/mz.svg',
  '/assets/flags/na.svg',
  '/assets/flags/nc.svg',
  '/assets/flags/ne.svg',
  '/assets/flags/ng.svg',
  '/assets/flags/ni.svg',
  '/assets/flags/nl.svg',
  '/assets/flags/no.svg',
  '/assets/flags/np.svg',
  '/assets/flags/nr.svg',
  '/assets/flags/nz.svg',
  '/assets/flags/om.svg',
  '/assets/flags/pa.svg',
  '/assets/flags/pe.svg',
  '/assets/flags/pg.svg',
  '/assets/flags/ph.svg',
  '/assets/flags/pk.svg',
  '/assets/flags/pl.svg',
  '/assets/flags/ps.svg',
  '/assets/flags/pt.svg',
  '/assets/flags/pw.svg',
  '/assets/flags/py.svg',
  '/assets/flags/qa.svg',
  '/assets/flags/ro.svg',
  '/assets/flags/rs.svg',
  '/assets/flags/ru.svg',
  '/assets/flags/rw.svg',
  '/assets/flags/sa.svg',
  '/assets/flags/sb.svg',
  '/assets/flags/sc.svg',
  '/assets/flags/sd.svg',
  '/assets/flags/se.svg',
  '/assets/flags/sg.svg',
  '/assets/flags/si.svg',
  '/assets/flags/sk.svg',
  '/assets/flags/sl.svg',
  '/assets/flags/sm.svg',
  '/assets/flags/sn.svg',
  '/assets/flags/so.svg',
  '/assets/flags/sr.svg',
  '/assets/flags/ss.svg',
  '/assets/flags/st.svg',
  '/assets/flags/sv.svg',
  '/assets/flags/sy.svg',
  '/assets/flags/sz.svg',
  '/assets/flags/td.svg',
  '/assets/flags/tg.svg',
  '/assets/flags/th.svg',
  '/assets/flags/tj.svg',
  '/assets/flags/tl.svg',
  '/assets/flags/tm.svg',
  '/assets/flags/tn.svg',
  '/assets/flags/to.svg',
  '/assets/flags/tr.svg',
  '/assets/flags/tt.svg',
  '/assets/flags/tv.svg',
  '/assets/flags/tw.svg',
  '/assets/flags/tz.svg',
  '/assets/flags/ua.svg',
  '/assets/flags/ug.svg',
  '/assets/flags/us.svg',
  '/assets/flags/uy.svg',
  '/assets/flags/uz.svg',
  '/assets/flags/va.svg',
  '/assets/flags/vc.svg',
  '/assets/flags/ve.svg',
  '/assets/flags/vn.svg',
  '/assets/flags/vu.svg',
  '/assets/flags/ws.svg',
  '/assets/flags/xk.svg',
  '/assets/flags/ye.svg',
  '/assets/flags/za.svg',
  '/assets/flags/zm.svg',
  '/assets/flags/zw.svg'
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

// 1. Install: Pre-cache essential offline assets + badge icons in controlled batches
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Pre-caching Mapolis offline assets...');
      const allPrecache = PRECACHE_ASSETS.concat(BADGE_PRECACHE_ASSETS);
      let cachedCount = 0;
      for (let i = 0; i < allPrecache.length; i += 16) {
        const chunk = allPrecache.slice(i, i + 16);
        const results = await Promise.allSettled(chunk.map(async (assetUrl) => {
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
        }));
        cachedCount += results.filter(r => r.value && r.value.status === 'cached').length;
      }
      console.log(`[SW] Pre-caching complete: ${cachedCount}/${allPrecache.length} core + badge assets ready for offline play.`);
    })
  );
});

// 2. Activate: Clean up previous caches, claim clients, and background-warm all flag SVGs
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
    }).then(() => {
      // Non-blocking background warm of all self-hosted SVG flags for cold offline flag quizzes & atlas
      caches.open(CACHE_NAME).then(async (cache) => {
        for (let i = 0; i < FLAG_WARM_ASSETS.length; i += 20) {
          const chunk = FLAG_WARM_ASSETS.slice(i, i + 20);
          await Promise.allSettled(chunk.map(async (flagUrl) => {
            try {
              const existing = await cache.match(flagUrl);
              if (existing) return;
              const resp = await fetch(flagUrl, { cache: 'no-cache' });
              if (resp && resp.ok && !resp.redirected) {
                await cache.put(flagUrl, resp);
              }
            } catch (_) {}
          }));
        }
      }).catch(() => {});
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

    // Heavy static libs, TopoJSON map geometry, fonts, badges, flags, and imagery: Cache-First with Network Fallback
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
