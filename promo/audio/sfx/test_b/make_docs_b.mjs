#!/usr/bin/env node
// Writes (or replaces) the '## recipes_b' section of audio/sfx/RECIPES.md from META in recipes_b.mjs + measured solo renders.
// Other authors' sections are left untouched.   node audio/sfx/test_b/make_docs_b.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dsp from '../../lib/dsp.mjs';
import * as cues from '../../../shared/cues.js';
import { renderEvent, coverage, SPLIT } from '../index.mjs';
import { analyse } from '../test/solo.mjs';
import { META } from '../recipes_b.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOC = path.join(HERE, '..', 'RECIPES.md');
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-inf');
const rows = [];
for (const id of Object.keys(META)) {
  const evs = cues.SFX.map((e, i) => ({ e, i })).filter((x) => x.e.id === id);
  const first = evs.length ? evs[0].e : { t: 0, id };
  const r = renderEvent(first, 0, cues);
  const lin = dsp.dbToLin(first.g || 0), [gl, gr] = dsp.panGains(first.pan || 0, true);
  const buf = new dsp.Buf(r.buf.length / dsp.SR);
  for (let i = 0; i < buf.length; i++) { buf.L[i] = r.buf.L[i] * lin * gl; buf.R[i] = r.buf.R[i] * lin * gr; }
  const a = analyse(r.buf);
  const times = evs.map((x) => x.e.t);
  rows.push({ id, n: evs.length, t0: times.length ? times[0] : null, a, send: r.send, pre: r.offsetSec || 0, meta: META[id] });
}
const esc = (s) => s.replace(/\|/g, '\\|');
let out = '## recipes_b\n\n';
out += 'Recipes for every cue event with `t >= 26.0` (the eight jobs, the three futures, the recap, the end card, the final hit) in `audio/sfx/recipes_b.mjs` (+ one safety-net id, `pencil_scratch`, used only while `recipes_a.mjs` has no recipe for it).\n';
out += 'Same contract as recipes_a (`(ev, ctx) => Buf | {buf, offsetSec, send}`); the dispatcher applies `ev.g` / `ev.pan`. Pitched material is tuned to the chord of the bar (Am F C G); multi-event ids (typewriter keys, panel snaps, timeline clicks, foot taps, baton ribbons, year jumps) vary pitch / velocity / timbre per event through `runInfo()`.\n\n';
out += 'Tests (`audio/sfx/test_b/`): `solo_b.mjs [ids] [--bands --env --nopng]` renders ids through the real dispatcher path and writes `<id>.wav` + spectrogram PNG (`audio/build/tmp/sfx_b/`); `pitch_b.mjs` checks every tonal recipe against its intended notes; `stem_b.mjs [--png]` checks the whole stem for t >= 26 (determinism, coverage, NaN/DC/edges, per-second loudness, per-event timing, HIT alignment); `run_all.mjs` runs them all.\n\n';
out += 'Peak = the recipe\'s designed level before `ev.g`; `Lk300` = loudest 300 ms K-weighted level; `S/M` = side-to-mid energy; `corr` = L/R correlation; `pre` = pre-roll (cue time is `pre` seconds into the buffer).\n\n';
out += '| id | first cue | n | len s | pre s | peak dBFS | Lk300 dB | S/M dB | corr | send dB | description |\n|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const r of rows) out += `| \`${r.id}\` | ${r.t0 === null ? '-' : r.t0} | ${r.n} | ${f(r.a.len, 2)} | ${f(r.pre, 2)} | ${f(r.a.peakDb)} | ${f(r.a.lk300)} | ${f(r.a.sm, 0)} | ${f(r.a.corr, 2)} | ${r.send} | ${esc(r.meta)} |\n`;
const cov = coverage(cues).filter((x) => x.first >= SPLIT);
out += `\n### Coverage (cues.SFX, t >= ${SPLIT})\n\n* ${cov.length} distinct ids, ${cov.reduce((s, x) => s + x.count, 0)} events; missing recipes: ${cov.filter((x) => !x.ok).map((x) => x.id).join(', ') || 'none'}.\n`;
out += '* Ids at t >= 26 that reuse recipes_a (events other scene authors added): `paper_flutter`, `sparkle_up`, `swipe`, `riser_short`, `digital_scan`, `chime_run`, `pop_out`, `train_whistle`, `magic_poof`.\n';
out += '* A new id added later in `shared/cues_extra/*.js` with no recipe renders as the soft fallback tick with a loud warning (dispatcher); add it to `recipes_b.mjs` (t >= 26) or `recipes_a.mjs`.\n';
let doc = fs.existsSync(DOC) ? fs.readFileSync(DOC, 'utf8') : '# audio/sfx - sound-effect recipes\n\n';
const i = doc.indexOf('\n## recipes_b');
if (i >= 0) {
  const rest = doc.slice(i + 1);
  const j = rest.indexOf('\n## ', 1);
  doc = doc.slice(0, i + 1) + (j >= 0 ? rest.slice(j + 1) : '');
}
if (!doc.endsWith('\n')) doc += '\n';
doc += '\n' + out;
fs.writeFileSync(DOC, doc);
console.log(`RECIPES.md: recipes_b section written (${rows.length} ids)`);
