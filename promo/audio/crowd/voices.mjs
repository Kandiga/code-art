// =============================================================================
// audio/crowd/voices.mjs - plan the human-voice reactions of every cues.CROWD event.
//   plan = list of placements {k:'v'|'w'|'c', t, id/ci, gainDb, pan, dist, semis, person, ev}
// Each event places n DISTINCT people (library clips never repeat while unused ones remain), with a reaction spread of 0..0.35 s
// (first reactor leads at exactly the cue time; later reactors cluster early: offset = 0.35 * u^1.7), random seat (pan/distance),
// +-0.6 semitone playback-rate variation and a personal level.
// =============================================================================
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

const W = (group, tag, w, filter) => ({ group, tag, w, filter });
const asrHas = (s) => (c) => c.asr && c.asr.toLowerCase().replace(/[^a-z ]/g, '').includes(s);
const asrConf = (min) => (c) => (c.asrConf ?? 1) >= min;
const and = (...f) => (c) => f.every((g) => g(c));

// gain: dB on top of library level (every clip is -24 dB active RMS).  lead: pool for the first reactor
export const KINDS = {
  gasp: { pools: [W('synth', 'gasp', 1)], gain: 5, spread: 0.35 },
  laugh: { pools: [W('synth', 'laugh', 0.82), W('words', 'haha', 0.18, asrHas('ha'))], gain: 3.5, spread: 0.35 },
  oh: { pools: [W('words', 'oh', 0.55), W('words', 'ooh', 0.15), W('words', 'ah', 0.15), W('synth', 'aww', 0.15)], gain: 3, spread: 0.3 },
  whoa: { pools: [W('words', 'whoa', 0.72), W('words', 'wow', 0.18), W('words', 'ooh', 0.1)], lead: [W('words', 'whoa', 1, asrHas('wh'))], gain: 4, spread: 0.35 },
  no_way: { pools: [W('words', 'no_way', 1, and(asrHas('no way'), asrConf(0.55)))], gain: 5, spread: 0.3 },
  cheer: { pools: [W('synth', 'whoop', 0.46), W('words', 'woo', 0.12), W('words', 'yeah', 0.14), W('words', 'wow', 0.08), W('whistles', 'whistle', 0.1), W('words', 'whoa', 0.1)], lead: [W('synth', 'whoop', 1)], gain: 5.5, spread: 0.35 },
  cheer1: { pools: [W('synth', 'whoop', 0.6), W('words', 'woo', 0.2), W('words', 'yeah', 0.2)], gain: -1, spread: 0 },
  whistle: { pools: [W('whistles', 'whistle', 1)], gain: 0, spread: 0.3 },
  aww: { pools: [W('synth', 'aww', 0.5), W('words', 'aww', 0.5)], gain: 2, spread: 0.3 },
  wow: { pools: [W('words', 'wow', 1)], gain: 4, spread: 0.3 },
  yeah: { pools: [W('words', 'yeah', 1)], gain: 4, spread: 0.3 },
  woo: { pools: [W('words', 'woo', 0.5), W('synth', 'whoop', 0.5)], gain: 5, spread: 0.3 },
  ah: { pools: [W('words', 'ah', 1)], gain: 3, spread: 0.3 },
  ooh: { pools: [W('words', 'ooh', 1)], gain: 3, spread: 0.3 },
  mm: { pools: [W('words', 'mm', 1)], gain: 1, spread: 0.3 },
};

function seat(rng, k) {
  // lead reactors tend to sit nearer (they are the ones you hear first); the rest are spread across the hall
  const r = rng();
  const dist = k === 0 ? rng.range(0.1, 0.4) : r < 0.22 ? rng.range(0.05, 0.3) : r < 0.65 ? rng.range(0.3, 0.65) : rng.range(0.65, 1.0);
  const pan = clamp(rng.range(-1, 1) * 0.92, -0.95, 0.95);
  return { dist, pan };
}

const offsets = (n, spread, rng) => {
  const o = Array.from({ length: n }, () => spread * Math.pow(rng(), 1.7));
  o.sort((a, b) => a - b);
  o[0] = 0; // the first reactor lands exactly on the cue
  return o;
};

export function planVoices(ev, evi, lib, rng, extra = {}) {
  const spec = KINDS[ev.kind];
  const n = ev.n || 1;
  const off = offsets(n, extra.spread ?? spec.spread, rng);
  const out = [];
  const avoid = new Set();
  for (let k = 0; k < n; k++) {
    const meta = lib.pick(k === 0 && spec.lead ? spec.lead : spec.pools, rng, avoid);
    avoid.add(meta.person);
    const s = seat(rng, k);
    out.push({
      k: 'v', ev: evi, id: meta.id, person: meta.person, tag: meta.tag, t: ev.t + (extra.dt || 0) + off[k],
      gainDb: (extra.gain ?? spec.gain) + 2.2 * rng.gauss() * 0.8 + (meta.gainHintDb || 0) * 0.5 + (k === 0 ? 1 : 0),
      pan: s.pan, dist: s.dist, semis: rng.range(-0.6, 0.6),
    });
  }
  return out;
}

/** murmur: n short excerpts of band-limited chatter, scattered over `dur`, heavy reverb, low level */
export function planMurmur(ev, evi, lib, rng) {
  const n = ev.n || 4;
  const dur = ev.dur || 1.2;
  const out = [];
  const avoid = new Set();
  for (let k = 0; k < n; k++) {
    const meta = lib.pick([W('walla', 'walla', 1)], rng, avoid);
    avoid.add(meta.person);
    const L = Math.min(meta.dur - 0.05, rng.range(0.55, 1.15));
    const maxStart = Math.max(0, meta.dur - L);
    const srcStart = k === 0 ? 0 : rng() * maxStart;
    const room = Math.max(0, dur - L * 0.7);
    const t = ev.t + (k === 0 ? 0 : rng() * room);
    const dist = rng.range(0.45, 1.0);
    out.push({
      k: 'w', ev: evi, id: meta.id, person: meta.person, tag: 'walla', t, srcStart, len: L,
      gainDb: -1 + 2 * rng.gauss() * 0.6, pan: clamp(rng.range(-1, 1) * 0.9, -0.95, 0.95), dist, semis: rng.range(-1.2, 1.2), send: 1.5,
    });
  }
  return out;
}

/** a few individual claps (kind 'clap') */
export function planClaps(ev, evi, lib, rng) {
  const n = ev.n || 1;
  const hands = [...new Set(lib.claps.map((c) => c.hand))];
  const out = [];
  for (let k = 0; k < n; k++) {
    const h = hands[Math.floor(rng() * hands.length)];
    const vs = lib.claps.map((c, i) => [c, i]).filter(([c]) => c.hand === h);
    const s = seat(rng, k);
    out.push({
      k: 'c', ev: evi, t: ev.t + (k === 0 ? 0 : 0.35 * Math.pow(rng(), 1.3)), ci: vs[Math.floor(rng() * vs.length)][1], speed: Math.floor(rng() * 3),
      gainDb: 2 + 2 * rng.gauss() * 0.6, pan: s.pan, dist: s.dist, person: 'hands' + h,
    });
  }
  return out.sort((a, b) => a.t - b.t);
}
