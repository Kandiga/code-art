// =============================================================================
// audio/sfx/index.mjs - the SFX dispatcher.
//
//   import { recipes, renderSfx, renderEvent, coverage } from './index.mjs'
//
//   recipes            id -> function(ev, ctx) => Buf | {buf, offsetSec?, send?}   (recipes_a + recipes_b, merged)
//   renderSfx(cues)    iterate cues.SFX (sorted), render every event, mix into ONE 60 s stereo Buf, add the
//                      shared 'room' send, enforce the film's hold-breath silence, peak-protect, return the Buf.
//                      The returned Buf carries `.report` (coverage + peak info).
//   renderEvent(ev,n)  render ONE event solo -> {buf, offsetSec, send, ...}  (used by the tests)
//   coverage(cues)     [{id, count, first, owner:'A'|'B'|'-', ok}]
//
// RECIPE CONTRACT (recipes_a.mjs / recipes_b.mjs export `recipes` = { id: fn }):
//   fn(ev, ctx) where ev = the cue event ({t,id,g?,pan?,dur?,...params}) and
//     ctx = { ev, id, t, n (occurrence index of this id in the cue list), rng(label) -> seeded mulberry32,
//             seed(label) -> int, burst(win=0.6) -> # of earlier same-id events within win s, cues, dsp }
//   returns a stereo Buf (dsp.Buf) that starts AT the event time, or an object:
//     { buf,                 // stereo Buf
//       offsetSec = 0,       // pre-roll: the event's nominal time t is `offsetSec` seconds INTO buf
//                            //   (buf is placed at t - offsetSec; use for reverse swells / whooshes that must land on t)
//       send = -14 }         // dB level into the shared 'room' reverb send (-Infinity = none)
//   The dispatcher applies ev.g (dB trim) and ev.pan (constant-power placement, unity centre). A recipe must NOT
//   apply ev.g / ev.pan itself. A recipe may use ev.dur for sustained material and may ring past it.
//
// recipes_b.mjs (events t >= 26.0) is imported dynamically if present. For an event with t < SPLIT the recipes_a
// version of an id is preferred (both files may define e.g. 'riser_short'); at/after SPLIT recipes_b is preferred.
// Unknown ids get a soft fallback tick and a LOUD console warning.
//
// Silence: [22.0, 22.5) (cues.MUSIC.sections 'silence') is digital zero; everything is faded out over 20 ms before 22.0.
// Deterministic: seeded RNG only.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as dsp from '../lib/dsp.mjs';
import * as defaultCues from '../../shared/cues.js';
import { recipes as recipesA, fallbackTick } from './recipes_a.mjs';

const { SR, Buf, mulberry32, seedOf, panGains, dbToLin } = dsp;
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** events at/after this time belong to recipes_b (first agent owns t < SPLIT) */
export const SPLIT = 26.0;

let recipesB = {};
let bFile = process.env.SFX_RECIPES_B ? path.resolve(process.env.SFX_RECIPES_B) : path.join(HERE, 'recipes_b.mjs'); // env override: testing only
export let recipesBLoaded = false;
if (fs.existsSync(bFile)) {
  try {
    const mod = await import(pathToFileURL(bFile).href);
    recipesB = mod.recipes || mod.default || {};
    recipesBLoaded = true;
  } catch (e) {
    console.warn(`\n*** [sfx] WARNING: recipes_b.mjs exists but failed to import: ${e && e.message}\n`);
  }
}

/** merged map (recipes_b wins on a name clash; the dispatcher itself is time-aware, see header) */
export const recipes = { ...recipesA, ...recipesB };
export { recipesA, recipesB };

function pick(ev) {
  const a = recipesA[ev.id], b = recipesB[ev.id];
  if (ev.t < SPLIT) return a || b || null;
  return b || a || null;
}
const ownerOf = (ev) => (pick(ev) === recipesA[ev.id] && recipesA[ev.id] ? 'A' : pick(ev) ? 'B' : '-');

function makeCtx(ev, n, cuesMod) {
  return {
    ev, id: ev.id, t: ev.t, n,
    rng: (label = '') => mulberry32(seedOf('sfx', ev.id, ev.t, n, label)),
    seed: (label = '') => seedOf('sfx', ev.id, ev.t, n, label),
    // number of EARLIER events of the same id within `win` seconds (0 for the first of a burst): lets a recipe vary
    // pitch / timbre across a rapid sequence (laser volleys, heart pops) regardless of other scenes' extra cues
    burst: (win = 0.6) => cuesMod.SFX.filter((e) => e.id === ev.id && (e.t < ev.t || (e.t === ev.t && e !== ev && cuesMod.SFX.indexOf(e) < cuesMod.SFX.indexOf(ev))) && ev.t - e.t <= win).length,
    cues: cuesMod, dsp,
  };
}

