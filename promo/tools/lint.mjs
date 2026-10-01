// lint.mjs — render EVERY frame cheaply (scale 0.25, 1 sub-frame) and flag: scene errors/warnings, text-rect collisions,
// black / flat (empty) frames, and per-scene cost. Output: out/lint.json + printed summary.
//   node tools/lint.mjs [--step 1] [--from 0 --to 1800] [--scale 0.25] [--workers 2]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './lib/server.mjs';
import { launch } from './lib/browser.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const step = Number(args.step ?? 1), FROM = Number(args.from ?? 0), TO = Number(args.to ?? 1800), scale = Number(args.scale ?? 0.25), N = Number(args.workers ?? 2);
const { port, close } = await startServer({ root: ROOT });
const idxs = []; for (let i = FROM; i < TO; i += step) idxs.push(i);
const results = new Array(idxs.length);
async function lane(k) {
  const browser = await launch(); const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/web/index.html`); await page.waitForFunction('window.__filmReady===true');
  await page.evaluate((o) => window.film.init(o), { scale, subframes: 1 });
  for (let j = k; j < idxs.length; j += N) { try { results[j] = await page.evaluate((t) => window.film.lintFrame(t), idxs[j] / 30); } catch (e) { results[j] = { t: idxs[j] / 30, error: String(e.message).slice(0, 200) }; } }
  await browser.close();
}
await Promise.all(Array.from({ length: N }, (_, k) => lane(k)));
await close();
const flags = [], by = {};
for (const r of results) {
  if (!r) continue; const f = Math.round(r.t * 30);
  if (r.error) { flags.push(`f${f} t=${r.t.toFixed(2)} ERROR ${r.error}`); continue; }
  (by[r.scene] ||= { n: 0, ms: 0 }); by[r.scene].n++; by[r.scene].ms += r.ms;
  if (r.warnings.length) flags.push(`f${f} t=${r.t.toFixed(2)} ${r.scene} WARN ${r.warnings.join(' | ').slice(0, 160)}`);
  const allowedBlack = r.t < 1.0 || r.t >= 59.6; // cold-open darkness; projector click-off at the very end
  if (!allowedBlack && (r.mean < 5 || r.std < 2.5)) flags.push(`f${f} t=${r.t.toFixed(2)} ${r.scene} BLACK/FLAT mean=${r.mean} std=${r.std}`);
  const R = r.rects; for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) { const a = R[i], b = R[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) flags.push(`f${f} t=${r.t.toFixed(2)} TEXT-COLLISION ${a.id} x ${b.id}`); }
}
fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'out/lint.json'), JSON.stringify({ results, flags }, null, 1));
console.log('per-scene avg ms @scale', scale + ':', Object.entries(by).map(([k, v]) => `${k}:${Math.round(v.ms / v.n)}`).join(' '));
console.log(flags.length ? flags.slice(0, 120).join('\n') + (flags.length > 120 ? `\n... ${flags.length - 120} more` : '') : 'LINT CLEAN');
console.log('flags:', flags.length);
