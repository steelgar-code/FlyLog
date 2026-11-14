// Offline-first service worker behaviour. Each test serves its own temp copy of
// the app under /FlyLog/ on its own ephemeral port (= its own origin, so no
// worker or cache leaks between tests), mirroring GitHub Pages sub-path
// hosting; deploys are simulated by editing that copy.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test: base, expect } = require('@playwright/test');
const { startServer, REPO_ROOT } = require('./support/server');
const { swLists } = require('./support/sw-lists');
const { expectStyledApp, expectChart, expectIconFont } = require('./support/checks');

const { shell: SHELL_URLS, vendor: VENDOR_URLS, cacheName: CACHE } = swLists();
const APP_FILES = ['index.html', 'sw.js', 'manifest.json', 'favicon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const TITLE = 'FlyLog - UAV Flight & Fleet Operations';

const test = base.extend({
  app: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flylog-offline-'));
    for (const f of APP_FILES) fs.copyFileSync(path.join(REPO_ROOT, f), path.join(dir, f));
    fs.cpSync(path.join(REPO_ROOT, 'vendor'), path.join(dir, 'vendor'), { recursive: true });
    const server = await startServer({ root: dir, mount: '/FlyLog/', port: 0 });
    const abs = (u) => new URL(u, server.url).href;
    await use({
      dir,
      server,
      url: server.url,
      abs,
      deploy(file, edit) {
        const p = path.join(dir, file);
        fs.writeFileSync(p, edit(fs.readFileSync(p, 'utf8')));
      },
    });
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  },
  pageErrors: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await use(errors);
  },
});

// First visit: wait until the worker installed (whole app cached) and controls the page.
async function install(page, app) {
  await page.goto(app.url);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

async function cachedUrls(page, name = CACHE) {
  return page.evaluate(async (n) => {
    if (!(await caches.has(n))) return [];
    const cache = await caches.open(n);
    return (await cache.keys()).map((r) => r.url);
  }, name);
}

// Join (or start) the worker's update check and wait until it is done. Its
// reply comes on the same channel as, so after, any 'flylog-update-ready'.
async function settleUpdateCheck(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const sw = navigator.serviceWorker;
    sw.addEventListener('message', function onMessage(e) {
      if (!e.data || e.data.type !== 'flylog-update-checked') return;
      sw.removeEventListener('message', onMessage);
      resolve(e.data.changed);
    });
    sw.controller.postMessage({ type: 'flylog-check-update' });
  }));
}

async function expectFullApp(page) {
  await expectStyledApp(page);
  await expectChart(page);
  await expectIconFont(page);
}

test('first load installs the worker and caches every shell and vendor file', async ({ page, app, pageErrors }) => {
  await install(page, app);
  const state = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).active.state);
  expect(['activating', 'activated']).toContain(state);
  const urls = await cachedUrls(page);
  for (const u of [...SHELL_URLS, ...VENDOR_URLS]) expect(urls, u).toContain(app.abs(u));
  expect(pageErrors).toEqual([]);
});

test('offline: reload, ./?source=pwa and ./index.html all render the full app', async ({ page, context, app, pageErrors }) => {
  await install(page, app);
  await context.setOffline(true);
  for (const target of [null, app.url + '?source=pwa', app.url + 'index.html', app.url + 'index.html?x=1#flights']) {
    if (target) await page.goto(target); else await page.reload();
    await expect(page).toHaveTitle(TITLE);
    await expectFullApp(page);
    await expect(page.locator('#offlineBadge')).toBeVisible();
  }
  expect(pageErrors).toEqual([]);
});

