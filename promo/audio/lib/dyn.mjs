// =============================================================================
// dyn.mjs - dynamics: envelope follower, compressor (+sidechain), ducker, gate,
//           lookahead brickwall true-peak limiter, soft clipper, gain automation.
// All functions take a Buf (stereo, linked detection) or a mono Float32Array and return a NEW one.
// =============================================================================
import { SR, Buf, isBuf, clamp, dbToLin, linToDb } from './core.mjs';
import { curve, regionEnv, slew } from './gen.mjs';
import { biquad } from './filt.mjs';
import { truePeakEnvelope } from './meter.mjs';

const LOG2DB = 6.020599913279624; // 20*log10(x) = LOG2DB * log2(x)
const db = (x) => (x > 1e-9 ? LOG2DB * Math.log2(x) : -180);

/** per-sample max |.| over channels */
function absMax(x) {
  if (!isBuf(x)) {
    const o = new Float32Array(x.length);
    for (let i = 0; i < o.length; i++) o[i] = Math.abs(x[i]);
    return o;
  }
  const o = new Float32Array(x.length);
  for (let i = 0; i < o.length; i++) {
    const a = Math.abs(x.L[i]), b = Math.abs(x.R[i]);
    o[i] = a > b ? a : b;
  }
  return o;
}
const applyG = (x, g, off = 0) => {
  const gg = (i) => g[Math.min(g.length - 1, Math.max(0, i + off))];
  if (isBuf(x)) {
    const L = new Float32Array(x.length), R = new Float32Array(x.length);
    for (let i = 0; i < L.length; i++) {
      const k = gg(i);
      L[i] = x.L[i] * k;
      R[i] = x.R[i] * k;
    }
    return Buf.from(L, R);
  }
  const o = new Float32Array(x.length);
  for (let i = 0; i < o.length; i++) o[i] = x[i] * gg(i);
  return o;
};
/** multiply by a per-sample linear gain array (Float32Array), returns new */
export const applyGain = (x, g) => applyG(x, g, 0);

/**
 * envelope(x, {attackMs=5, releaseMs=80, mode='peak'|'rms', rmsMs=20}) -> Float32Array linear amplitude.
 * Buf: channel max. Use to drive ducking / sidechain from any signal (a kick, a VO line...).
 */
export function envelope(x, opts = {}) {
  const { attackMs = 5, releaseMs = 80, mode = 'peak', rmsMs = 20, sr = SR } = opts;
  const a = absMax(x);
  const n = a.length, out = new Float32Array(n);
  if (mode === 'rms') {
    const k = Math.exp(-1 / ((rmsMs / 1000) * sr));
    let m = 0;
    for (let i = 0; i < n; i++) {
      m = k * m + (1 - k) * a[i] * a[i];
      a[i] = Math.sqrt(m);
    }
  }
  const ka = attackMs <= 0 ? 0 : Math.exp(-1 / ((attackMs / 1000) * sr)), kr = Math.exp(-1 / ((releaseMs / 1000) * sr));
  let y = 0;
  for (let i = 0; i < n; i++) {
    const v = a[i];
    const k = v > y ? ka : kr;
    y = k * y + (1 - k) * v;
    if (y < 1e-20) y = 0;
    out[i] = y;
  }
  return out;
}

/**
 * compressor(x, opts) -> same type as x. Feed-forward, log-domain, soft knee.
 * opts: {thresholdDb=-18, ratio=3, attackMs=10, releaseMs=120, kneeDb=6, makeupDb=0,
 *        detect='peak'|'rms', rmsMs=20, lookaheadMs=0, sidechain=null (Float32Array|Buf), scHpHz=0,
 *        mix=1 (parallel), link=true, autoMakeup=false, returnGr=false}
 * result.gr (Float32Array, dB, <= 0) is attached when returnGr is true.
 */
