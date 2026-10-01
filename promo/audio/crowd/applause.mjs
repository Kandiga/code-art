// =============================================================================
// audio/crowd/applause.mjs - APPLAUSE FROM INDIVIDUAL HAND-CLAPS.
//
// n people; each is an oscillator (own tempo 2-5 Hz, per-clap interval jitter ~9 %) that claps when its phase wraps.
// A mean-field (Kuramoto) coupling K(t) lets the room slowly SYNCHRONISE and fall apart again (Neda et al.: real audiences
// do exactly this, and clap slower while locked): two sync episodes at fixed fractions of the event span.
// Level envelope: base -> peakLevel at `peak` -> hold ~1 s -> raised-cosine fade to t1.
//   * the number of people clapping follows the envelope (eager clappers first: one person claps exactly at `t`, then a few, then the hall)
//   * the loudness of each clap follows it too (0.35 + 0.65 L)
// Every person owns a "hand" (timbre from lib/claps.wav: flat / cupped / finger / slap / soft / mixed; 4 variants each), a seat
// (pan, distance), a personal level. Output = a list of clap placements (thousands), not audio: synthesis is in render.mjs/room.mjs.
// =============================================================================

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** level envelope L(t) in 0..peakLevel */
export function applauseLevel(ev, t) {
  const { t: t0, t1, peak, base = 0.15, peakLevel = 1 } = ev;
  if (t < t0 || t >= t1) return 0;
  if (t <= peak) {
    const u = (t - t0) / Math.max(1e-6, peak - t0);
    return base + (peakLevel - base) * Math.pow(u, 1.4);
  }
  const hold = Math.min(2.2, 0.55 * (t1 - peak));
  if (t <= peak + hold) return peakLevel;
  const v = (t - peak - hold) / Math.max(1e-6, t1 - peak - hold);
  return peakLevel * (0.5 + 0.5 * Math.cos(Math.PI * clamp(v, 0, 1)));
}

/** sync schedule s(t) in 0..1 : gaussian bumps at fractions of the event span */
export function syncStrength(ev, t) {
  const D = ev.t1 - ev.t;
  const b = (c, w, a) => a * Math.exp(-(((t - (ev.t + c * D)) / (w * D)) ** 2));
  return clamp(b(0.3, 0.1, 1.0) + b(0.74, 0.07, 0.8), 0, 1);
}