test('a hanging network does not delay startup', async ({ page, app, pageErrors }) => {
  await install(page, app);
  app.server.hang = true;
  const before = app.server.requests.length;
  const started = Date.now();
  await page.reload({ timeout: 5000 });
  await page.goto(app.url + '?source=pwa', { timeout: 5000 });
  expect(Date.now() - started).toBeLessThan(5000);
  await expectFullApp(page);
  // The network was asked (update check) and never answered.
  expect(app.server.requests.slice(before).some((r) => r.path === '/FlyLog/index.html')).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('a deploy is picked up in the background and offered via the update prompt', async ({ page, app, pageErrors }) => {
  await install(page, app);
  const banner = page.locator('#updatePrompt');
  await expect(banner).toBeHidden();

  app.deploy('index.html', (s) => s.replace(`<title>${TITLE}</title>`, `<title>${TITLE} NEXT</title>`));
  await page.reload();
  await expect(page).toHaveTitle(TITLE); // still the cached page, instantly
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Update available');

  await page.locator('#updateReloadBtn').click();
  await expect(page).toHaveTitle(`${TITLE} NEXT`);
  expect(await settleUpdateCheck(page)).toBe(false);
  await expect(banner).toBeHidden();

  await page.reload();
  await expect(page).toHaveTitle(`${TITLE} NEXT`);
  expect(await settleUpdateCheck(page)).toBe(false);
  await expect(banner).toBeHidden();
  await expectFullApp(page);
  expect(pageErrors).toEqual([]);
});

test('the update prompt can be dismissed', async ({ page, app }) => {
  await install(page, app);
  app.deploy('index.html', (s) => s.replace('</body>', '<!-- v-next --></body>'));
  await page.reload();
  const banner = page.locator('#updatePrompt');
  await expect(banner).toBeVisible();
  await page.locator('#updateDismiss').click();
  await expect(banner).toBeHidden();
});

test('an update whose vendor files cannot be fetched leaves the cached app untouched', async ({ page, app }) => {
  await install(page, app);
  const vendor = app.abs(VENDOR_URLS[1]);
  await page.evaluate(async ([n, u]) => (await caches.open(n)).delete(u), [CACHE, vendor]);
  fs.rmSync(path.join(app.dir, VENDOR_URLS[1]));
  app.deploy('index.html', (s) => s.replace(`<title>${TITLE}</title>`, `<title>${TITLE} NEXT</title>`));

  expect(await settleUpdateCheck(page)).toBe(false);
  await expect(page.locator('#updatePrompt')).toBeHidden();
  const cachedTitle = await page.evaluate(async ([n, u]) => {
    const text = await (await (await caches.open(n)).match(u)).text();
    return text.match(/<title>([^<]*)<\/title>/)[1];
  }, [CACHE, app.abs('./index.html')]);
  expect(cachedTitle).toBe(TITLE);
  // The next check, once the file is back, completes the update.
  fs.copyFileSync(path.join(REPO_ROOT, VENDOR_URLS[1]), path.join(app.dir, VENDOR_URLS[1]));
  expect(await settleUpdateCheck(page)).toBe(true);
  await expect(page.locator('#updatePrompt')).toBeVisible();
  expect(await cachedUrls(page)).toContain(vendor);
});

test('no update prompt on first install or on repeated loads without a deploy', async ({ page, app }) => {
  await install(page, app);
  const banner = page.locator('#updatePrompt');
  expect(await settleUpdateCheck(page)).toBe(false);
  await expect(banner).toBeHidden();
  for (let i = 0; i < 2; i++) {
    await page.reload();
    expect(await settleUpdateCheck(page)).toBe(false);
    await expect(banner).toBeHidden();
  }
});

test('a new worker taking over a controlled page shows the update prompt', async ({ page, app }) => {
  await install(page, app);
  await page.reload(); // this load starts out controlled by the current worker
  expect(await settleUpdateCheck(page)).toBe(false);
  app.deploy('sw.js', (s) => s + '\n// next worker version\n');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await expect(page.locator('#updatePrompt')).toBeVisible();
});

test('offline indicator reaches ready and the one-time toast shows only once', async ({ page, app }) => {
  const status = page.locator('#offlineStatus');
  const toast = page.locator('#toastContainer', { hasText: 'FlyLog is ready to work offline.' });
  await page.goto(app.url);
  await expect(status).toHaveAttribute('data-state', 'ready');
  await expect(status).toContainText('Ready');
  await expect(toast).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('flylog_offline_ready_notified'))).toBe('1');

  await page.reload();
  await expect(status).toHaveAttribute('data-state', 'ready');
  await expect(toast).toHaveCount(0);

  // Translated with the rest of the UI.
  await page.locator('#langSelect').selectOption('uk');
  await expect(status).toContainText('Готово');
});

test('same-origin requests outside /FlyLog/ are not handled or cached', async ({ page, app }) => {
  fs.writeFileSync(path.join(app.dir, 'extra.txt'), 'in scope');
  app.server.routes.set('/FlySend/data.txt', { body: 'sibling app' });
  await install(page, app);
  const [outside, inside] = await page.evaluate(async () => [
    await (await fetch('/FlySend/data.txt')).text(),
    await (await fetch('./extra.txt')).text(),
  ]);
  expect([outside, inside]).toEqual(['sibling app', 'in scope']);
  const urls = await cachedUrls(page);
  expect(urls).toContain(app.abs('./extra.txt')); // in scope: cached (control)
  expect(urls).not.toContain(new URL('/FlySend/data.txt', app.url).href);
});

test('activation deletes old FlyLog caches but keeps sibling apps\' caches', async ({ page, app }) => {
  app.server.routes.set('/blank.html', { body: '<!doctype html><title>blank</title>', type: 'text/html' });
  await page.goto(new URL('/blank.html', app.url).href);
  await page.evaluate(async () => {
    await (await caches.open('flylog-cache-v1')).put('/FlyLog/old.txt', new Response('old'));
    await (await caches.open('flysend-cache-v1')).put('/FlySend/index.html', new Response('sibling'));
  });
  await install(page, app);
  await expect.poll(() => page.evaluate(() => caches.keys()).then((k) => k.sort()))
    .toEqual([CACHE, 'flysend-cache-v1'].sort());
  expect(await page.evaluate(async () => (await caches.match('/FlySend/index.html')).text())).toBe('sibling');
});

test('a browser without service workers or Cache Storage shows the neutral state, error-free', async ({ page, app, pageErrors }) => {
  await page.addInitScript(() => {
    delete Navigator.prototype.serviceWorker;
    delete window.caches;
  });
  await page.goto(app.url);
  expect(await page.evaluate(() => 'serviceWorker' in navigator || 'caches' in window)).toBe(false);
  await expect(page.locator('#offlineStatus')).toHaveAttribute('data-state', 'unsupported');
  await expect(page.locator('#offlineStatus')).toContainText('Not available');
  await expectFullApp(page);
  expect(pageErrors).toEqual([]);
});
