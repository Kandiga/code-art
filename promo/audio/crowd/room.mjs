// =============================================================================
// audio/crowd/room.mjs - the cinema hall: per-voice distance + a shared audience reverb bus.
//   buses = makeBuses();  placeVoice(buses, x, t, {gainDb, pan, dist, room})  placeClap(...)  const mix = mixdown(buses)
// Distance (dist 0 = front-row/next to the mic .. 1 = back of the hall):
//   direct gain  -20log10(1 + 1.4 dist)  (0 .. -7.6 dB), lowpass 11 kHz -> 3 kHz, high-shelf droop, no delay on the direct sound
//   reverb send  WET_BASE + WET_SLOPE*dist (x direct), pre-delay 6 .. 46 ms (distance to the nearest reflecting wall), pan narrowed (diffuse)
// Rooms: 'hall' = large cinema (RT60 1.65 s, dark), 'street' = outdoors/platform (short, brighter; used only for events before the 22 s cut).
// =============================================================================
import { Buf, SR, addAt, dbToLin, biquad, reverb, limiter } from '../lib/dsp.mjs';

export const ROOMS = {
  hall: { size: 1.9, decay: 1.65, damp: 0.62, preDelay: 0.016, early: 0.3, lowCut: 150, highCut: 6200, diffusion: 0.8, mod: 0.5, seed: 11 },
  street: { size: 1.0, decay: 0.55, damp: 0.45, preDelay: 0.006, early: 0.5, lowCut: 160, highCut: 9000, diffusion: 0.7, mod: 0.6, seed: 23 },
};

export const WET_BASE = 0.15; // reverb send relative to the direct sound (linear): 0.15 at the front row ...
export const WET_SLOPE = 0.9; // ... + 0.9 * dist (1.05 at the back of the hall)

export function makeBuses(seconds = 60) {
  return { dry: new Buf(seconds), hall: new Buf(seconds), street: new Buf(seconds) };
}

const lerp = (a, b, t) => a + (b - a) * t;

/** distance-shape a mono clip: lowpass + droop. dist 0..1 */
export function distanceFilter(x, dist) {
  let y = x;
  const fc = lerp(11500, 3000, Math.pow(dist, 0.85));
  y = biquad(y, 'lp', fc, 0.707);
  if (dist > 0.1) y = biquad(y, 'highshelf', 3500, 0.7, -5.5 * dist);
  return y;
}

export function directGain(dist) {
  return -20 * Math.log10(1 + 1.4 * dist);
}

/**
 * place a (pre-filtered or raw) mono clip. t = time of sample 0.  opts: {gainDb, pan, dist, room, filtered}
 * returns nothing; mixes into buses.dry and buses[room].
 */
export function placeVoice(buses, x, t, { gainDb = 0, pan = 0, dist = 0.3, room = 'hall', filtered = false, send = 1 } = {}) {
  const y = filtered ? x : distanceFilter(x, dist);
  const dg = gainDb + directGain(dist);
  addAt(buses.dry, y, t, dg, pan);
  const pd = 0.006 + 0.04 * dist;
  const wetDb = dg + 20 * Math.log10((WET_BASE + WET_SLOPE * dist) * send);
  addAt(buses[room], y, t + pd, wetDb, pan * 0.5);
}

/** shared audience reverb: sum of all send buses + dry -> Buf (peak NOT limited here) */
export const WET_TRIM_DB = -4; // FDN returns ~+7.5 dB hotter than the send energy for transient material; -4 => wet ~ 4-6 dB under the direct sound overall
export function mixdown(buses, { wetTrimDb = WET_TRIM_DB } = {}) {
  const out = buses.dry.clone();
  for (const room of Object.keys(ROOMS)) {
    const b = buses[room];
    // skip silent buses (cheap check)
    let any = false;
    for (let i = 0; i < b.L.length; i += 997) if (b.L[i] !== 0 || b.R[i] !== 0) { any = true; break; }
    if (!any) {
      let s = 0;
      for (let i = 0; i < b.L.length; i++) s += Math.abs(b.L[i]);
      if (s === 0) continue;
    }
    const w = reverb(b, { ...ROOMS[room], wet: 1, wetOnly: true });
    addAt(out, w, 0, wetTrimDb, 0);
  }
  return out;
}

/** final polish: remove subsonics, brick-wall limit (true peak) */
export function master(buf, { ceilingDb = -3.2, hpHz = 80 } = {}) {
  const L = biquad(buf.L, 'hp', hpHz, 0.707);
  const R = biquad(buf.R, 'hp', hpHz, 0.707);
  const b = Buf.from(L, R);
  return limiter(b, { ceilingDb, lookaheadMs: 4, releaseMs: 90, truePeak: true }); // Buf (+ .stats.maxReductionDb)
}
