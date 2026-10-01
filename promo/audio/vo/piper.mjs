// =============================================================================
// audio/vo/piper.mjs - tiny, deterministic, offline Piper TTS helper for Node.
//
//   import { speak, speakBatch, synthTakes, PY, MODELS, VOICES } from '../vo/piper.mjs';
//   const buf = await speak('Hello there.', { voice: 'en_US-ryan-high', lengthScale: 1.05 });
//   // -> Buf (audio/lib/core.mjs: stereo Float32 @ 48 kHz, dual-mono), plus buf.words / buf.dur
//
// Python (venv):  audio/vo/.venv/bin/python        (set up by audio/vo/setup.sh)
// Voice models :  audio/vo/models/<voice>.onnx(.json)   (gitignored, downloaded by setup.sh)
// Deterministic:  the ONNX graph's RandomNormalLike nodes are seeded -> same (text, voice, seed,
//                 scales) => bit-identical samples. Pass `seed` to get a different "take".
//
// Options (all optional):
//   voice          'en_US-ryan-high' (default) - any model stem in audio/vo/models
//   speaker        speaker id for multi-speaker voices (en_US-libritts-high: 904 speakers)
//   seed           integer RNG seed (default 1)
//   lengthScale    phoneme length (1 = natural, >1 slower, <1 faster)       default 1
//   noiseScale     generator noise (expressiveness / breathiness)            default 0.667
//   noiseW         phoneme-width noise (rhythm variation)                    default 0.8
//   sentenceSilence seconds of silence between sentences                     default 0
//   segments       advanced: [{text,lengthScale,noiseScale,noiseW,gapAfter}] one phrase each with
//                  its own prosody; text may use inline markup  army{v1.5}  (see synth.py)
//   cache          true (default) -> raw takes cached in audio/build/vo/cache (gitignored)
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VO_DIR = HERE;
export const PY = path.join(HERE, '.venv', 'bin', 'python');
export const MODELS = path.join(HERE, 'models');
export const SYNTH = path.join(HERE, 'synth.py');
export const DEFAULT_CACHE = path.resolve(HERE, '..', 'build', 'vo', 'cache');

export const VOICES = [
  'en_US-ryan-high', 'en_GB-cori-high', 'en_GB-alan-medium', 'en_US-lessac-high', 'en_US-kristin-medium',
  'en_GB-northern_english_male-medium', 'en_GB-jenny_dioco-medium', 'en_US-hfc_female-medium',
  'en_GB-alba-medium', 'en_US-libritts-high', 'en_US-hfc_male-medium', 'en_US-john-medium',
  'en_US-norman-medium', 'en_US-joe-medium', 'en_US-sam-medium', 'en_US-mike-medium', 'en_US-bryce-medium',
  'en_US-lessac-medium',
];

let _lib = null;
async function lib() {
  if (_lib) return _lib;
  // prefer the shared dsp lib (re-exports core), fall back to core
  for (const f of ['../lib/dsp.mjs', '../lib/core.mjs']) {
    try {
      const m = await import(f);
      if (m.readWav && m.Buf) return (_lib = m);
    } catch { /* try next */ }
  }
  throw new Error('piper.mjs: audio/lib/core.mjs (readWav, Buf) not found');
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}\n${err.slice(-2000)}`))));
  });
}

const normSeg = (s) => ({
  text: s.text,
  length_scale: s.lengthScale ?? s.length_scale ?? 1,
  noise_scale: s.noiseScale ?? s.noise_scale ?? 0.667,
  noise_w: s.noiseW ?? s.noise_w ?? 0.8,
  gap_after: s.gapAfter ?? s.gap_after ?? 0,
  sentence_silence: s.sentenceSilence ?? s.sentence_silence ?? 0,
});

/** Normalise a high-level request into a synth.py job (without `out`). */
export function toJob(text, o = {}) {
  const segments = (o.segments || [{ text, ...o }]).map((s) => normSeg({ ...o, ...s, text: s.text ?? text }));
  return { id: o.id || 'take', voice: o.voice || 'en_US-ryan-high', speaker: o.speaker ?? 0, seed: o.seed ?? 1, segments };
}

export const jobKey = (job) =>
  crypto.createHash('sha1').update(JSON.stringify({ v: 3, ...job, id: undefined, out: undefined })).digest('hex').slice(0, 16);

/**
 * Low level: run jobs through synth.py in ONE python process (model loads amortised).
 * jobs: [{id, voice, seed, speaker, segments:[...], out}]  -> [{id,out,sr,dur,words}]
 */
export async function synthTakes(jobs) {
  if (!fs.existsSync(PY)) throw new Error(`piper.mjs: ${PY} missing - run audio/vo/setup.sh`);
  if (!jobs.length) return [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piper-'));
  try {
    const jf = path.join(tmp, 'jobs.json');
    fs.writeFileSync(jf, JSON.stringify({ jobs }));
    const out = await run('nice', ['-n', '10', PY, SYNTH, jf], { cwd: HERE });
    return JSON.parse(out.trim().split('\n').pop());
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Synthesize many requests at once: [[text, opts], ...] -> Buf[] (same order). */
export async function speakBatch(reqs) {
  const { readWav } = await lib();
  const cacheDir = DEFAULT_CACHE;
  fs.mkdirSync(cacheDir, { recursive: true });
  const todo = [];
  const items = reqs.map(([text, o = {}], i) => {
    const job = toJob(text, o);
    const key = jobKey(job);
    const wav = path.join(o.cacheDir || cacheDir, `${job.voice}.${key}.wav`);
    const use = o.cache !== false;
    if (!(use && fs.existsSync(wav))) todo.push({ ...job, id: String(i), out: wav });
    return { wav, i, key };
  });
  const res = await synthTakes(todo);
  const words = new Map(res.map((r) => [r.out, r.words]));
  return items.map(({ wav }) => {
    const b = readWav(wav);
    b.dur = b.length / 48000;
    b.words = words.get(wav) || (fs.existsSync(wav.replace(/\.wav$/, '.words.json')) ? JSON.parse(fs.readFileSync(wav.replace(/\.wav$/, '.words.json'), 'utf8')) : []);
    return b;
  });
}

/** speak(text, opts) -> Buf (48 kHz, dual-mono) with .dur and .words ([{w,t0,t1}] in seconds). */
export async function speak(text, opts = {}) {
  return (await speakBatch([[text, opts]]))[0];
}

export default speak;
