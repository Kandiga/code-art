// mkcache.mjs — render small (1280x720) frames of THIS film into cache/frames/NNNNN.jpg: the source for the Droste recap.
//   node tools/mkcache.mjs --from 0 --to 1500 --step 30 [--sub 1]      (indices are frame numbers 0..1799; step 30 = 1 per second)
// The full render pipeline does this automatically for frames < 1500; use this tool to TEST the recap with whatever the film looks like now.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './lib/server.mjs';
import { launch } from './lib/browser.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const from = Number(args.from ?? 0), to = Number(args.to ?? 1500), step = Number(args.step ?? 30), sub = Number(args.sub ?? 1);
const { port, close } = await startServer({ root: ROOT });
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/web/index.html`);
  await page.waitForFunction('window.__filmReady===true');
  await page.evaluate((o) => window.film.init(o), { scale: 0.667, subframes: sub });
  let n = 0;
  for (let f = from; f < to; f += step) {
    await page.evaluate(async ([ff, port2]) => { await window.film.renderFrame(ff / 30); const c = document.createElement('canvas'); c.width = 1280; c.height = 720; c.getContext('2d').drawImage(window.film.out, 0, 0, 1280, 720); const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)); await fetch(`/cache?i=${ff}`, { method: 'POST', body: b }); }, [f, port]);
    n++;
  }
  console.log('cached', n, 'frames into', path.join(ROOT, 'cache/frames'));
} finally { await browser.close(); await close(); }
