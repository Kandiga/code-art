// still.mjs — render stills of the film at chosen times and tile them into a labelled contact sheet.
//   node tools/still.mjs --t 4.5,5,5.5 [--scale 0.5] [--tag name] [--cols 3] [--out out/stills] [--no-sheet] [--sub 4]
//   node tools/still.mjs --range 4,6,0.25        (t0,t1,step)
//   node tools/still.mjs --scene e1895 [--n 8]   (n evenly spaced stills across a scene)
// Prints per-frame ms, scene id, warnings/errors from the page, and text-rect collisions.
// Output: <out>/<tag>_<t>.png (unlabelled) and <out>/<tag>_sheet.png (labelled contact sheet).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from './lib/server.mjs';
import { launch } from './lib/browser.mjs';
import * as cues from '../shared/cues.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const scale = Number(args.scale ?? 0.5), tag = args.tag || 'still', outDir = path.resolve(ROOT, args.out || 'out/stills'), cols = Number(args.cols || 3), sub = Number(args.sub ?? 4);
fs.mkdirSync(outDir, { recursive: true });

let times = [];
if (args.t) times = String(args.t).split(',').map(Number);
else if (args.range) { const [a, b, s] = String(args.range).split(',').map(Number); for (let t = a; t <= b + 1e-9; t += s) times.push(+t.toFixed(4)); }
else if (args.scene) {
  const sc = cues.sceneById(args.scene); if (!sc) { console.error('unknown scene', args.scene); process.exit(2); }
  const n = Number(args.n || 8); for (let i = 0; i < n; i++) times.push(+(sc.t0 + ((i + 0.5) / n) * (sc.t1 - sc.t0)).toFixed(4));
} else { console.error('give --t, --range or --scene'); process.exit(2); }

const { port, close } = await startServer({ root: ROOT });
const browser = await launch();
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' || /warn|fail|error/i.test(tx)) console.log('[page]', tx.slice(0, 600)); });
  page.on('pageerror', (e) => { console.log('[pageerror]', e.message); code = 1; });
  await page.goto(`http://127.0.0.1:${port}/web/index.html`);
  await page.waitForFunction('window.__filmReady===true', null, { timeout: 60000 });
  const info = await page.evaluate((o) => window.film.init(o), { scale, subframes: sub });
  console.log('init', JSON.stringify(info));
  const files = [];
  for (const t of times) {
    const r = await page.evaluate(async (tt) => {
      const res = await window.film.renderFrame(tt);
      // labelled copy for the sheet
      const f = window.film, W = f.W, H = f.H, lab = Math.round(30 * f.scale * 1.3), c = document.createElement('canvas'); c.width = W; c.height = H + lab;
      const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, W, H + lab); g.drawImage(f.out, 0, 0);
      g.fillStyle = '#fff'; g.font = `${Math.round(18 * f.scale * 1.3)}px monospace`; g.textBaseline = 'middle'; g.fillText(`t=${tt.toFixed(3)}  f=${Math.round(tt * 30)}  ${res.scene}`, 8, H + lab / 2);
      return { res, raw: f.out.toDataURL('image/png'), labelled: c.toDataURL('image/png') };
    }, t);
    const base = path.join(outDir, `${tag}_${t.toFixed(3)}`);
    fs.writeFileSync(base + '.png', Buffer.from(r.raw.split(',')[1], 'base64'));
    fs.writeFileSync(base + '.lab.png', Buffer.from(r.labelled.split(',')[1], 'base64'));
    files.push(base + '.lab.png');
    const rects = r.res.rects, coll = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], b = rects[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) coll.push(`${a.id}x${b.id}`); }
    console.log(`t=${t.toFixed(3)} ${r.res.scene} ${Math.round(r.res.ms)}ms${r.res.warnings.length ? ' WARN: ' + r.res.warnings.join(' | ') : ''}${coll.length ? ' TEXT-COLLISION: ' + coll.join(',') : ''}`);
  }
  if (!args['no-sheet'] && files.length) {
    const rows = Math.ceil(files.length / cols), sheet = path.join(outDir, `${tag}_sheet.png`);
    const tw = Math.round(1920 * Math.min(1, 640 / (1920 * scale)) ) ; // each tile ~640 px wide
    const list = path.join(outDir, `${tag}_list.txt`);
    fs.writeFileSync(list, files.map((f) => `file '${f}'\nduration 1`).join('\n') + `\nfile '${files[files.length - 1]}'\n`);
    const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=${Math.min(640, Math.round(1920 * scale))}:-1,tile=${cols}x${rows}:padding=4:color=0x222222`, '-frames:v', '1', sheet], { encoding: 'utf8' });
    if (r.status !== 0) console.log('ffmpeg sheet failed', r.stderr); else console.log('SHEET', sheet);
  }
} finally { await browser.close(); await close(); }
process.exit(code);
