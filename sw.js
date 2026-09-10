// AeroLog Pro — offline service worker
//
// Strategy: "network-first, falling back to cache, and cache everything that
// succeeds." This keeps the app fresh when online, while transparently
// building up a full offline cache (the HTML page itself, plus the Tailwind,
// FontAwesome CSS/font files, and Chart.js CDN assets) as they're requested.
// Once everything has been fetched successfully at least once, the app keeps
// working with no network connection at all — including the icon fonts,
// which are requested indirectly by FontAwesome's CSS.
//
// Note: service workers only register on pages served over http(s) — not on
// a file opened directly by double-click (file://). All flight/drone/battery
// data itself already lives in localStorage and works fully offline
// regardless of whether this service worker is active.

const CACHE_NAME = 'aerolog-cache-v1';
const PRECACHE_URLS = [
    './',
    './index.html',
    './UAV_Flight_Log_App.html'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Best-effort: some of these paths may not exist depending on how
            // the file was renamed/hosted, so failures here are ignored.
            return Promise.all(
                PRECACHE_URLS.map((url) => cache.add(url).catch(() => {}))
            );
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Only handle simple GET requests; let everything else pass through normally.
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // Cache a copy of anything that loads successfully (the page
                // itself, and any cross-origin CDN asset it pulls in), so it's
                // available next time there's no network.
                const copy = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, copy).catch(() => {});
                });
                return networkResponse;
            })
            .catch(() => {
                // Offline (or the network request failed): serve the last
                // cached copy if we have one.
                return caches.match(event.request).then((cached) => {
                    return cached || Response.error();
                });
            })
    );
});
