// =============================================================================
// audio/crowd/render.mjs - the HUMAN AUDIENCE: gasps, laughs, 'whoa', 'oh', 'no way', murmur, cheers and APPLAUSE for cues.CROWD.
//
//   import { renderCrowd } from './crowd/render.mjs';
//   const { stem, report } = await renderCrowd();            // from audio/build.mjs
//   node audio/crowd/render.mjs [--build-lib] [--only 3,5,11] [--out file.wav] [--no-master] [--dry]
//
// NO NOISE CROWD, EVER: every sound is a recording-like clip of a person (Piper TTS words through Praat formant/pitch shifting,
// source-filter synthesized gasps / laughs / whoops, whistles) or an individual hand-clap (applause.mjs). The voice/clap library is
// built by py/build_lib.py into audio/crowd/lib (one-time, cached, seeded). See NOTES.md.
// Timing: every event comes from shared/cues.js (CROWD); the first reactor of an event lands exactly on its cue time.
// Output: audio/build/stems/crowd.wav  (60 s stereo float32 48 kHz, peak <= -3 dBFS true-peak, silent where no event sounds)
//         audio/build/crowd_report.json (per event: voices, claps, onsets; applause sync series)
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cues from '../../shared/cues.js';
import { Buf, SR, mulberry32, seedOf, resampleBy, writeWav } from '../lib/dsp.mjs';
import { STEMS, BUILD, ensure } from '../lib/paths.mjs';
import { openLibrary } from './lib.mjs';
import { makeBuses, placeVoice, mixdown, master, distanceFilter } from './room.mjs';
import { planVoices, planMurmur, planClaps, KINDS } from './voices.mjs';
import { planApplause, applauseExtras } from './applause.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTDOOR_BEFORE = 22.0; // events before the 22.0 s cut belong to Act I (a platform, not the cinema hall)
export const CLAP_SPEEDS = [0.955, 1.0, 1.05];
const CLAP_DIST = [0.08, 0.32, 0.58, 0.85];
const APPLAUSE_DB = 0; // trim for the claps (per-clap gains are already physical)

const distClass = (d) => (d < 0.2 ? 0 : d < 0.45 ? 1 : d < 0.7 ? 2 : 3);

/** sorted copy of the cue events with a stable index */
export function sortedEvents(events = cues.CROWD) {
  return events.map((e) => ({ ...e })).sort((a, b) => a.t - b.t || String(a.kind).localeCompare(String(b.kind))).map((e, i) => ({ ...e, index: i }));
}

/** plan every event -> {placements, info[]} (deterministic; does not synthesize audio) */
export function planCrowd(lib, events = cues.CROWD) {
  const evs = sortedEvents(events);
  const placements = [];
  const info = [];
  for (const ev of evs) {
    const rng = mulberry32(seedOf('crowd', ev.kind, ev.t, ev.n || 0));
    const room = ev.t < OUTDOOR_BEFORE ? 'street' : 'hall';
    let ps = [];
    let extra = null;
    if (ev.kind === 'applause') {
      const a = planApplause(ev, rng, lib, ev.index);
      ps = a.placements;
      extra = { series: a.series, people: a.people.length };
      const ex = applauseExtras(ev, rng);
      for (const e of ex) ps.push(...planVoices({ t: e.t, kind: e.kind, n: 1 }, ev.index, lib, rng, { gain: e.kind === 'whistle' ? -3 : -2.5 }).map((p) => ({ ...p, layer: 'applause-voice' })));
    } else if (ev.kind === 'murmur') ps = planMurmur(ev, ev.index, lib, rng);
    else if (ev.kind === 'clap') ps = planClaps(ev, ev.index, lib, rng);
    else if (KINDS[ev.kind]) ps = planVoices(ev, ev.index, lib, rng);
    else {
      console.warn(`[crowd] unknown kind '${ev.kind}' at t=${ev.t} - skipped`);
      continue;
    }
    for (const p of ps) p.room = room;
    placements.push(...ps);
    const voices = ps.filter((p) => p.k !== 'c');
    info.push({
      index: ev.index, t: ev.t, kind: ev.kind, n: ev.n, t1: ev.t1, room, placements: ps.length, claps: ps.filter((p) => p.k === 'c').length,
      voices: voices.length, persons: new Set(voices.map((p) => p.person)).size, firstPlanned: Math.min(...ps.map((p) => p.t)), ...(extra ? { applause: extra } : {}),
    });
  }
  return { placements, info };
}

