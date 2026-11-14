const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { swLists } = require('./support/sw-lists');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Collect references from script src, link (stylesheet/manifest/icon) href, img src.
function references() {
  const refs = [];
  const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i')) || [])[1];
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    const v = attr(tag, 'src'); if (v) refs.push({ tag: 'script', url: v });
  }
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    const v = attr(tag, 'href');
    if (v && /(stylesheet|manifest|icon)/.test(rel)) refs.push({ tag: `link ${rel}`, url: v });
  }
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    const v = attr(tag, 'src'); if (v) refs.push({ tag: 'img', url: v });
  }
  return refs;
}
const isRemote = (u) => /^(https?:)?\/\//i.test(u);
const isLocal = (u) => !isRemote(u) && !/^(data|blob|javascript):/i.test(u) && !u.startsWith('#');

test('references are found', () => {
  expect(references().length).toBeGreaterThanOrEqual(6);
});

test('index.html loads nothing from an external origin', () => {
  expect(references().filter((r) => isRemote(r.url))).toEqual([]);
});

test('every local file referenced by index.html exists', () => {
  const missing = references().filter((r) => isLocal(r.url))
    .filter((r) => !fs.existsSync(path.join(ROOT, r.url.split(/[?#]/)[0])));
  expect(missing).toEqual([]);
});

test('every icon in manifest.json exists', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  expect(manifest.icons.length).toBeGreaterThan(0);
  const missing = manifest.icons.map((i) => i.src).filter((s) => !fs.existsSync(path.join(ROOT, s)));
  expect(missing).toEqual([]);
});

// Local path relative to the repo root, without ./, query or hash.
const norm = (u) => path.posix.normalize(u.split(/[?#]/)[0]).replace(/^\.\//, '');

test('sw.js caches every local file the app needs, and only files that exist', () => {
  const { shell, vendor } = swLists();
  const listed = [...shell, ...vendor].map(norm);
  const needed = new Set(['index.html']);
  for (const r of references()) if (isLocal(r.url)) needed.add(norm(r.url));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  for (const icon of manifest.icons) needed.add(norm(icon.src));
  // Fonts the vendored CSS loads: its woff2 sources (every supported browser
  // picks woff2; the .ttf fallback it also names is deliberately not vendored).
  for (const css of [...needed].filter((f) => f.endsWith('.css'))) {
    const text = fs.readFileSync(path.join(ROOT, css), 'utf8');
    for (const [, url] of text.matchAll(/url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/g)) {
      needed.add(norm(path.posix.join(path.posix.dirname(css), url)));
    }
  }
  expect(needed).toContain('vendor/fontawesome-free-6.4.0/webfonts/fa-solid-900.woff2');
  expect([...needed].filter((f) => !listed.includes(f))).toEqual([]);
  expect(listed.filter((f) => !fs.existsSync(path.join(ROOT, f)))).toEqual([]);
  // Versioned vendor files are never re-fetched once cached, so every one must carry a version.
  expect(vendor.filter((u) => !/\d+\.\d+\.\d+/.test(u))).toEqual([]);
});

test('en, uk and pt-BR have identical translation keys', async ({ page }) => {
  // `translations` is a top-level const in index.html's inline script.
  await page.goto('/index.html');
  const keys = await page.evaluate(() => {
    const out = {};
    // Plural forms (_one/_few/_many/...) legitimately differ per language (uk has few/many),
    // so compare the base key with the CLDR plural suffix stripped.
    const base = (k) => k.replace(/_(zero|one|two|few|many|other)$/, '');
    for (const lang of Object.keys(translations)) {
      out[lang] = [...new Set(Object.keys(translations[lang]).map(base))].sort();
    }
    return out;
  });
  expect(Object.keys(keys).sort()).toEqual(['en', 'pt-BR', 'uk']);
  for (const lang of ['uk', 'pt-BR']) {
    expect({ lang, missing: keys.en.filter((k) => !keys[lang].includes(k)) }).toEqual({ lang, missing: [] });
    expect({ lang, extra: keys[lang].filter((k) => !keys.en.includes(k)) }).toEqual({ lang, extra: [] });
  }
});
