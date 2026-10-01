// =============================================================================
// meter.mjs - ITU-R BS.1770-4 / EBU R128 loudness, true-peak (4x), RMS, peak, DC, crest.
// Validated against ffmpeg `ebur128=peak=true` (see test/test_meter.mjs).
//
//   integratedLoudness(buf)            LUFS (gated: -70 abs, -10 LU rel)
//   measure(buf)                       full report {integrated, lra, momentaryMax, shortTermMax, truePeakDb, ...}
//   lufsGateStats(buf, t0, t1)         windowed stats (e.g. VO line vs bed)
//   truePeak(buf)                      {db, lin}
//   rmsDb / peakDb / rmsCurve / loudnessCurve / dcOffset / crestDb / silenceCheck
//   gainToLufs(buf, target)            dB gain needed to hit a target integrated loudness
// =============================================================================
import { SR, TWO_PI, isBuf, clamp, kaiser, Buf } from './core.mjs';

const OFFSET = -0.691;

// ---------------------------------------------------------------------------
// K-weighting (BS.1770-4): high-shelf (+4 dB @ ~1.68 kHz) + RLB high-pass (~38 Hz); formulas as in libebur128
// ---------------------------------------------------------------------------
export function kWeightCoefs(sr = SR) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = { b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + K / Q + K * K;
  const s2 = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [s1, s2];
}

/** K-weight a channel -> Float32Array */
export function kWeight(x, sr = SR) {
  const [s1, s2] = kWeightCoefs(sr);
  const n = x.length, out = new Float32Array(n);
  let a1 = 0, a2 = 0, b1 = 0, b2 = 0; // stage1 state (direct form I)
  let c1 = 0, c2 = 0, d1 = 0, d2 = 0;
  const [p0, p1, p2] = s1.b, [pa1, pa2] = s1.a, [r0, r1, r2] = s2.b, [ra1, ra2] = s2.a;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    const y = p0 * v + p1 * a1 + p2 * a2 - pa1 * b1 - pa2 * b2;
    a2 = a1; a1 = v; b2 = b1; b1 = y;
    const z = r0 * y + r1 * c1 + r2 * c2 - ra1 * d1 - ra2 * d2;
    c2 = c1; c1 = y; d2 = d1; d1 = z;
    out[i] = z;
  }
  return out;
}

/**
 * analyze(buf, t0=0, t1=end) -> analysis object with prefix sums of K-weighted energy.
 * Reuse it for many window queries on the same buffer. Filters start cold at t0 (opts.preroll seconds warms them).
 */
export function analyze(buf, t0 = 0, t1 = Infinity, opts = {}) {
  const n = buf.length;
  const a = clamp(Math.round(t0 * SR), 0, n);
  const b = clamp(t1 === Infinity ? n : Math.round(t1 * SR), a, n);
  // filters start cold at t0 (so audio before t0 never leaks into the window); opts.preroll (s) warms them up
  const pre = Math.min(a, Math.round((opts.preroll || 0) * SR));
  const sl = (x) => x.subarray(a - pre, b);
  const kL = kWeight(sl(buf.L)), kR = kWeight(sl(buf.R));
  const m = b - a;
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const l = kL[pre + i], r = kR[pre + i];
    cum[i + 1] = cum[i] + l * l + r * r;
  }
  return { n: m, cum, offsetSamples: a };
}
const msOf = (A, s, e) => (A.cum[Math.min(A.n, e)] - A.cum[Math.max(0, s)]) / Math.max(1, Math.min(A.n, e) - Math.max(0, s));
const lufsOfMs = (z) => (z > 0 ? OFFSET + 10 * Math.log10(z) : -Infinity);

/** windowed loudness values: window length `winSec`, hop `hopSec`; returns {t (window start s), z (mean-square), l (LUFS)} */
function windows(A, winSec, hopSec) {
  const w = Math.round(winSec * SR), h = Math.round(hopSec * SR);
  const t = [], z = [], l = [];
  for (let s = 0; s + w <= A.n; s += h) {
    const m = msOf(A, s, s + w);
    t.push(s / SR); z.push(m); l.push(lufsOfMs(m));
  }
  return { t, z, l };
}

