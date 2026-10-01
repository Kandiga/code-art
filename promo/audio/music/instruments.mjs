// =============================================================================
// audio/music/instruments.mjs  -  the orchestra / band / FX palette for the 60 s film.
//
//   import * as inst from './instruments.mjs';
//   const buf = inst.render('strings', notes, {seconds: 60, art: 'legato', gainDb: -3});   // -> Buf (stereo, 48 kHz)
//   inst.INSTRUMENTS.piano.render(notes, opts)                                                // same thing
//
// NOTES are in GLOBAL FILM TIME (seconds):  {t, dur, midi, vel 0..1, pan -1..1 (optional), gainDb (optional), ...per-instrument}
//   * pitched instruments need `midi`; drums use `vel` (+ optional `midi` for pitched drums); FX use t + dur (+ midi).
//   * `dur` is the key-down / gate time; every voice adds its own release tail (the Buf is `opts.seconds` long, default 60 s).
//   * slow-attack voices (strings, pads, choir, drone, shimmer) place their perceived onset on `t` (the swell starts a little earlier).
//   * deterministic: seeded per note (`opts.seed`, default 1); the same notes always give the same samples.
//
// RENDER OPTIONS (all instruments):  {seconds=60, buf (mix into an existing Buf), gainDb, pan, seed, transpose (semis), octave, segGap}
//   plus the per-instrument options listed in INSTRUMENTS.md (e.g. strings: art:'legato'|'swell'|'staccato'|'spiccato'|'ostinato'|'tremolo'|'pizz').
//
// LEVELS: every instrument is calibrated so vel=0.8 gives roughly the same loudness (single notes ~ -22 dBFS RMS, percussion peaks
// ~ -3 dBFS). Mix with gainDb; the composer owns balance, reverb and the limiter.
//
// REVERB: instruments are DRY (with their own tasteful character). Each exposes a recommended send:
//   inst.reverbFor('harp') -> {preset:'hall', wet:0.3}      inst.applySend(bus, 'harp', {wetScale:1, tail:0}) -> wet-only Buf to ADD to the mix
//   (one reverb per bus, not per note: sum the notes of a bus first, then send).
//
// IDS (see INSTRUMENTS.md for options):
//   keys     piano piano_grand musicbox celesta harp
//   strings  strings strings_low strings_high strings_spiccato strings_staccato strings_ostinato strings_tremolo strings_pizz
//   brass    trumpets horns brass_low        winds  flute clarinet        choir  choir
//   perc     kick snare snare_gated hat clap toms timpani taiko sub808 cymbal
//   synth    synth_pulse synth_bass synth_pad fm_bell supersaw drone
//   fx       riser reverse_swell sub_drop braam impact tape_rewind shimmer
// HELPERS:  harpGliss(t, from, to, opts)  windRun(t, from, to, opts)  drumRoll(t0, t1, opts)  crashSignal(n, seed, opts)
// PROCESSORS (era character, Buf -> Buf):  tapeWobble vinylCrackle reelHiss opticalSoundtrack lofiPhone brickwallBright warmTape goldenAge monoize
//   inst.processors.tapeWobble(buf, opts)  /  inst.PROCESSORS[name]
// ERA_STYLES: one arrangement kit per cues.ERAS[i].music id (data + functions):
//   const kit = inst.ERA_STYLES.lush_strings;      // or inst.eraKit(cues.ERAS[2])  / eraKit('lush_strings') / eraKit(2)
//   kit.motifInstrument kit.padInstrument kit.rhythmInstrument kit.extras[] kit.processors kit.reverbPreset kit.mixDb
//   kit.render('motif'|'pad'|'rhythm'|<extra role>, notes, opts) -> Buf   (the kit's instrument + options; opts override)
//   kit.send(buf)      -> wet-only era reverb to add      kit.process(buf) -> era processors (wobble / hiss / optical / lo-fi ...)
//   kit.finish({motif: Buf, pad: Buf, ...}, {wetScale}) -> dry mix (mixDb) + reverb send + processors, master gain
// =============================================================================
import * as dsp from '../lib/dsp.mjs';
import { REGISTRY, getInstrument } from './instruments/common.mjs';
import './instruments/keys.mjs';
import './instruments/strings.mjs';
import './instruments/winds.mjs';
import './instruments/choir.mjs';
import './instruments/drums.mjs';
import './instruments/synths.mjs';
import './instruments/fx.mjs';
import { PROCESSORS } from './instruments/processors.mjs';
import { ERA_DATA } from './presets.mjs';
import * as cues from '../../shared/cues.js';

