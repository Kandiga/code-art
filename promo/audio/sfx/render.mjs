#!/usr/bin/env node
// =============================================================================
// audio/sfx/render.mjs - writes audio/build/stems/sfx.wav (60.000 s, 48 kHz, stereo, 32-bit float)
//   node audio/sfx/render.mjs          (CLI)       |    import { renderSfx } from './render.mjs'  (build.mjs)
// Prints the coverage table (every id in cues.SFX: count, first time, owner A/B, recipe present?). Ids without a
// recipe get a soft fallback tick and a loud warning. Re-run is bit-identical (seeded RNG only).
// =============================================================================
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dsp from '../lib/dsp.mjs';
import * as meter from '../lib/meter.mjs';
import { stemPath, ensure, STEMS } from '../lib/paths.mjs';
import * as cues from '../../shared/cues.js';
import { renderSfx as renderSfxBuf, coverage, SPLIT, recipesBLoaded } from './index.mjs';

export function printCoverage(rows) {
  const w = (s, n) => String(s).padEnd(n);
  console.log('\nSFX coverage (cues.SFX):');
  console.log(`${w('id', 20)}${w('n', 4)}${w('first', 8)}${w('owner', 7)}recipe`);
  let miss = 0;
  for (const r of rows) {
    if (!r.ok) miss++;
    console.log(`${w(r.id, 20)}${w(r.count, 4)}${w(r.first.toFixed(3), 8)}${w(r.owner === '-' ? '-' : r.owner === 'A' ? 'A' : 'B', 7)}${r.ok ? 'ok' : '*** MISSING (fallback tick) ***'}${r.first < SPLIT ? '' : '  [t >= ' + SPLIT + ': recipes_b]'}`);
  }
  const early = rows.filter((r) => r.first < SPLIT);
  console.log(`-> ${rows.length} ids / ${rows.reduce((a, r) => a + r.count, 0)} events;  t < ${SPLIT}: ${early.filter((r) => r.ok).length}/${early.length} ids covered;  total missing ids: ${miss}${recipesBLoaded ? '' : '   (recipes_b.mjs not present yet)'}`);
}

export async function renderSfx() {
  const t0 = Date.now();
  const buf = renderSfxBuf(cues);
  const out = stemPath('sfx');
  ensure(STEMS);
  dsp.writeWav(out, buf);
  const rep = buf.report;
  printCoverage(rep.coverage);
  const pk = meter.truePeak(buf);
  const sil = meter.silenceCheck(buf, 22.0, 22.5);
  console.log(`\n[sfx] ${rep.events} events (${rep.fallback} fallback) -> ${path.relative(process.cwd(), out)}  ${buf.seconds.toFixed(3)} s  true peak ${pk.db.toFixed(2)} dBTP  limiter max GR ${rep.limiterDb.toFixed(2)} dB`);
  console.log(`[sfx] silence 22.0-22.5: ${sil.silent ? 'DIGITAL SILENCE' : 'NOT SILENT'} (peak ${sil.peakDb.toFixed(1)} dBFS)   render ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (rep.unknown.length) console.warn(`\n*** [sfx] ${rep.unknown.length} id(s) without a recipe: ${rep.unknown.join(', ')} ***`);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  renderSfx().catch((e) => { console.error(e); process.exit(1); });
}
