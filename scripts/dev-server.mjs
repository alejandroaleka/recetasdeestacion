/**
 * T6 (S7): Lightweight development application server.
 *
 * Serves the static `dist/` build on `127.0.0.1` and, only when
 * `envMode === 'development'`, mounts the internal simulator at
 * `/__dev/simulador` via `renderSimulatorPage({ envMode })`.
 * In `production` both `/__dev/simulador` and `/keystatic*` answer 404.
 *
 * Exported as `createAppServer({ distDir, envMode })` so tests can start
 * it deterministically on an ephemeral port without touching the CLI.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderSimulatorPage } from '../src/dev/simulator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

function contentTypeFor(filename) {
  if (path.basename(filename) === '_headers') return 'text/plain; charset=utf-8';
  const ext = path.extname(filename).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

function isKeystaticPath(pathname) {
  return (
    pathname === '/keystatic' ||
    pathname.startsWith('/keystatic/') ||
    pathname === '/api/keystatic' ||
    pathname.startsWith('/api/keystatic/')
  );
}

function isSimulatorPath(pathname) {
  return pathname === '/__dev/simulador' || pathname.startsWith('/__dev/simulador/');
}

function send(response, status, body, contentType = 'text/plain; charset=utf-8') {
  const payload = String(body ?? '');
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(payload)
  });
  response.end(payload);
}

/**
 * Creates the application server. `listen(port)` binds to `127.0.0.1`
 * (defaulting to an ephemeral port with `0`) and resolves the bound port.
 */
export function createAppServer({ distDir = path.join(ROOT, 'dist'), envMode = 'production' } = {}) {
  const root = path.resolve(distDir);

  const server = http.createServer((request, response) => {
    let pathname = '/';
    try {
      pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      pathname = '/';
    }

    if (isSimulatorPath(pathname)) {
      const page = renderSimulatorPage({ envMode });
      if (!page.allowed) {
        send(response, 404, 'No encontrado: el simulador interno solo existe en desarrollo.');
        return;
      }
      send(response, 200, page.html, 'text/html; charset=utf-8');
      return;
    }

    if (isKeystaticPath(pathname)) {
      send(response, 404, 'No encontrado: /keystatic solo existe en desarrollo local.');
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'Método no permitido.');
      return;
    }

    const decoded = decodeURIComponent(pathname);
    const candidate = path.normalize(path.join(root, decoded.replace(/^\/+/, '')));
    if (candidate !== root && !candidate.startsWith(root + path.sep)) {
      send(response, 404, 'No encontrado.');
      return;
    }

    let filePath = candidate;
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch {
      // Fall through to the missing-file branch below.
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      send(response, 404, 'No encontrado.');
      return;
    }

    try {
      const body = fs.readFileSync(filePath);
      response.writeHead(200, {
        'content-type': contentTypeFor(filePath),
        'content-length': body.length
      });
      if (request.method === 'HEAD') response.end();
      else response.end(body);
    } catch {
      send(response, 500, 'Error interno al leer el archivo.');
    }
  });

  return {
    server,
    envMode,
    distDir: root,
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          const address = server.address();
          resolve(typeof address === 'object' && address ? address.port : port);
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const envMode = process.env.NODE_ENV === 'development' ? 'development' : 'production';
  const port = Number(process.env.PORT ?? 4173);
  const app = createAppServer({ distDir: path.join(ROOT, 'dist'), envMode });
  await app.listen(Number.isFinite(port) ? port : 4173);
  console.log(`Recetario dev server (${envMode}) en http://127.0.0.1:${Number.isFinite(port) ? port : 4173}/`);
}
