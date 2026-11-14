// Minimal dependency-free static file server.
//
// CLI (used by playwright.config.js): serves the repo root at / on $PORT.
// Library: startServer({ root, mount, port }) serves `root` under the URL path
// `mount` (e.g. '/FlyLog/', mirroring GitHub Pages sub-path hosting) and
// returns controls a test can flip:
//   server.hang = true      every new request is left unanswered (dead-slow network)
//   server.routes.set(p, { body, type })   fixed responses for paths outside the mount
//   server.requests         [{ method, path }] of every request received
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function startServer({ root = REPO_ROOT, mount = '/', port = 0 } = {}) {
  root = path.resolve(root);
  if (!mount.startsWith('/')) mount = '/' + mount;
  if (!mount.endsWith('/')) mount += '/';

  const sockets = new Set();
  const controls = { hang: false, routes: new Map(), requests: [] };

  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    controls.requests.push({ method: req.method, path: pathname });
    if (controls.hang) return; // never answer; the socket is destroyed on close()

    if (controls.routes.has(pathname)) {
      const { body, type = 'text/plain; charset=utf-8' } = controls.routes.get(pathname);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }).end(body);
      return;
    }
    if (pathname + '/' === mount) {
      res.writeHead(301, { Location: mount }).end();
      return;
    }
    if (!pathname.startsWith(mount)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    let rel = pathname.slice(mount.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      const actualPort = server.address().port;
      const origin = `http://localhost:${actualPort}`;
      resolve(Object.assign(controls, {
        port: actualPort,
        origin,
        url: origin + mount,
        close() {
          for (const socket of sockets) socket.destroy();
          return new Promise((done) => server.close(() => done()));
        },
      }));
    });
  });
}

module.exports = { startServer, REPO_ROOT };

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 4173;
  startServer({ root: REPO_ROOT, mount: '/', port: PORT })
    .then((s) => console.log(`Serving ${REPO_ROOT} on ${s.url}`))
    .catch((err) => { console.error(err); process.exit(1); });
}