function gatedIntegrated(z) {
  const abs = [];
  for (const v of z) if (lufsOfMs(v) > -70) abs.push(v);
  if (!abs.length) return -Infinity;
  const mean0 = abs.reduce((a, b) => a + b, 0) / abs.length;
  const gamma = lufsOfMs(mean0) - 10;
  let s = 0, c = 0;
  for (const v of abs) if (lufsOfMs(v) > gamma) { s += v; c++; }
  return c ? lufsOfMs(s / c) : -Infinity;
}

function loudnessRange(shortZ) {
  const abs = shortZ.filter((v) => lufsOfMs(v) > -70);
  if (abs.length < 2) return 0;
  const gamma = lufsOfMs(abs.reduce((a, b) => a + b, 0) / abs.length) - 20;
  const ls = abs.map(lufsOfMs).filter((l) => l > gamma).sort((a, b) => a - b);
  if (ls.length < 2) return 0;
  const q = (p) => {
    const pos = p * (ls.length - 1), i = Math.floor(pos), f = pos - i;
    return ls[i] + (ls[Math.min(ls.length - 1, i + 1)] - ls[i]) * f;
  };
  return q(0.95) - q(0.1);
}

// ---------------------------------------------------------------------------
// true peak (4x oversampling, 32-tap Kaiser-windowed sinc per phase)
// ---------------------------------------------------------------------------
const TP_K0 = -15, TP_N = 32;
const TPC = [1, 2, 3].map((p) => {
  const c = new Float64Array(TP_N);
  let s = 0;
  for (let j = 0; j < TP_N; j++) {
    const x = TP_K0 + j - p / 4;
    const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    c[j] = sinc * kaiser(x / 16.5, 8);
    s += c[j];
  }
  for (let j = 0; j < TP_N; j++) c[j] /= s;
  return c;
});

/**
 * per-sample true-peak envelope: out[i] = max(|x[i]|, |inter-sample values in (i, i+1)|) over L and R.
 * `minLevel`: skip the interpolation where all neighbours are below this (cheap + exact for limiting).
 */
export function truePeakEnvelope(L, R = null, minLevel = 0.05) {
  const n = L.length, out = new Float32Array(n);
  const chans = R ? [L, R] : [L];
  for (let i = 0; i < n; i++) {
    let m = 0, loc = 0;
    for (const x of chans) {
      const v = Math.abs(x[i]);
      if (v > m) m = v;
      for (let k = -2; k <= 3; k++) {
        const j = i + k;
        if (j >= 0 && j < n) { const w = Math.abs(x[j]); if (w > loc) loc = w; }
      }
    }
    if (loc >= minLevel) {
      for (const x of chans) {
        for (let p = 0; p < 3; p++) {
          const c = TPC[p];
          let s = 0;
          for (let j = 0; j < TP_N; j++) {
            const q = i + TP_K0 + j;
            if (q >= 0 && q < n) s += x[q] * c[j];
          }
          const a = Math.abs(s);
          if (a > m) m = a;
        }
      }
    }
    out[i] = m;
  }
  return out;
}

/** true peak of a Buf or Float32Array over [t0,t1]: {lin, db, samplePeakDb, overDb} */
export function truePeak(buf, t0 = 0, t1 = Infinity) {
  const L = isBuf(buf) ? buf.L : buf, R = isBuf(buf) ? buf.R : null;
  const a = clamp(Math.round(t0 * SR), 0, L.length), b = clamp(t1 === Infinity ? L.length : Math.round(t1 * SR), a, L.length);
  let sp = 0, tp = 0;
  const chans = R ? [L, R] : [L];
  for (const x of chans) {
    for (let i = a; i < b; i++) {
      const v = Math.abs(x[i]);
      if (v > sp) sp = v;
    }
  }
  tp = sp;
  for (let i = a; i < b; i++) {
    let loc = 0;
    for (const x of chans) for (let k = -2; k <= 3; k++) { const j = i + k; if (j >= 0 && j < x.length) { const w = Math.abs(x[j]); if (w > loc) loc = w; } }
    if (loc < 0.4 * tp) continue;
    for (const x of chans) {
      for (let p = 0; p < 3; p++) {
        const c = TPC[p];
        let s = 0;
        for (let j = 0; j < TP_N; j++) { const q = i + TP_K0 + j; if (q >= 0 && q < x.length) s += x[q] * c[j]; }
        const v = Math.abs(s);
        if (v > tp) tp = v;
      }
    }
  }
  const db = (v) => (v > 1e-12 ? 20 * Math.log10(v) : -Infinity);
  return { lin: tp, db: db(tp), samplePeakDb: db(sp), overDb: db(tp) - db(sp) };
}

