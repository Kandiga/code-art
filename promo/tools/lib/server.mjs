// Static + frame-receiving HTTP server for the renderer page.
//   GET  /...                 static files from promo/ (the page, engine, three, fonts, shared cues)
//   GET  /cache/frames/N.jpg  pass-1 small frames (read back by the Droste recap)
//   POST /frame?i=N           full-res frame -> {framesDir}/NNNNN.jpg   (notifies onFrame)
//   POST /cache?i=N           small frame    -> cache/frames/NNNNN.jpg
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css' };
const pad = (n) => String(n).padStart(5, '0');

export function startServer({ root, port = 0, framesDir = null, cacheDir = null, onFrame = null } = {}) {
  root = path.resolve(root); cacheDir = cacheDir || path.join(root, 'cache', 'frames');
  fs.mkdirSync(cacheDir, { recursive: true }); if (framesDir) fs.mkdirSync(framesDir, { recursive: true });
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), p = decodeURIComponent(u.pathname);
    if (req.method === 'POST' && (p === '/frame' || p === '/cache')) {
      const i = Number(u.searchParams.get('i')), chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const buf = Buffer.concat(chunks), dir = p === '/frame' ? framesDir : cacheDir;
        if (!dir) { res.writeHead(400); return res.end('no dir'); }
        const f = path.join(dir, pad(i) + '.jpg'), tmp = f + '.part';
        fs.writeFileSync(tmp, buf); fs.renameSync(tmp, f);
        if (p === '/frame' && onFrame) onFrame(i, buf.length);
        res.writeHead(200); res.end('ok');
      });
      return;
    }
    let f = path.join(root, p);
    if (p.startsWith('/cache/frames/')) f = path.join(cacheDir, path.basename(p));
    if (!f.startsWith(root) && !f.startsWith(cacheDir)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({ srv, port: srv.address().port, close: () => new Promise((r) => srv.close(r)) })));
}
