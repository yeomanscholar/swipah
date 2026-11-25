// Tiny static file server for local dev and tests (no dependencies).
// Usage: node tests/server.js [port]   → http://localhost:5173/

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.md': 'text/markdown; charset=utf-8',
};

export function startServer(port = 0) {
  const server = http.createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = normalize(join(ROOT, path));
      if (!file.startsWith(ROOT + sep)) throw new Error('outside root');
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startServer(Number(process.argv[2] || 5173));
  console.log(`Swipah dev server: http://localhost:${server.address().port}/`);
}