export function compressor(x, opts = {}) {
  const { thresholdDb = -18, ratio = 3, attackMs = 10, releaseMs = 120, kneeDb = 6, makeupDb = 0, detect = 'peak', rmsMs = 20,
    lookaheadMs = 0, sidechain = null, scHpHz = 0, mix = 1, autoMakeup = false, returnGr = false, sr = SR } = opts;
  const n = x.length;
  let key = sidechain || x;
  if (scHpHz > 0) key = isBuf(key) ? Buf.from(biquad(key.L, 'hp', scHpHz), biquad(key.R, 'hp', scHpHz)) : biquad(key, 'hp', scHpHz);
  const a = absMax(key);
  let lvl = a;
  if (detect === 'peak') {
    // peak detector: instant attack, 20 ms release (bridges the ripple of low-frequency waveforms)
    lvl = new Float32Array(n);
    const kd = Math.exp(-1 / (0.02 * sr));
    let e = 0;
    for (let i = 0; i < n; i++) {
      e = a[i] > e ? a[i] : e * kd;
      lvl[i] = e;
    }
  } else if (detect === 'rms') {
    lvl = new Float32Array(n);
    const k = Math.exp(-1 / ((rmsMs / 1000) * sr));
    let m = 0;
    for (let i = 0; i < n; i++) {
      m = k * m + (1 - k) * a[i] * a[i];
      lvl[i] = Math.sqrt(m * 2); // rms of a sine -> same dB as its peak
    }
  }
  const T = thresholdDb, W = Math.max(0.001, kneeDb), R = Math.max(1, ratio), slope = 1 / R - 1;
  const ka = Math.exp(-1 / ((Math.max(0.01, attackMs) / 1000) * sr)), kr = Math.exp(-1 / ((Math.max(0.01, releaseMs) / 1000) * sr));
  const gr = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const xd = db(lvl[i]);
    const over = xd - T;
    let g;
    if (2 * over < -W) g = 0;
    else if (2 * Math.abs(over) <= W) g = (slope * (over + W / 2) * (over + W / 2)) / (2 * W);
    else g = slope * over;
    const k = g < prev ? ka : kr;
    prev = k * prev + (1 - k) * g;
    if (prev > -1e-12 && prev < 1e-12) prev = 0;
    gr[i] = prev;
  }
  const mk = autoMakeup ? -(slope * (-T)) * 0.5 : 0;
  const la = Math.round((lookaheadMs / 1000) * sr);
  const lin = new Float32Array(n);
  const mkLin = dbToLin(makeupDb + mk);
  for (let i = 0; i < n; i++) {
    const j = Math.min(n - 1, i + la);
    lin[i] = dbToLin(gr[j]) * mkLin;
  }
  if (mix < 1) for (let i = 0; i < n; i++) lin[i] = 1 - mix + mix * lin[i];
  const out = applyG(x, lin);
  if (returnGr) out.gr = gr;
  return out;
}

/** sidechainCompress(x, key, opts): compressor driven by `key` (Float32Array|Buf), e.g. kick -> pad pumping. */
export function sidechainCompress(x, key, opts = {}) {
  return compressor(x, { thresholdDb: -30, ratio: 6, attackMs: 3, releaseMs: 180, kneeDb: 6, ...opts, sidechain: key });
}

/**
 * duck(x, key, {depthDb=9, attackMs=40, releaseMs=450, holdMs=0, threshold=0.02, mode='audio'|'control'})
 * Ducks x by `depthDb` while `key` is active. key: Float32Array.
 *   mode 'control': key is already a 0..1 activity curve (e.g. from regionEnv).
 *   mode 'audio'  : key is an audio signal; activity = smoothed envelope compared with `threshold`.
 * Returns a new signal; result.gain holds the linear gain array.
 */
export function duck(x, key, opts = {}) {
  const { depthDb = 9, attackMs = 40, releaseMs = 450, holdMs = 0, threshold = 0.02, mode = 'audio', sr = SR } = opts;
  const n = x.length;
  let act = new Float32Array(n);
  if (mode === 'audio') {
    const env = envelope(key, { attackMs: 2, releaseMs: Math.max(20, holdMs + 40) });
    for (let i = 0; i < n; i++) act[i] = i < env.length && env[i] > threshold ? 1 : 0;
  } else for (let i = 0; i < n; i++) act[i] = i < key.length ? clamp(key[i], 0, 1) : 0;
  if (holdMs > 0 && mode !== 'audio') {
    // simple hold: max filter via decaying maximum
    const h = Math.round((holdMs / 1000) * sr);
    let cnt = 0, cur = 0;
    for (let i = 0; i < n; i++) {
      if (act[i] >= cur) { cur = act[i]; cnt = h; } else if (cnt > 0) { cnt--; act[i] = cur; } else cur = act[i];
    }
  }
  const sm = slew(act, attackMs / 1000, releaseMs / 1000, sr);
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = dbToLin(-depthDb * sm[i]);
  const out = applyG(x, g);
  out.gain = g;
  return out;
}

/**
 * duckRegions(x, regions, opts) - convenience for VO ducking: regions = [[t0,t1],...] seconds.
 * opts as duck() plus {lead=0.08 (start ducking this many seconds before t0), tailHold=0.15}
 */
export function duckRegions(x, regions, opts = {}) {
  const { lead = 0.08, tailHold = 0.15, depthDb = 9, attackMs = 60, releaseMs = 500, sr = SR } = opts;
  const rs = regions.map((r) => [r[0] - lead, r[1] + tailHold, r.length > 2 ? r[2] : 1]);
  const env = regionEnv(x.length, rs, { attack: 0, release: 0, sr });
  return duck(x, env, { ...opts, mode: 'control', depthDb, attackMs, releaseMs });
}

