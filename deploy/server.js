/* Local dev server — `bun dev`.
   Serves ./public statically and routes /api/* to the same handlers Vercel runs,
   so what you test locally is what deploys. */

import { stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { handle as stateHandler } from './api/state.js';
import { handle as catalogHandler } from './api/catalog.js';

const PORT = +(process.env.PORT || 3000);
const PUBLIC = './public';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};

const ROUTES = {
  '/api/state': stateHandler,
  '/api/catalog': catalogHandler
};

async function serveFile(path) {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
  } catch {
    return null;
  }
  const file = Bun.file(path);
  const type = MIME[extname(path).toLowerCase()];
  return new Response(file, {
    headers: {
      'content-type': type || file.type || 'application/octet-stream',
      'cache-control': 'no-store'
    }
  });
}

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    const route = ROUTES[url.pathname];
    if (route) return route(request);

    const safe = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const direct = await serveFile(join(PUBLIC, safe));
    if (direct) return direct;

    const index = await serveFile(join(PUBLIC, 'index.html'));
    if (index) return index;

    return new Response('Not found', { status: 404 });
  }
});

const { storeKind, storeLabel } = await import('./lib/store.js');
console.log('edly estimator → http://localhost:' + server.port);
console.log('store          → ' + storeKind() + '  (' + (await storeLabel()) + ')');
console.log('catalog sheet  → ' + PUBLIC + '/catalog-source.xlsx');
