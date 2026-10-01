// =============================================================================
// ff.mjs - ffmpeg helpers (ffmpeg 6.1: rubberband, ebur128, showspectrumpic, showwavespic ...)
//   run(args, opts)            sync ffmpeg call with good error output
//   runAsync(args, opts)       same, returns a Promise
//   filterChain(buf, 'af')     pipe a Buf through any ffmpeg -af string, get a Buf back (f32le over pipes)
//   pitchShift(buf, semis)     rubberband (formant-preserving optional)
//   timeStretch(buf, ratio)    rubberband; ratio = new duration / old duration
//   spectrogramPng / wavePng   images for visual QA (view with the Read tool)
//   ebur128(bufOrPath)         ffmpeg loudness summary parsed
//   decodeAny(path)            any audio file -> Buf (48 kHz stereo) via ffmpeg
//   probe(path)                ffprobe JSON
// =============================================================================
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SR, Buf, isBuf, writeWav, ensureDir } from './core.mjs';
import { reverb } from './verb.mjs';

export class FfmpegError extends Error {
  constructor(msg, info) {
    super(msg);
    this.name = 'FfmpegError';
    Object.assign(this, info);
  }
}
const tail = (s, n = 25) => String(s).trim().split('\n').slice(-n).join('\n');

function buildArgs(args, opts) {
  const a = [...args];
  const pre = ['-hide_banner', '-nostdin'];
  if (!a.includes('-loglevel') && !a.includes('-v')) pre.push('-loglevel', opts.loglevel || 'error');
  if (opts.y !== false && !a.includes('-y') && !a.includes('-n')) pre.push('-y');
  return [...pre, ...a];
}

/** run ffmpeg synchronously. opts: {input: Buffer, loglevel, bin='ffmpeg', cwd, timeoutMs} -> {stdout: Buffer, stderr: string} */
export function run(args, opts = {}) {
  const full = buildArgs(args, opts);
  const bin = opts.bin || 'ffmpeg';
  const r = spawnSync(bin, full, { input: opts.input, maxBuffer: 1 << 30, cwd: opts.cwd, timeout: opts.timeoutMs, env: process.env });
  if (r.error) throw new FfmpegError(`${bin} failed to start: ${r.error.message}`, { cmd: [bin, ...full].join(' ') });
  const stderr = r.stderr ? r.stderr.toString() : '';
  if (r.status !== 0) throw new FfmpegError(`${bin} exited ${r.status}\ncmd: ${bin} ${full.map((s) => (/\s/.test(s) ? JSON.stringify(s) : s)).join(' ')}\n${tail(stderr)}`, { code: r.status, stderr, cmd: full });
  return { stdout: r.stdout, stderr };
}

/** async variant (does not block the event loop; lets several renders overlap) */
export function runAsync(args, opts = {}) {
  const full = buildArgs(args, opts);
  const bin = opts.bin || 'ffmpeg';
  return new Promise((resolve, reject) => {
    const p = spawn(bin, full, { cwd: opts.cwd, env: process.env });
    const out = [], err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', (e) => reject(new FfmpegError(`${bin} failed to start: ${e.message}`, {})));
    p.on('close', (code) => {
      const stderr = Buffer.concat(err).toString();
      if (code !== 0) reject(new FfmpegError(`${bin} exited ${code}\ncmd: ${bin} ${full.join(' ')}\n${tail(stderr)}`, { code, stderr, cmd: full }));
      else resolve({ stdout: Buffer.concat(out), stderr });
    });
    if (opts.input) p.stdin.end(opts.input);
    else p.stdin.end();
  });
}

export function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new FfmpegError(`ffprobe failed: ${tail(r.stderr || '')}`, {});
  return JSON.parse(r.stdout.toString());
}

// ---- raw f32le <-> Buf --------------------------------------------------------
function toF32(buf) {
  const n = buf.length, f = new Float32Array(n * 2);
  for (let i = 0, j = 0; i < n; i++) { f[j++] = buf.L[i]; f[j++] = buf.R[i]; }
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}
function fromF32(bytes, channels = 2) {
  const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength - (bytes.byteLength % (4 * channels))));
  const n = f.length / channels, L = new Float32Array(n), R = new Float32Array(n);
  if (channels === 1) { L.set(f); R.set(f); } else for (let i = 0, j = 0; i < n; i++) { L[i] = f[j++]; R[i] = f[j++]; }
  return Buf.from(L, R);
}
const asBuf = (x) => (isBuf(x) ? x : Buf.from(x, Float32Array.from(x)));

