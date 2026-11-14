// Reads the SHELL_URLS / VENDOR_URLS lists out of sw.js so tests stay in sync with it.
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./server');

function swLists(root = REPO_ROOT) {
  const src = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const grab = (name) => {
    const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
    if (!m) throw new Error(`sw.js: ${name} not found`);
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };
  const cacheName = (src.match(/const CACHE_NAME = CACHE_PREFIX \+ '([^']+)'/) || [])[1];
  const prefix = (src.match(/const CACHE_PREFIX = '([^']+)'/) || [])[1];
  return { shell: grab('SHELL_URLS'), vendor: grab('VENDOR_URLS'), cacheName: prefix + cacheName };
}

module.exports = { swLists };