/** render one event solo. n = occurrence index of ev.id. Returns {buf, offsetSec, send, fallback} (trim + pan NOT yet applied). */
export function renderEvent(ev, n = 0, cuesMod = defaultCues) {
  const fn = pick(ev);
  let r, fallback = false;
  if (!fn) {
    fallback = true;
    r = fallbackTick(ev, makeCtx(ev, n, cuesMod));
  } else r = fn(ev, makeCtx(ev, n, cuesMod));
  if (!r) throw new Error(`sfx recipe "${ev.id}" returned nothing`);
  if (dsp.isBuf(r)) r = { buf: r };
  return { offsetSec: 0, send: -14, ...r, fallback };
}

/** place a Buf into dst at t with gain (linear) and constant-power pan with unity centre */
function placeBuf(dst, src, tSec, lin, pan) {
  const off = Math.round(tSec * SR);
  const [gl, gr] = panGains(pan || 0, true);
  const kl = lin * gl, kr = lin * gr;
  const { L, R } = dst, n = dst.length;
  for (let i = 0; i < src.length; i++) {
    const j = off + i;
    if (j < 0) continue;
    if (j >= n) break;
    L[j] += src.L[i] * kl;
    R[j] += src.R[i] * kr;
  }
}

function silenceWindow(cuesMod) {
  const s = (cuesMod.MUSIC && cuesMod.MUSIC.sections || []).find((x) => x.id === 'silence');
  return s ? [s.t0, s.t1] : [cuesMod.FREEZE_T || 22.0, 22.5];
}

/** coverage table rows for a cues module */
export function coverage(cuesMod = defaultCues) {
  const rows = new Map();
  for (const ev of cuesMod.SFX) {
    let r = rows.get(ev.id);
    if (!r) rows.set(ev.id, (r = { id: ev.id, count: 0, first: ev.t, last: ev.t, owner: ownerOf(ev), ok: !!pick(ev) }));
    r.count++;
    r.last = ev.t;
    if (!pick(ev)) r.ok = false;
  }
  return [...rows.values()].sort((a, b) => a.first - b.first || a.id.localeCompare(b.id));
}

/**
 * renderSfx(cues = shared/cues.js) -> Buf (60 s stereo). Everything is timed from cues.SFX.
 * opts: { verbose, only: (ev)=>bool, noLimit }
 */
export function renderSfx(cuesMod = defaultCues, opts = {}) {
  const T = cuesMod.DURATION || 60;
  const dry = new Buf(T);
  const bus = new Buf(T); // shared room send
  const events = [...cuesMod.SFX].sort((a, b) => a.t - b.t);
  const seen = new Map();
  const unknown = new Set();
  const stats = { events: 0, fallback: 0, ms: 0 };
  for (const ev of events) {
    if (opts.only && !opts.only(ev)) continue;
    const n = seen.get(ev.id) || 0;
    seen.set(ev.id, n + 1);
    const r = renderEvent(ev, n, cuesMod);
    if (r.fallback) {
      stats.fallback++;
      unknown.add(ev.id);
    }
    const lin = dbToLin(ev.g || 0);
    const t0 = ev.t - (r.offsetSec || 0);
    placeBuf(dry, r.buf, t0, lin, ev.pan || 0);
    if (r.send > -90) placeBuf(bus, r.buf, t0, lin * dbToLin(r.send), ev.pan || 0);
    stats.events++;
  }

  if (unknown.size && !opts.quiet) {
    console.warn(`\n*** [sfx] WARNING: NO RECIPE for ${unknown.size} id(s): ${[...unknown].join(', ')} - rendered as soft fallback ticks. Add them to recipes_a.mjs / recipes_b.mjs. ***\n`);
  }

  // ---- shared gentle 'room' (short, dark-ish, low-cut so it never muddies the sub) ----
  const wet = dsp.applyReverb(bus, 'room', { wetOnly: true, wet: 1, lowCut: 180, highCut: 8500, decay: 0.55, size: 1.0, damp: 0.5, tail: 0 });
  for (let i = 0; i < dry.length; i++) {
    dry.L[i] += wet.L[i];
    dry.R[i] += wet.R[i];
  }

  // ---- the film's held breath: 20 ms fade into 22.0, digital zero to 22.5 ----
  const [s0, s1] = silenceWindow(cuesMod);
  const a = Math.round((s0 - 0.02) * SR), b = Math.round(s0 * SR), c = Math.round(s1 * SR);
  for (const ch of [dry.L, dry.R]) {
    for (let i = Math.max(0, a); i < b; i++) ch[i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i - a + 0.5)) / (b - a));
    ch.fill(0, b, c);
  }

  // ---- peak protection (transparent unless events pile up) ----
  let out = dry;
  if (!opts.noLimit) {
    const lim = dsp.limiter(dry, { ceilingDb: -1, lookaheadMs: 5, releaseMs: 150, truePeak: true });
    stats.limiterDb = lim.stats.maxReductionDb;
    out = Buf.from(lim.L, lim.R);
  }
  out.report = { ...stats, unknown: [...unknown], coverage: coverage(cuesMod), recipesBLoaded };
  return out;
}
