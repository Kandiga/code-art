// render.mjs — render the film deterministically in parallel and encode with ffmpeg.
//   node tools/render.mjs --scale 1 --tag 1080p --workers 3 [--from 0 --to 1800] [--resume] [--crf 15] [--preset slow] [--sub 4]
//        [--out out/amrita_video_1080p.mp4] [--assemble-only] [--q 0.95]
// Plan: frames 0..1499 in PARALLEL (interleaved start=k step=N) -> recap frames 1500..1619 SEQUENTIAL in one worker (each frame references
// EARLIER frames through the small cache: Droste) -> end card 1620..1799 in PARALLEL. Every frame is saved as <cache>/frames_<tag>/NNNNN.jpg
// (resume-safe) and fed IN ORDER into ffmpeg (image2pipe -> libx264) as soon as it is contiguous.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from './lib/server.mjs';
import { launch } from './lib/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const scale = Number(args.scale ?? 1), tag = String(args.tag ?? (scale >= 2 ? '4k' : scale >= 1 ? '1080p' : 'preview'));
const N = Number(args.workers ?? 3), FROM = Number(args.from ?? 0), TO = Number(args.to ?? 1800), SUB = Number(args.sub ?? 4);
const CRF = String(args.crf ?? 15), PRESET = String(args.preset ?? 'slow'), Q = Number(args.q ?? 0.95);
const OUT = path.resolve(ROOT, String(args.out ?? `out/amrita_video_${tag}.mp4`));
const FRAMES = path.join(ROOT, 'cache', `frames_${tag}`), RESTART_EVERY = 220;
fs.mkdirSync(FRAMES, { recursive: true }); fs.mkdirSync(path.dirname(OUT), { recursive: true });
const pad = (n) => String(n).padStart(5, '0');
const exists = (i) => fs.existsSync(path.join(FRAMES, pad(i) + '.jpg'));
const SEGMENTS = [{ from: 0, to: 1500, mode: 'par', cache: true }, { from: 1500, to: 1620, mode: 'seq', cache: true }, { from: 1620, to: 1800, mode: 'par', cache: false }]
  .map((s) => ({ ...s, from: Math.max(s.from, FROM), to: Math.min(s.to, TO) })).filter((s) => s.from < s.to);

// ---------- ordered ffmpeg feeder ----------
let ff = null, next = 0, feeding = false, ffDone = null;
const fullRun = FROM === 0 && TO === 1800 && !args['assemble-only'];
function startEncoder(pipe) {
  const vf = 'scale=in_range=full:out_range=limited:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int';
  const common = ['-vf', vf, '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF, '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', '-r', '30', OUT];
  const inArgs = pipe ? ['-f', 'image2pipe', '-framerate', '30', '-vcodec', 'mjpeg', '-i', '-'] : ['-framerate', '30', '-start_number', String(FROM), '-i', path.join(FRAMES, '%05d.jpg'), '-frames:v', String(TO - FROM)];
  ff = spawn('ffmpeg', ['-y', '-v', 'error', ...inArgs, ...common], { stdio: [pipe ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
  ffDone = new Promise((res) => ff.on('close', res));
}
async function feed() {
  if (feeding || !ff || !ff.stdin) return; feeding = true;
  try {
    while (next < TO && exists(next)) {
      const buf = fs.readFileSync(path.join(FRAMES, pad(next) + '.jpg'));
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      next++;
    }
  } finally { feeding = false; }
}

const { port, close } = await startServer({ root: ROOT, framesDir: FRAMES, onFrame: () => { if (fullRun) feed(); } });
const t0 = Date.now(); let done = 0; const total = SEGMENTS.reduce((a, s) => a + (s.to - s.from), 0);
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
log(`render ${tag}: scale ${scale}, workers ${N}, frames ${FROM}..${TO - 1}, crf ${CRF}/${PRESET}`);

async function makeWorker(id) {
  const w = { id, browser: null, page: null, count: 0 };
  w.open = async () => {
    if (w.browser) { try { await w.browser.close(); } catch { /* ignore */ } }
    w.browser = await launch({ slot: false });
    w.page = await w.browser.newPage({ viewport: { width: 1280, height: 720 } });
    w.page.on('pageerror', (e) => console.log(`[w${id} pageerror]`, e.message));
    w.page.on('console', (m) => { if (m.type() === 'error') console.log(`[w${id}]`, m.text().slice(0, 300)); });
    await w.page.goto(`http://127.0.0.1:${port}/web/index.html`);
    await w.page.waitForFunction('window.__filmReady===true', null, { timeout: 60000 });
    await w.page.evaluate((o) => window.film.init(o), { scale, subframes: SUB, quality: Q });
    w.count = 0;
  };
  w.render = async (i, cache) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        if (!w.page || w.count >= RESTART_EVERY) await w.open();
        const r = await w.page.evaluate(([ii, c, q]) => window.film.frameJob(ii, { cache: c, quality: q }), [i, cache, Q]);
        w.count++; if (r.warnings && r.warnings.length) console.log(`[f${i}] ${r.scene} WARN ${r.warnings.join(' | ').slice(0, 300)}`);
        return r;
      } catch (e) { console.log(`[w${id}] frame ${i} attempt ${attempt} failed: ${String(e.message).slice(0, 200)}`); w.page = null; await new Promise((r) => setTimeout(r, 1500)); }
    }
    throw new Error('frame ' + i + ' failed 4x');
  };
  await w.open();
  return w;
}

if (args['assemble-only']) { startEncoder(false); ffDone.then((c) => { log('assembled, ffmpeg exit ' + c); close(); }); }
else {
  if (fullRun) { startEncoder(true); }
  const workers = await Promise.all(Array.from({ length: N }, (_, k) => makeWorker(k)));
  for (const seg of SEGMENTS) {
    const idxs = []; for (let i = seg.from; i < seg.to; i++) if (!(args.resume && exists(i))) idxs.push(i);
    done += (seg.to - seg.from) - idxs.length;
    log(`segment ${seg.from}-${seg.to - 1} ${seg.mode} (${idxs.length} to render)`);
    const lanes = seg.mode === 'seq' ? [idxs] : Array.from({ length: N }, (_, k) => idxs.filter((_, j) => j % N === k));
    await Promise.all(lanes.map(async (lane, k) => {
      for (const i of lane) {
        const r = await workers[k].render(i, seg.cache); done++;
        if (done % 10 === 0 || i === lane[lane.length - 1]) { const el = (Date.now() - t0) / 1000, rate = done / el; log(`frame ${i} (${r.scene}) ${Math.round(r.ms)}ms | ${done}/${total} | ${rate.toFixed(2)} fps | eta ${(((total - done) / rate) / 60).toFixed(1)} min`); fs.writeFileSync(path.join(ROOT, 'out', `render_progress_${tag}.json`), JSON.stringify({ done, total, rate, scene: r.scene, at: new Date().toISOString() })); }
        if (fullRun) feed();
      }
    }));
  }
  await Promise.all(workers.map((w) => w.browser && w.browser.close()));
  if (fullRun) { await feed(); ff.stdin.end(); const c = await ffDone; log('ffmpeg exit ' + c); }
  else if (!args.noencode) { log('range render done (use --assemble-only to encode)'); }
  await close();
  if (fullRun) { const p = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height,duration', '-of', 'csv=p=0', OUT], { encoding: 'utf8' }); log('ffprobe ' + p.stdout.trim() + ' ' + (fs.statSync(OUT).size / 1e6).toFixed(1) + ' MB'); }
}