// ---------------------------------------------------------------------------
// simple level meters
// ---------------------------------------------------------------------------
const toDb = (v) => (v > 1e-12 ? 20 * Math.log10(v) : -Infinity);
const range = (buf, t0, t1) => {
  const L = isBuf(buf) ? buf.L : buf;
  const a = clamp(Math.round(t0 * SR), 0, L.length), b = clamp(t1 === Infinity ? L.length : Math.round(t1 * SR), a, L.length);
  return [a, b];
};
/** sample peak in dBFS over [t0,t1] */
export function peakDb(buf, t0 = 0, t1 = Infinity) {
  const [a, b] = range(buf, t0, t1);
  let p = 0;
  for (const x of isBuf(buf) ? [buf.L, buf.R] : [buf]) for (let i = a; i < b; i++) { const v = Math.abs(x[i]); if (v > p) p = v; }
  return toDb(p);
}
/** RMS dBFS (both channels combined) over [t0,t1] */
export function rmsDb(buf, t0 = 0, t1 = Infinity) {
  const [a, b] = range(buf, t0, t1);
  let s = 0, c = 0;
  for (const x of isBuf(buf) ? [buf.L, buf.R] : [buf]) { for (let i = a; i < b; i++) s += x[i] * x[i]; c += b - a; }
  return toDb(Math.sqrt(s / Math.max(1, c)));
}
/** RMS curve in dBFS: returns {t: Float32Array (window centre s), db: Float32Array} */
export function rmsCurve(buf, winSec = 0.1, hopSec = 0.05) {
  const L = isBuf(buf) ? buf.L : buf, R = isBuf(buf) ? buf.R : null;
  const w = Math.round(winSec * SR), h = Math.round(hopSec * SR), t = [], d = [];
  for (let s = 0; s + w <= L.length; s += h) {
    let e = 0;
    for (let i = s; i < s + w; i++) e += L[i] * L[i] + (R ? R[i] * R[i] : 0);
    t.push((s + w / 2) / SR); d.push(toDb(Math.sqrt(e / (w * (R ? 2 : 1)))));
  }
  return { t: Float32Array.from(t), db: Float32Array.from(d) };
}
export function dcOffset(buf) {
  const mean = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s / Math.max(1, x.length); };
  return isBuf(buf) ? { L: mean(buf.L), R: mean(buf.R) } : { L: mean(buf), R: mean(buf) };
}
/** crest factor (peak / RMS) in dB */
export function crestDb(buf, t0 = 0, t1 = Infinity) {
  return peakDb(buf, t0, t1) - rmsDb(buf, t0, t1);
}
/** is [t0,t1) silent (peak below thresholdDb, default -90 dBFS)? returns {silent, peakDb} */
export function silenceCheck(buf, t0, t1, thresholdDb = -90) {
  const p = peakDb(buf, t0, t1);
  return { silent: p < thresholdDb, peakDb: p };
}
/** count of samples at/over full scale */
export function clipCount(buf, thr = 0.99999) {
  let c = 0;
  for (const x of isBuf(buf) ? [buf.L, buf.R] : [buf]) for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= thr) c++;
  return c;
}

// ---------------------------------------------------------------------------
// loudness API
// ---------------------------------------------------------------------------
export function integratedLoudness(buf, t0 = 0, t1 = Infinity) {
  const A = analyze(buf, t0, t1);
  return gatedIntegrated(windows(A, 0.4, 0.1).z);
}

