// FlyLog Pro — offline service worker
//
// Strategy: "network-first, falling back to cache, and cache everything that
// succeeds." This keeps the app fresh when online, while transparently
// building up a full offline cache as files are requested. The Tailwind,
// FontAwesome and Chart.js CDN assets are also cached up front at install.
// Once everything has been fetched successfully at least once, the app keeps
// working with no network connection at all — including the icon fonts,
// which are requested indirectly by FontAwesome's CSS.
//
// Note: service workers only register on pages served over http(s) — not on
// a file opened directly by double-click (file://). All flight/drone/battery
// data itself already lives in localStorage and works fully offline
// regardless of whether this service worker is active.

const CACHE_NAME = 'flylog-cache-v1';
const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.json',
    './favicon.png',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png'
];

// CDN assets the page loads (Tailwind, FontAwesome, Chart.js), cached up front
// so the app is styled offline even right after install — runtime caching
// alone only picks them up once they load through an already-active worker.
// Scripts/CSS are requested by the page without CORS, so they are cached as
// opaque "no-cors" responses; web fonts are always fetched with CORS, so they
// must be cached as CORS responses or the browser refuses them.
const CDN_NO_CORS = [
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];
const CDN_CORS = [
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2'
];

function cacheable(response) {
    return response && (response.ok || response.type === 'opaque');
}

// Best effort: one unreachable file must not abort the whole install.
function precache(cache, request) {
    return fetch(request)
        .then((response) => (cacheable(response) ? cache.put(request, response) : undefined))
        .catch(() => {});
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => Promise.all([
            // Some app paths may not exist depending on how the file was
            // renamed/hosted, so failures are ignored.
            ...PRECACHE_URLS.map((url) => precache(cache, new Request(url, { cache: 'reload' }))),
            ...CDN_NO_CORS.map((url) => precache(cache, new Request(url, { mode: 'no-cors' }))),
            ...CDN_CORS.map((url) => precache(cache, new Request(url, { mode: 'cors' })))
        ]))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            // FlyLog, FlySend, FlyStock and FlySky share the steelgar-code.github.io
            // origin, and Cache Storage is per origin: only delete FlyLog's own old
            // caches, never the other apps' offline copies.
            Promise.all(keys.filter((key) => key.startsWith('flylog-cache-') && key !== CACHE_NAME).map((key) => caches.delete(key)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Only handle simple GET requests; let everything else pass through normally.
    if (event.request.method !== 'GET') return;
    if (!event.request.url.startsWith('http')) return;

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // Cache a copy of anything that loads successfully (the page
                // itself, and any cross-origin CDN asset it pulls in), so it's
                // available next time there's no network.
                // Never let an error response (404/500) replace a good copy.
                if (cacheable(networkResponse)) {
                    const copy = networkResponse.clone();
                    event.waitUntil(
                        caches.open(CACHE_NAME)
                            .then((cache) => cache.put(event.request, copy))
                            .catch(() => {})
                    );
                }
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