/** synthesize placements into buses (dry + room sends) */
export function synthPlacements(lib, placements, seconds = 60) {
  const buses = makeBuses(seconds);
  const clapCache = new Map();
  const clapArr = (ci, sp, dc) => {
    const key = ci * 16 + sp * 4 + dc;
    let a = clapCache.get(key);
    if (!a) {
      let x = lib.clapArr(ci);
      if (sp !== 1) x = resampleBy(x, CLAP_SPEEDS[sp]);
      a = distanceFilter(x, CLAP_DIST[dc]);
      clapCache.set(key, a);
    }
    return a;
  };
  for (const p of placements) {
    if (p.k === 'c') {
      placeVoice(buses, clapArr(p.ci, p.speed, distClass(p.dist)), p.t, { gainDb: p.gainDb + APPLAUSE_DB, pan: p.pan, dist: p.dist, room: p.room, filtered: true });
    } else if (p.k === 'v') {
      const meta = lib.byId.get(p.id);
      let x = lib.samples(meta);
      const speed = Math.pow(2, (p.semis || 0) / 12);
      if (Math.abs(speed - 1) > 1e-3) x = resampleBy(x, speed);
      placeVoice(buses, x, p.t - meta.onset / speed, { gainDb: p.gainDb, pan: p.pan, dist: p.dist, room: p.room });
    } else if (p.k === 'w') {
      const meta = lib.byId.get(p.id);
      const full = lib.samples(meta);
      const a = Math.round(p.srcStart * SR);
      const b = Math.min(full.length, a + Math.round(p.len * SR));
      let x = Float32Array.from(full.subarray(a, b));
      const fi = Math.round((p.srcStart === 0 ? 0.012 : 0.045) * SR);
      const fo = Math.round(0.09 * SR);
      for (let i = 0; i < Math.min(fi, x.length); i++) x[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi);
      for (let i = 0; i < Math.min(fo, x.length); i++) x[x.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fo);
      const speed = Math.pow(2, (p.semis || 0) / 12);
      if (Math.abs(speed - 1) > 1e-3) x = resampleBy(x, speed);
      const on = p.srcStart === 0 ? meta.onset / speed : 0;
      placeVoice(buses, x, p.t - on, { gainDb: p.gainDb, pan: p.pan, dist: p.dist, room: p.room, send: p.send || 1 });
    }
  }
  return buses;
}

/** @returns {Promise<{stem: string, report: object, buf: Buf}>} */
export async function renderCrowd(opts = {}) {
  const lib = await openLibrary({ build: opts.build !== false });
  const { placements, info } = planCrowd(lib, opts.events || cues.CROWD);
  const sel = opts.only ? placements.filter((p) => opts.only.includes(p.ev)) : placements;
  const buses = synthPlacements(lib, sel, cues.DURATION);
  const mixed = mixdown(buses);
  const out = opts.master === false ? mixed : master(mixed, { ceilingDb: -3.2 });
  const stem = opts.out || path.join(ensure(STEMS), 'crowd.wav');
  writeWav(stem, out);
  const report = {
    stem, seconds: out.seconds, events: info,
    totals: {
      events: info.length, placements: sel.length, claps: sel.filter((p) => p.k === 'c').length,
      voices: sel.filter((p) => p.k !== 'c').length, distinctVoices: new Set(sel.filter((p) => p.k !== 'c').map((p) => p.person)).size,
      distinctClapSamples: new Set(sel.filter((p) => p.k === 'c').map((p) => p.ci)).size,
      limiterMaxReductionDb: out.stats ? +out.stats.maxReductionDb.toFixed(2) : 0,
    },
  };
  fs.writeFileSync(path.join(ensure(BUILD), 'crowd_report.json'), JSON.stringify(report, null, 1));
  if (!opts.quiet) {
    console.log(`[crowd] ${report.totals.events} events, ${report.totals.voices} voice clips (${report.totals.distinctVoices} distinct people), ${report.totals.claps} hand-claps -> ${stem}`);
  }
  return { stem, report, buf: out, placements: sel, lib };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
  if (process.argv.includes('--build-lib')) {
    const { ensureLibrary } = await import('./lib.mjs');
    await ensureLibrary();
  }
  const only = arg('--only');
  await renderCrowd({ only: only ? only.split(',').map(Number) : null, out: arg('--out') ? path.resolve(arg('--out')) : null, master: !process.argv.includes('--no-master') });
}