/**
 * momentary (400 ms) / short-term (3 s) loudness over time: {t: window START seconds, l: LUFS[]}
 * kind: 'momentary' | 'short'; hop seconds (default 0.1)
 */
export function loudnessCurve(buf, kind = 'momentary', hopSec = 0.1) {
  const A = analyze(buf);
  const w = windows(A, kind === 'short' ? 3 : 0.4, hopSec);
  return { t: w.t, l: w.l };
}

/** complete report for a Buf (full length) */
export function measure(buf) {
  const A = analyze(buf);
  const mom = windows(A, 0.4, 0.1), st = windows(A, 3, 0.1);
  const tp = truePeak(buf);
  const dc = dcOffset(buf);
  return {
    seconds: buf.length / SR,
    integrated: gatedIntegrated(mom.z),
    lra: loudnessRange(st.z),
    momentaryMax: Math.max(...mom.l.filter(Number.isFinite), -Infinity),
    shortTermMax: Math.max(...st.l.filter(Number.isFinite), -Infinity),
    truePeakDb: tp.db,
    samplePeakDb: tp.samplePeakDb,
    rmsDb: rmsDb(buf),
    crestDb: crestDb(buf),
    dcL: dc.L, dcR: dc.R,
    clipped: clipCount(buf),
  };
}

/**
 * lufsGateStats(buf, t0, t1) -> windowed stats for [t0,t1] seconds
 * {integrated (BS.1770 gated; -Infinity if < 400 ms or all gated), ungated (K-weighted mean over the whole window,
 *  fine for short VO lines), momentaryMax, shortTermMax, rmsDb, peakDb, truePeakDb, seconds}
 * Use to measure a VO line against the bed: lufsGateStats(vo, 16, 21.4).ungated vs lufsGateStats(music, 16, 21.4).ungated
 */
export function lufsGateStats(buf, t0, t1) {
  const A = analyze(buf, t0, t1);
  const mom = windows(A, 0.4, 0.1), st = windows(A, 3, 0.1);
  const fin = (a) => a.filter(Number.isFinite);
  return {
    seconds: A.n / SR,
    integrated: gatedIntegrated(mom.z),
    ungated: A.n ? lufsOfMs(msOf(A, 0, A.n)) : -Infinity,
    momentaryMax: fin(mom.l).length ? Math.max(...fin(mom.l)) : -Infinity,
    shortTermMax: fin(st.l).length ? Math.max(...fin(st.l)) : -Infinity,
    rmsDb: rmsDb(buf, t0, t1),
    peakDb: peakDb(buf, t0, t1),
    truePeakDb: truePeak(buf, t0, t1).db,
  };
}

/** dB of gain to apply so that integrated loudness == targetLufs */
export function gainToLufs(buf, targetLufs = -14) {
  const l = integratedLoudness(buf);
  return Number.isFinite(l) ? targetLufs - l : 0;
}

/** "-14.2 LUFS" style formatting; handles -Infinity */
export const fmt = (v, unit = 'dB', d = 1) => (Number.isFinite(v) ? v.toFixed(d) + ' ' + unit : '-inf ' + unit);
/** one-screen text report */
export function formatReport(r) {
  return [
    `duration     ${r.seconds.toFixed(2)} s`,
    `integrated   ${fmt(r.integrated, 'LUFS')}   LRA ${r.lra.toFixed(1)} LU`,
    `momentary mx ${fmt(r.momentaryMax, 'LUFS')}   short-term mx ${fmt(r.shortTermMax, 'LUFS')}`,
    `true peak    ${fmt(r.truePeakDb, 'dBTP')}   sample peak ${fmt(r.samplePeakDb, 'dBFS')}`,
    `RMS          ${fmt(r.rmsDb, 'dBFS')}   crest ${fmt(r.crestDb, 'dB')}`,
    `DC offset    L ${r.dcL.toExponential(1)}  R ${r.dcR.toExponential(1)}   clipped samples ${r.clipped}`,
  ].join('\n');
}
export { Buf, TWO_PI };