export { harpGliss } from './instruments/keys.mjs';
export { windRun } from './instruments/winds.mjs';
export { drumRoll, crashSignal } from './instruments/drums.mjs';
export * as processors from './instruments/processors.mjs';
export { PROCESSORS, ERA_DATA };

export const INSTRUMENTS = Object.fromEntries(REGISTRY);
/** render(id, notes, opts) -> Buf */
export const render = (id, notes, opts) => getInstrument(id).render(notes, opts);
export const list = () => [...REGISTRY.keys()];
export const info = (id) => {
  const i = getInstrument(id);
  return { id: i.id, name: i.name, family: i.family, kind: i.kind, desc: i.desc, options: i.options, defaults: i.defaults, reverb: i.reverb, range: i.range || null, gainDb: i.gainDb };
};
export const reverbFor = (id) => ({ ...getInstrument(id).reverb });
/** wet-only reverb of `bus` using the instrument's recommended preset: add the result to your mix. */
export function applySend(bus, id, opts = {}) {
  const { preset, wet, ...rest } = reverbFor(id);
  const { wetScale = 1, tail = 0, preset: p2, ...over } = opts;
  return dsp.applyReverb(bus, p2 || preset, { ...rest, wet: (opts.wet != null ? opts.wet : wet) * wetScale, wetOnly: true, tail, ...over });
}

// ---------------------------------------------------------------------------------------------------------------------
// era kits
// ---------------------------------------------------------------------------------------------------------------------
function buildKit(id, d) {
  const layers = { motif: d.motif, pad: d.pad, rhythm: d.rhythm };
  for (const e of d.extras || []) layers[e.role] = e;
  const kit = {
    id, ...d,
    motifInstrument: d.motif, padInstrument: d.pad, rhythmInstrument: d.rhythm,
    reverbPreset: d.reverb,
    layers,
    render(layer, notes, opts = {}) {
      const L = layers[layer];
      if (!L) throw new Error(`era kit ${id}: no layer "${layer}" (have ${Object.keys(layers).filter((k) => layers[k]).join(', ')})`);
      return getInstrument(L.id).render(notes, { ...L.opts, ...opts });
    },
    process(buf, over = {}) {
      let y = buf;
      for (const p of d.processors) y = PROCESSORS[p.id](y, { ...p.opts, ...(over[p.id] || {}) });
      return y;
    },
    send(buf, over = {}) {
      const { preset, wet, ...rest } = d.reverb;
      const { wetScale = 1, tail = 0, ...o } = over;
      return dsp.applyReverb(buf, preset, { ...rest, wet: wet * wetScale, wetOnly: true, tail, ...o });
    },
    finish(bufs, opts = {}) {
      const names = Object.keys(bufs).filter((k) => bufs[k]);
      const first = bufs[names[0]];
      const out = new dsp.Buf(first.length / dsp.SR);
      const dry = new dsp.Buf(first.length / dsp.SR);
      for (const k of names) dsp.addAt(dry, bufs[k], 0, d.mixDb[k] != null ? d.mixDb[k] : (d.mixDb.rhythm || 0) - 2, 0);
      dsp.addAt(out, dry, 0, 0, 0);
      if ((opts.wetScale == null ? 1 : opts.wetScale) > 0) dsp.addAt(out, kit.send(dry, { wetScale: opts.wetScale == null ? 1 : opts.wetScale }), 0, 0, 0);
      const y = opts.process === false ? out : kit.process(out);
      return y.gain(d.mixDb.master || 0);
    },
  };
  return kit;
}
export const ERA_STYLES = Object.fromEntries(Object.entries(ERA_DATA).map(([id, d]) => [id, buildKit(id, d)]));
/** eraKit('lush_strings') | eraKit(2) (era index) | eraKit(cues.ERAS[2]) */
export function eraKit(x) {
  const id = typeof x === 'string' ? x : typeof x === 'number' ? cues.ERAS[x].music : x.music;
  const k = ERA_STYLES[id];
  if (!k) throw new Error(`no era kit "${id}"`);
  return k;
}
// every cues.ERAS music id must have a kit (checked at import: a missing kit is a build error, not a silent gap)
for (const e of cues.ERAS) if (!ERA_STYLES[e.music]) throw new Error(`instruments.mjs: no ERA_STYLES kit for cues.ERAS[${e.index}].music = "${e.music}"`);
