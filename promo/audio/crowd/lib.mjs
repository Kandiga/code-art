// =============================================================================
// audio/crowd/lib.mjs - the voice / hand-clap library (built by py/build_lib.py into audio/crowd/lib/).
//   const L = await openLibrary();            // builds the library on first use (python venv from audio/vo)
//   L.pool('words','whoa')                    // [meta,...]
//   L.clip(meta)                              // {x: Float32Array mono 48 kHz, meta, onset(s)}
//   L.claps / L.clapArr(index)                // packed hand-claps
// Usage tracking (L.use) makes the picker prefer clips nobody has used yet, so ~every voice in the film is a different "person".
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readWav } from '../lib/dsp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LIB_DIR = path.join(HERE, 'lib');
export const MANIFEST = path.join(LIB_DIR, 'manifest.json');
const PY = path.join(HERE, '..', 'vo', '.venv', 'bin', 'python');

function runPy(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', '12', PY, path.join(HERE, 'py', 'build_lib.py'), ...args], { cwd: path.join(HERE, 'py'), stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('build_lib.py exited ' + c))));
  });
}

/** true when every group the renderer needs is present in the manifest */
export function libraryComplete() {
  if (!fs.existsSync(MANIFEST) || !fs.existsSync(path.join(LIB_DIR, 'claps.wav'))) return false;
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const g = new Set(m.clips.map((c) => c.group));
  return ['words', 'synth', 'walla', 'whistles'].every((x) => g.has(x)) && (m.claps || []).length >= 100;
}

export async function ensureLibrary({ build = true } = {}) {
  if (libraryComplete()) return;
  if (!build) throw new Error('crowd library missing: run `node audio/crowd/render.mjs --build-lib`');
  console.log('[crowd] building voice/clap library (one-time, cached in audio/crowd/lib) ...');
  await runPy([]);
  if (!libraryComplete()) throw new Error('crowd library incomplete after build');
}

export class Library {
  constructor() {
    this.manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    this.clips = this.manifest.clips;
    this.byId = new Map(this.clips.map((c) => [c.id, c]));
    this._x = new Map();
    this.used = new Map();
    this.claps = this.manifest.claps;
    this._clapWav = null;
  }
  pool(group, tag, filter = null) {
    return this.clips.filter((c) => c.group === group && (tag == null || c.tag === tag) && (!filter || filter(c)));
  }
  /** decoded mono Float32Array (cached) */
  samples(meta) {
    let x = this._x.get(meta.id);
    if (!x) {
      x = readWav(path.join(LIB_DIR, meta.file)).L;
      this._x.set(meta.id, x);
    }
    return x;
  }
  clip(meta) {
    return { x: this.samples(meta), meta, onset: meta.onset };
  }
  uses(meta) {
    return this.used.get(meta.id) || 0;
  }
  use(meta) {
    this.used.set(meta.id, this.uses(meta) + 1);
  }
  /** pick from a weighted list of candidate pools, preferring never-used clips and persons not in `avoidPersons`. */
  pick(spec, rng, avoidPersons = new Set()) {
    // choose the pool by weight, then the least-used clip in it (random among ties)
    const tot = spec.reduce((a, s) => a + s.w, 0);
    let r = rng() * tot;
    let s = spec[spec.length - 1];
    for (const q of spec) {
      if ((r -= q.w) <= 0) {
        s = q;
        break;
      }
    }
    let cands = this.pool(s.group, s.tag, s.filter);
    if (!cands.length) cands = spec.flatMap((q) => this.pool(q.group, q.tag, q.filter));
    if (!cands.length) throw new Error('crowd: empty pool for ' + JSON.stringify(s));
    const ok = cands.filter((c) => !avoidPersons.has(c.person));
    if (ok.length) cands = ok;
    let best = Infinity;
    for (const c of cands) best = Math.min(best, this.uses(c));
    cands = cands.filter((c) => this.uses(c) === best);
    const c = cands[Math.floor(rng() * cands.length)];
    this.use(c);
    return c;
  }
  clapWav() {
    if (!this._clapWav) this._clapWav = readWav(path.join(LIB_DIR, 'claps.wav')).L;
    return this._clapWav;
  }
  clapArr(i) {
    const c = this.claps[i];
    return this.clapWav().subarray(c.start, c.start + c.len);
  }
}

export async function openLibrary(opts = {}) {
  await ensureLibrary(opts);
  return new Library();
}