/** gate(x, {thresholdDb=-45, attackMs=1, holdMs=40, releaseMs=120, rangeDb=-80, sidechain}) */
export function gate(x, opts = {}) {
  const { thresholdDb = -45, attackMs = 1, holdMs = 40, releaseMs = 120, rangeDb = -80, sidechain = null, sr = SR } = opts;
  const n = x.length;
  const a = absMax(sidechain || x);
  const thr = dbToLin(thresholdDb), floor = dbToLin(rangeDb);
  const ka = Math.exp(-1 / ((Math.max(0.01, attackMs) / 1000) * sr)), kr = Math.exp(-1 / ((releaseMs / 1000) * sr));
  const hold = Math.round((holdMs / 1000) * sr);
  const g = new Float32Array(n);
  let y = floor, cnt = 0;
  for (let i = 0; i < n; i++) {
    let target;
    if (a[i] > thr) { cnt = hold; target = 1; } else if (cnt > 0) { cnt--; target = 1; } else target = floor;
    const k = target > y ? ka : kr;
    y = k * y + (1 - k) * target;
    g[i] = y;
  }
  return applyG(x, g);
}

/**
 * automate(x, points, {mode='db'|'lin', shape='lin'|'smooth'|'cos'}) - gain automation (mix riding).
 * points: [[tSec, value], ...]; value in dB (mode 'db', default) or linear gain.
 */
export function automate(x, points, opts = {}) {
  const { mode = 'db', shape = 'smooth' } = opts;
  const c = curve(x.length, points, { mode: shape });
  if (mode === 'db') for (let i = 0; i < c.length; i++) c[i] = dbToLin(c[i]);
  return applyG(x, c);
}

/**
 * softclip(x, {ceilingDb=0, knee=0.6 (fraction of ceiling where compression starts), drive=1}) -> same type.
 * Linear below knee*ceil, smooth tanh-shaped approach to the ceiling above. Never exceeds ceiling.
 */
export function softclip(x, opts = {}) {
  const { ceilingDb = 0, knee = 0.6, driveDb = 0 } = opts;
  const C = dbToLin(ceilingDb), K = C * clamp(knee, 0, 0.999), d = dbToLin(driveDb);
  const f = (v) => {
    v *= d;
    const a = Math.abs(v);
    if (a <= K) return v;
    const o = K + (C - K) * Math.tanh((a - K) / (C - K));
    return v < 0 ? -o : o;
  };
  if (isBuf(x)) return Buf.from(x.L.map(f), x.R.map(f));
  return x.map(f);
}

/**
 * limiter(x, opts) -> Buf|Float32Array. Lookahead brickwall; guarantees |sample| (and, with truePeak, the
 * 4x-oversampled peak) <= ceiling. Zero latency (offline: gain is applied non-causally, aligned with the audio).
 * opts: {ceilingDb=-1, lookaheadMs=5, releaseMs=120, truePeak=true, returnStats=true}
 * result.stats = {maxReductionDb, ...}
 */
export function limiter(x, opts = {}) {
  const { ceilingDb = -1, lookaheadMs = 5, releaseMs = 120, truePeak = true, sr = SR } = opts;
  const n = x.length;
  const ceil = dbToLin(ceilingDb);
  const L = Math.max(1, Math.round((lookaheadMs / 1000) * sr));
  const p = truePeak ? truePeakEnvelope(isBuf(x) ? x.L : x, isBuf(x) ? x.R : null, ceil * 0.5) : absMax(x);
  const req = new Float32Array(n);
  for (let i = 0; i < n; i++) req[i] = p[i] > ceil ? ceil / p[i] : 1;
  // sliding minimum over [i, i+L-1] (monotonic deque)
  const m = new Float32Array(n);
  const dq = new Int32Array(n + 1);
  let h = 0, t = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (t > h && req[dq[t - 1]] >= req[i]) t--;
    dq[t++] = i;
    while (dq[h] > i + L - 1) h++;
    m[i] = req[dq[h]];
  }
  // moving average over the previous L samples of m
  const g = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += m[i];
    if (i >= L) acc -= m[i - L];
    g[i] = acc / Math.min(L, i + 1);
  }
  // release
  const kr = 1 - Math.exp(-1 / ((releaseMs / 1000) * sr));
  let r = 1, maxRed = 1;
  for (let i = 0; i < n; i++) {
    const relaxed = r + (1 - r) * kr;
    r = g[i] < relaxed ? g[i] : relaxed;
    g[i] = r;
    if (r < maxRed) maxRed = r;
  }
  const out = applyG(x, g);
  out.stats = { maxReductionDb: linToDb(maxRed), ceilingDb };
  out.gain = g;
  return out;
}