/**
 * filterChain(buf, afString, {outChannels=2, sr=48000, mono=false}) -> Buf
 * Pipes audio through `ffmpeg -af <afString>` (f32le, 48 kHz stereo in/out). Output length is whatever ffmpeg emits.
 * Examples: 'aecho=0.8:0.9:60:0.4', 'highpass=f=200,lowpass=f=3000', 'rubberband=pitch=1.2', 'afftdn=nr=12'.
 * A mono Float32Array input is accepted (returns stereo Buf).
 */
export function filterChain(buf, af, opts = {}) {
  const b = asBuf(buf);
  const { outChannels = 2, sr = SR } = opts;
  const args = ['-f', 'f32le', '-ar', String(sr), '-ac', '2', '-i', 'pipe:0', '-af', af, '-f', 'f32le', '-ar', String(sr), '-ac', String(outChannels), 'pipe:1'];
  const r = run(args, { input: toF32(b) });
  return fromF32(r.stdout, outChannels);
}

function fitLength(out, n) {
  if (out.length === n) return out;
  const L = new Float32Array(n), R = new Float32Array(n), m = Math.min(n, out.length);
  L.set(out.L.subarray(0, m)); R.set(out.R.subarray(0, m));
  return Buf.from(L, R);
}

/**
 * pitchShift(buf, semitones, {formant=false (true = preserve formants), quality='quality'|'speed'|'consistency',
 *   transients='mixed'|'crisp'|'smooth', window='standard'|'short'|'long', keepLength=true}) -> Buf
 * Pitch shift WITHOUT changing duration (rubberband). For vari-speed (pitch+duration) use fx.pitchResample.
 */
export function pitchShift(buf, semitones, opts = {}) {
  const b = asBuf(buf);
  if (Math.abs(semitones) < 1e-6) return b.clone();
  const { formant = false, quality = 'quality', transients = 'mixed', window = 'standard', keepLength = true, phase = 'laminar' } = opts;
  const ratio = Math.pow(2, semitones / 12);
  const af = `rubberband=pitch=${ratio.toFixed(6)}:tempo=1:formant=${formant ? 'preserved' : 'shifted'}:pitchq=${quality}:transients=${transients}:window=${window}:phase=${phase}:channels=together`;
  // rubberband has start latency; pad the tail so we can trim to the same length
  const out = filterChain(b, af);
  return keepLength ? fitLength(out, b.length) : out;
}

/** timeStretch(buf, ratio) - ratio = new duration / old duration (2 = twice as long). Pitch preserved. */
export function timeStretch(buf, ratio, opts = {}) {
  const b = asBuf(buf);
  const { formant = false, transients = 'mixed', quality = 'quality' } = opts;
  const af = `rubberband=tempo=${(1 / ratio).toFixed(6)}:pitch=1:formant=${formant ? 'preserved' : 'shifted'}:transients=${transients}:pitchq=${quality}:channels=together`;
  return filterChain(b, af);
}

// ---- images -------------------------------------------------------------------
let _tmpCounter = 0;
function tmpWav(buf, tag = 'x') {
  const dir = ensureDir(path.join(os.tmpdir(), 'amrita-audio'));
  const f = path.join(dir, `${tag}_${process.pid}_${_tmpCounter++}.wav`);
  writeWav(f, buf);
  return f;
}

/**
 * spectrogramPng(wavPathOrBuf, pngPath, {w=1600, h=700, start=0, dur=null, legend=true, fscale='log'|'lin',
 *   scale='log', color='intensity', drange=100, gain=1, mono=false}) -> pngPath
 * View the result with the Read tool. dur/start select a time window (seconds).
 */
