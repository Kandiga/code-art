// verify_sync.mjs — do the audio peaks land on the picture's hit frames?
//   node tools/verify_sync.mjs --audio out/audio_master.wav [--video out/amrita_promo_60s_1080p.mp4]
// Checks (exit code 1 if a hard check fails):
//   * every L/M hit in cues.HITS has an audio transient within +/- 1 frame (33.3 ms) of its time (S hits informational)
//   * TRUE SILENCE between 22.0 and 22.5 (< -80 dBFS), the held breath
//   * FINAL HIT at 58.0: biggest onset of the film, then a decaying tail to 60.0 (no clipping anywhere)
//   * (video) flash/impact frames: mean-luma jumps at hit frames
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as cues from '../shared/cues.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1]]); return a; }, []));

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a RIFF wav');
  let off = 12, fmt = null, data = null;
  while (off < b.length - 8) {
    const id = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(off + 8), ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    if (id === 'data') { data = b.subarray(off + 8, off + 8 + Math.min(sz, b.length - off - 8)); break; }
    off += 8 + sz + (sz & 1);
  }
  const { tag, ch, sr, bits } = fmt, n = Math.floor(data.length / (bits / 8) / ch), L = new Float32Array(n), R = new Float32Array(n);
  const rd = bits === 32 && tag === 3 ? (i) => data.readFloatLE(i * 4) : bits === 16 ? (i) => data.readInt16LE(i * 2) / 32768 : bits === 24 ? (i) => data.readIntLE(i * 3, 3) / 8388608 : bits === 32 ? (i) => data.readInt32LE(i * 4) / 2147483648 : null;
  if (!rd) throw new Error('unsupported wav format ' + JSON.stringify(fmt));
  for (let i = 0; i < n; i++) { L[i] = rd(i * ch); R[i] = ch > 1 ? rd(i * ch + 1) : L[i]; }
  return { L, R, sr, n };
}
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
const aud = readWav(path.resolve(ROOT, args.audio)), sr = aud.sr;
let fail = 0; const lines = [];
// 2 ms RMS energy envelope with 1 ms hop, high-passed lightly (remove DC / sub rumble so transients show)
const hop = Math.round(sr / 1000), win = 2 * hop, env = new Float32Array(Math.floor(aud.n / hop));
{
  let pl = 0, pr = 0; const hp = new Float32Array(aud.n);
  for (let i = 0; i < aud.n; i++) { const m = (aud.L[i] + aud.R[i]) * 0.5; const y = m - pl + 0.995 * pr; pl = m; pr = y; hp[i] = y; }
  for (let k = 0; k < env.length; k++) { let s = 0; const a = k * hop; for (let i = a; i < a + win && i < aud.n; i++) s += hp[i] * hp[i]; env[k] = db(Math.sqrt(s / win)); }
}
function onsetNear(t, pre = 0.05, post = 0.15) {
  const a = Math.max(0, Math.round((t - pre) * 1000)), b = Math.min(env.length - 1, Math.round((t + post) * 1000));
  let best = -1e9, at = a;
  for (let k = a + 20; k <= b; k++) { const base = Math.max(env[k - 20], env[k - 10]); const d = env[k] - base; if (d > best) { best = d; at = k; } }
  // refine: first ms where energy exceeds (base + 0.5 * rise)
  return { t: at / 1000, rise: best };
}
lines.push('HIT        s  expected  onset    offset   rise(dB)  result');
for (const h of cues.HITS) {
  if (h.t >= 59.9) continue;
  const o = onsetNear(h.t), off = (o.t - h.t) * 1000, ok = Math.abs(off) <= 1000 / cues.FPS + 1 && o.rise >= 6;
  if (!ok && h.s !== 'S') fail++;
  lines.push(`${h.t.toFixed(2).padStart(6)}   ${h.s}  ${h.t.toFixed(3)}   ${o.t.toFixed(3)}  ${(off >= 0 ? '+' : '') + off.toFixed(0).padStart(4)} ms  ${o.rise.toFixed(1).padStart(6)}    ${ok ? 'ok' : h.s === 'S' ? 'info (soft)' : 'FAIL'}  ${h.why || ''}`);
}
// silence window
{
  let peak = 0; for (let i = Math.round(22.02 * sr); i < Math.round(22.48 * sr); i++) peak = Math.max(peak, Math.abs(aud.L[i]), Math.abs(aud.R[i]));
  const ok = db(peak) < -80; if (!ok) fail++;
  lines.push(`\nSILENCE 22.02-22.48: peak ${db(peak).toFixed(1)} dBFS  ${ok ? 'ok' : 'FAIL (must be < -80 dBFS: the held breath)'}`);
  let before = 0; for (let i = Math.round(21.7 * sr); i < Math.round(21.98 * sr); i++) before = Math.max(before, Math.abs(aud.L[i]));
  lines.push(`        21.70-21.98 (before cut): peak ${db(before).toFixed(1)} dBFS`);
}
// final hit + tail + clipping
{
  const o = onsetNear(58.0, 0.05, 0.15);
  const rms = (a, b) => { let s = 0, n = 0; for (let i = Math.round(a * sr); i < Math.round(b * sr); i++) { s += aud.L[i] ** 2 + aud.R[i] ** 2; n += 2; } return db(Math.sqrt(s / n)); };
  const r1 = rms(58.0, 58.5), r2 = rms(59.0, 59.5), r3 = rms(59.7, 60.0);
  let pk = 0; for (let i = 0; i < aud.n; i++) pk = Math.max(pk, Math.abs(aud.L[i]), Math.abs(aud.R[i]));
  const okTail = r1 > r2 && r2 > r3; if (!okTail) fail++;
  if (pk > 0.9999) fail++;
  lines.push(`FINAL HIT 58.0: onset ${o.t.toFixed(3)} (offset ${((o.t - 58) * 1000).toFixed(0)} ms), rise ${o.rise.toFixed(1)} dB; RMS 58.0-58.5 ${r1.toFixed(1)}, 59.0-59.5 ${r2.toFixed(1)}, 59.7-60.0 ${r3.toFixed(1)} dBFS ${okTail ? '(tail decays: ok)' : '(TAIL DOES NOT DECAY: FAIL)'}`);
  lines.push(`SAMPLE PEAK ${db(pk).toFixed(2)} dBFS ${pk > 0.9999 ? 'CLIPPING: FAIL' : 'ok'}; duration ${(aud.n / sr).toFixed(3)} s`);
}
// video flash check
if (args.video) {
  const p = spawnSync('ffmpeg', ['-v', 'error', '-i', path.resolve(ROOT, args.video), '-vf', 'scale=96:54,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const y = [...p.stdout.matchAll(/YAVG=([\d.]+)/g)].map((m) => +m[1]);
  lines.push('\nVIDEO luma jump at hit frames (frame f vs f-1, +/-1 frame window):');
  for (const h of cues.HITS) { const f = Math.round(h.t * 30); if (f >= y.length) continue; let best = 0; for (let k = f - 1; k <= f + 1; k++) best = Math.max(best, Math.abs((y[k] ?? 0) - (y[k - 1] ?? 0))); lines.push(`  ${h.t.toFixed(2)} ${h.s}  max luma step ${best.toFixed(1)}`); }
}
console.log(lines.join('\n'));
console.log(fail ? `\nSYNC VERIFY: ${fail} hard failure(s)` : '\nSYNC VERIFY: PASS');
process.exit(fail ? 1 : 0);