export function planApplause(ev, rng, lib, evi, opts = {}) {
  const n = ev.n || 80;
  const dt = 0.002;
  const t0 = ev.t;
  const t1 = ev.t1;
  const KMAX = opts.kmax ?? 8.5; // rad/s coupling at full sync
  // --- people -----------------------------------------------------------------------------------------------------
  const hands = [...new Set(lib.claps.map((c) => c.hand))];
  const handOrder = hands.map((h) => [rng(), h]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const variants = new Map();
  lib.claps.forEach((c, i) => {
    if (!variants.has(c.hand)) variants.set(c.hand, []);
    variants.get(c.hand).push(i);
  });
  const rank = [...Array(n).keys()].map((i) => [rng(), i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]); // rank[k] = person with eagerness rank k
  const P = [];
  for (let i = 0; i < n; i++) P.push(null);
  rank.forEach((person, k) => {
    const r = rng();
    const near = r < 0.11;
    P[person] = {
      id: person,
      rank: k,
      omega: clamp(4.6 + 0.6 * rng.gauss(), 2.8, 6.2),
      theta: rng(),
      cur: 1,
      active: false,
      pan: clamp((rng() * 2 - 1) * 0.95, -0.97, 0.97),
      dist: near ? rng.range(0.03, 0.16) : 0.14 + 0.86 * Math.pow(rng(), 0.7),
      gainDb: clamp(3.0 * rng.gauss(), -8, 6) + (near ? 1.5 : 0),
      hand: handOrder[k % handOrder.length],
    };
    P[person].cur = Math.exp(0.09 * rng.gauss());
    P[person].variants = variants.get(P[person].hand);
  });
  // --- simulate -----------------------------------------------------------------------------------------------------
  const claps = [];
  const series = []; // per 0.1 s: {t, level, active, r, rate}
  let lastLog = -1;
  const steps = Math.ceil((t1 - t0) / dt) + 1;
  for (let s = 0; s <= steps; s++) {
    const t = t0 + s * dt;
    const L = applauseLevel(ev, t);
    const ramp = Math.pow(smooth((t - t0) / 1.5), 1.5);
    const frac = Math.pow(L / (ev.peakLevel || 1), 1.0) * ramp;
    const nActive = Math.floor(frac * n + (t >= t0 ? 1 : 0)) ; // person rank 0 always claps from t0
    // sync
    const sy = syncStrength(ev, t);
    const K = KMAX * sy;
    const rho = 1 - 0.32 * sy;
    // activation + order parameter
    let cs = 0, sn = 0, na = 0;
    for (const p of P) {
      const act = p.rank < nActive && L > 0.003;
      if (act && !p.active) {
        p.active = true;
        if (p.rank === 0 && claps.length === 0) {
          // the first clapper hits exactly at the event time
          claps.push({ t, p, L });
          p.theta = 0.0;
        } else {
          p.theta = rng();
        }
      } else if (!act && p.active) {
        p.active = false;
      }
      if (p.active) {
        const a = 2 * Math.PI * p.theta;
        cs += Math.cos(a);
        sn += Math.sin(a);
        na++;
      }
    }
    const R = na ? Math.hypot(cs, sn) / na : 0;
    const Psi = Math.atan2(sn, cs);
    for (const p of P) {
      if (!p.active) continue;
      const a = 2 * Math.PI * p.theta;
      const dth = (p.omega * p.cur * rho + (K * R * Math.sin(Psi - a)) / (2 * Math.PI)) * dt;
      const th = p.theta + dth;
      if (th >= 1) {
        const frac1 = dth > 0 ? (1 - p.theta) / dth : 0;
        const tc = t + clamp(frac1, 0, 1) * dt;
        claps.push({ t: tc, p, L });
        p.theta = th - 1;
        p.cur = Math.exp(0.09 * rng.gauss()); // next interval: own tempo +- 9 %
      } else p.theta = th;
    }
    if (t - lastLog >= 0.1) {
      lastLog = t;
      series.push({ t: +t.toFixed(2), level: +L.toFixed(3), active: na, r: +R.toFixed(3), sync: +sy.toFixed(3) });
    }
  }
  // --- clap placements ----------------------------------------------------------------------------------------------
  const placements = [];
  for (const c of claps) {
    if (c.t >= t1) continue;
    const p = c.p;
    const Lnorm = c.L / (ev.peakLevel || 1);
    const gainDb = p.gainDb + 20 * Math.log10(0.35 + 0.65 * Lnorm) + 3.0 * rng.gauss();
    placements.push({
      k: 'c', ev: evi, t: c.t, ci: p.variants[Math.floor(rng() * p.variants.length)], speed: Math.floor(rng() * 3),
      gainDb, pan: clamp(p.pan + 0.03 * rng.gauss(), -1, 1), dist: p.dist, person: 'hands' + p.id, hand: p.hand,
    });
  }
  placements.sort((a, b) => a.t - b.t);
  return { placements, series, n, people: P.map((p) => ({ id: p.id, hand: p.hand, pan: +p.pan.toFixed(2), dist: +p.dist.toFixed(2), omega: +p.omega.toFixed(2) })) };
}

/** sparse extra voices on top of the applause (whoops, whistles, 'yeah!'): returns {t, kind} specs */
export function applauseExtras(ev, rng) {
  const D = ev.t1 - ev.t;
  const cnt = Math.max(2, Math.round(D / 1.5));
  const out = [];
  for (let i = 0; i < cnt; i++) {
    // denser around the peak
    const u = rng();
    const t = ev.peak - 0.2 * D + (u - 0.35) * 0.9 * D * (rng() < 0.7 ? 0.6 : 1.0);
    const tt = clamp(t, ev.t + 0.18 * D, ev.t1 - 0.9);
    out.push({ t: +tt.toFixed(3), kind: i % 3 === 2 ? 'whistle' : 'cheer1' });
  }
  return out.sort((a, b) => a.t - b.t);
}
