// lab.mjs — open any page from promo/ (e.g. web/lab/amrita2d.html), wait for window.__done===true, screenshot it.
//   node tools/lab.mjs --page web/lab/amrita2d.html --out out/stills/amrita2d_lab.png [--w 1920] [--h 1080] [--scale 1]
// Lab pages import the engine (`import '/web/engine/main.js'`), then `await window.film.init({scale})` and use `window.film.S`
// (the same services object scenes get). Draw into any canvas appended to document.body, then set window.__done = true.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './lib/server.mjs';
import { launch } from './lib/browser.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const w = Number(args.w || 1920), h = Number(args.h || 1080), out = path.resolve(ROOT, args.out || 'out/stills/lab.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
const { port, close } = await startServer({ root: ROOT });
const browser = await launch(); let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('console', (m) => console.log('[page]', m.text().slice(0, 500)));
  page.on('pageerror', (e) => { console.log('[pageerror]', e.message); code = 1; });
  await page.goto(`http://127.0.0.1:${port}/${args.page}`);
  await page.waitForFunction('window.__done===true', null, { timeout: Number(args.timeout || 90000) });
  await page.screenshot({ path: out, fullPage: false });
  console.log('LAB', out);
} finally { await browser.close(); await close(); }
process.exit(code);