export function spectrogramPng(input, pngPath, opts = {}) {
  const { w = 1600, h = 700, start = 0, dur = null, legend = true, fscale = 'log', scale = 'log', color = 'intensity', drange = 100, gain = 1, mode = 'combined' } = opts;
  let file = input, tmp = null;
  if (typeof input !== 'string') file = tmp = tmpWav(input, 'spec');
  ensureDir(path.dirname(path.resolve(pngPath)));
  const inArgs = [];
  if (start > 0) inArgs.push('-ss', String(start));
  if (dur != null) inArgs.push('-t', String(dur));
  const vf = `showspectrumpic=s=${w}x${h}:legend=${legend ? 1 : 0}:fscale=${fscale}:scale=${scale}:color=${color}:drange=${drange}:gain=${gain}:mode=${mode}`;
  try {
    run([...inArgs, '-i', file, '-lavfi', vf, '-frames:v', '1', pngPath]);
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
  return pngPath;
}

/** wavePng(wavPathOrBuf, pngPath, {w=1600, h=300, start, dur, split=true, scale='lin'|'log', colors='#ffb62e|#1fb5a6'}) -> pngPath */
export function wavePng(input, pngPath, opts = {}) {
  const { w = 1600, h = 300, start = 0, dur = null, split = true, scale = 'lin', colors = '#ffb62e|#1fb5a6' } = opts;
  let file = input, tmp = null;
  if (typeof input !== 'string') file = tmp = tmpWav(input, 'wave');
  ensureDir(path.dirname(path.resolve(pngPath)));
  const inArgs = [];
  if (start > 0) inArgs.push('-ss', String(start));
  if (dur != null) inArgs.push('-t', String(dur));
  const vf = `showwavespic=s=${w}x${h}:split_channels=${split ? 1 : 0}:scale=${scale}:colors=${colors}`;
  try {
    run([...inArgs, '-i', file, '-filter_complex', vf, '-frames:v', '1', pngPath]);
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
  return pngPath;
}

/** ebur128 summary from ffmpeg: {I, LRA, truePeak (dBTP), samplePeak?} - the independent reference for meter.mjs */
export function ebur128(input) {
  let file = input, tmp = null;
  if (typeof input !== 'string') file = tmp = tmpWav(input, 'ebu');
  try {
    const r = run(['-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { loglevel: 'info' });
    const s = r.stderr;
    const k = s.lastIndexOf('Summary:');
    const t = k >= 0 ? s.slice(k) : s;
    const num = (re) => {
      const m = re.exec(t);
      return m ? parseFloat(m[1]) : NaN;
    };
    return {
      I: num(/I:\s+(-?[\d.]+|-inf)\s+LUFS/),
      LRA: num(/LRA:\s+(-?[\d.]+)\s+LU/),
      truePeak: num(/Peak:\s+(-?[\d.]+|-inf)\s+dBFS/),
      raw: t,
    };
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
}

/** decode any audio file (mp3/ogg/flac/aac/wav/...) to a 48 kHz stereo Buf via ffmpeg */
export function decodeAny(file, opts = {}) {
  const args = [];
  if (opts.start) args.push('-ss', String(opts.start));
  if (opts.dur) args.push('-t', String(opts.dur));
  args.push('-i', file, '-f', 'f32le', '-ar', String(SR), '-ac', '2', 'pipe:1');
  return fromF32(run(args).stdout, 2);
}

/** convert a wav to another format with ffmpeg (e.g. 'aac', 'mp3'): convert('in.wav','out.m4a',['-c:a','aac','-b:a','256k']) */
export function convert(inFile, outFile, extra = []) {
  ensureDir(path.dirname(path.resolve(outFile)));
  run(['-i', inFile, ...extra, outFile]);
  return outFile;
}

/** two-pass-free convenience: ffmpeg loudnorm single pass on a Buf (prefer meter.gainToLufs + limiter for mastering) */
export function loudnorm(buf, I = -14, TP = -1.5, LRA = 11) {
  return filterChain(buf, `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}`);
}

/**
 * shimmerReverb(x, {passes=3, shift=12, feedback=0.6, wet=0.6, decay=4, size=2, damp=0.3, tail=3, wetOnly=false}) -> Buf
 * Reverb whose tail is repeatedly pitch-shifted (default +1 octave) and re-verbed: the classic "shimmer" bed.
 * Each pass calls rubberband, so apply it to a short bus (the 42-50 s future section), not to 60 s of everything.
 */
export function shimmerReverb(x, opts = {}) {
  const { passes = 3, shift = 12, feedback = 0.6, wet = 0.6, decay = 4, size = 2, damp = 0.3, tail = 3, wetOnly = false } = opts;
  const src = asBuf(x);
  const n = src.length + Math.round(tail * SR);
  const acc = new Buf(n / SR);
  let layer = src;
  for (let p = 0; p < passes; p++) {
    const w = reverb(layer, { wetOnly: true, wet: 1, decay, size, damp, tail: p === 0 ? tail : 0, lowCut: 150, highCut: 11000 });
    const g = Math.pow(feedback, p);
    for (let i = 0; i < Math.min(n, w.length); i++) { acc.L[i] += w.L[i] * g; acc.R[i] += w.R[i] * g; }
    if (p < passes - 1) layer = pitchShift(w, shift, { transients: 'smooth', window: 'long', keepLength: true });
  }
  for (let i = 0; i < n; i++) {
    acc.L[i] = acc.L[i] * wet + (!wetOnly && i < src.length ? src.L[i] : 0);
    acc.R[i] = acc.R[i] * wet + (!wetOnly && i < src.length ? src.R[i] : 0);
  }
  return acc;
}
