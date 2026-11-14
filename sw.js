// FlyLog — offline-first service worker
//
// Pilots open FlyLog in the field with weak or no signal, so the app must start
// from cache and never wait on the network:
//
// - install:  download the whole app (cache: 'reload', bypassing the HTTP
//             cache). index.html and every vendor file are required — if one
//             fails, install rejects, this worker never activates, the previous
//             worker keeps serving and the browser retries later. The manifest
//             and icons are best-effort.
// - fetch:    opening the app (a navigation to the scope root or index.html,
//             any query string) is answered instantly from the cached
//             index.html, and starts a background update check. Every other
//             in-scope GET is cache-first, then network (caching successful
//             same-origin responses).
// - updates:  detected by content, so there is no version stamp to bump. The
//             check downloads index.html; if its bytes differ from the cached
//             copy, it refreshes the manifest and icons, makes sure every
//             vendor file is cached, stores the new index.html LAST (so an
//             interrupted update never leaves a new page next to missing
//             assets) and tells open pages {type: 'flylog-update-ready'}; the
//             page offers a Reload button. Vendor file names carry their
//             version, so a cached vendor file never needs re-fetching.
//
// Service workers only run on http(s) pages, never on a file:// page opened
// from disk; that copy works offline anyway because every file is local. All
// flight/drone/battery data lives in localStorage either way.

// FlyLog, FlySend, FlyStock and FlySky share the steelgar-code.github.io
// origin, and Cache Storage is per origin: this worker only ever reads and
// deletes caches named with its own prefix, never the other apps' caches.
const CACHE_PREFIX = 'flylog-cache-';
const CACHE_NAME = CACHE_PREFIX + 'v2';

// Paths are relative to this file (the app's root, which is also the scope).
const SHELL_URLS = [
    './index.html',
    './manifest.json',
    './favicon.png',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png'
];
const VENDOR_URLS = [
    './vendor/tailwindcss-3.4.17.js',
    './vendor/chart-4.6.1.umd.js',
    './vendor/fontawesome-free-6.4.0/css/fontawesome.min.css',
    './vendor/fontawesome-free-6.4.0/css/solid.min.css',
    './vendor/fontawesome-free-6.4.0/webfonts/fa-solid-900.woff2'
];

const abs = (url) => new URL(url, self.location.href).href;
const INDEX_URL = abs('./index.html');
const VENDOR = VENDOR_URLS.map(abs);
const OPTIONAL = SHELL_URLS.map(abs).filter((url) => url !== INDEX_URL); // manifest + icons

// An update check that hangs (dead-slow network) must not block later checks forever.
const UPDATE_FETCH_TIMEOUT_MS = 30000;

// Fetch one file, rejecting on network errors and non-2xx responses.
async function fetchOk(url, cacheMode, signal) {
    const response = await fetch(new Request(url, { cache: cacheMode, signal }));
    if (!response.ok) throw new Error(`FlyLog SW: ${url} answered ${response.status}`);
    return response;
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil((async () => {
        // Download everything before writing anything, then store index.html last.
        const [required, optional] = await Promise.all([
            Promise.all([INDEX_URL, ...VENDOR].map((url) => fetchOk(url, 'reload'))),
            Promise.all(OPTIONAL.map((url) => fetchOk(url, 'reload').catch(() => null)))
        ]);
        const [index, ...vendor] = required;
        const cache = await caches.open(CACHE_NAME);
        await Promise.all([
            ...vendor.map((response, i) => cache.put(VENDOR[i], response)),
            ...optional.map((response, i) => response && cache.put(OPTIONAL[i], response))
        ]);
        await cache.put(INDEX_URL, index);
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)));
        await self.clients.claim();
    })());
});

function isAppNavigation(request, url) {
    if (request.mode !== 'navigate') return false;
    const root = new URL(self.registration.scope).pathname;
    return url.pathname === root || url.pathname === root + 'index.html';
}

async function serveIndex(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(INDEX_URL);
    if (cached) return cached;
    try { return await fetch(request); } catch (err) { return Response.error(); }
}

async function cacheFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
            await cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch (err) {
        return Response.error();
    }
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    // Sibling apps share this origin: leave anything outside our scope alone.
    if (!request.url.startsWith(self.registration.scope)) return;

    const url = new URL(request.url);
    if (isAppNavigation(request, url)) {
        event.respondWith(serveIndex(request));
        const clientId = event.resultingClientId;
        // The page that is loading right now may not be listed by matchAll()
        // yet when the check finishes, so notify it by id as well.
        event.waitUntil(checkForUpdate().then((changed) => (changed && clientId ? notifyClient(clientId) : undefined)));
        return;
    }
    event.respondWith(cacheFirst(request));
});

// Pages may ask for a check (e.g. when the connection comes back). The reply
// {type: 'flylog-update-checked'} travels the same channel as, and therefore
// after, any 'flylog-update-ready' this check sent.
self.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'flylog-check-update') return;
    const source = event.source;
    event.waitUntil(checkForUpdate().then((changed) => {
        if (source) source.postMessage({ type: 'flylog-update-checked', changed });
    }));
});

// Concurrent navigations share one run.
let updateRun = null;
function checkForUpdate() {
    if (!updateRun) {
        updateRun = runUpdateCheck()
            .catch(() => false)
            .finally(() => { updateRun = null; });
    }
    return updateRun;
}

function sameBytes(a, b) {
    if (a.byteLength !== b.byteLength) return false;
    const x = new Uint8Array(a);
    const y = new Uint8Array(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
}

// Resolves true when a new index.html was stored (and pages were told).
async function runUpdateCheck() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPDATE_FETCH_TIMEOUT_MS);
    try {
        const cache = await caches.open(CACHE_NAME);
        let fresh;
        try {
            fresh = await fetchOk(INDEX_URL, 'no-cache', controller.signal);
        } catch (err) {
            return false; // offline or server trouble: keep what we have
        }
        const freshBytes = await fresh.clone().arrayBuffer();
        const cached = await cache.match(INDEX_URL);
        if (cached && sameBytes(freshBytes, await cached.arrayBuffer())) return false;

        // Best-effort refresh of manifest and icons.
        await Promise.all(OPTIONAL.map((url) => fetchOk(url, 'no-cache', controller.signal)
            .then((response) => cache.put(url, response))
            .catch(() => {})));
        // Every vendor file must be present before the new page goes in; any
        // failure aborts the update (the next check retries).
        for (const url of VENDOR) {
            if (await cache.match(url)) continue;
            await cache.put(url, await fetchOk(url, 'reload', controller.signal));
        }
        await cache.put(INDEX_URL, fresh);
    } finally {
        clearTimeout(timer);
    }

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    windows.forEach((client) => client.postMessage({ type: 'flylog-update-ready' }));
    return true;
}

async function notifyClient(id) {
    // clients.get() waits until a just-navigated page exists.
    const client = await self.clients.get(id);
    if (client) client.postMessage({ type: 'flylog-update-ready' });
}
