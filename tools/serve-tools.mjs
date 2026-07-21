// Minimal static file server for tools/ itself -- exists so
// phase0-voice-check.html (and anything else dropped in here later) can be
// tested over http://localhost too, not just file://, without polluting
// app/public/ (which gets shipped to the live production deploy on every
// build -- a throwaway diagnostic has no business ending up there). No
// framework, no npm install: just node's own http/fs modules.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4174;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const relative = reqPath === '/' ? 'phase0-voice-check.html' : reqPath.replace(/^\/+/, '');
  const filePath = path.join(here, relative);
  if (!filePath.startsWith(here)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end(`Not found: ${reqPath}`);
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Serving tools/ at http://localhost:${PORT}/ (Ctrl+C to stop)`);
});
