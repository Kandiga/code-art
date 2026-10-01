// Extra cue events owned by the `turn` scene author. Times are GLOBAL seconds on the 0.5 s beat grid
// (or 0.125 s sub-grid). All ids are existing recipes (audio/sfx/recipes_a.mjs). Nothing is added in 22.0-22.5 (digital silence).
// sfx: [{t, id, g?, pan?, dur?}]   crowd: [{t, kind, n, dur?}]
export default {
  sfx: [
    { t: 24.0, id: 'beam_hum', dur: 2.0, g: -10 }, // the spot's hum while the volumetric cone ignites (24.0 HIT M)
    { t: 25.125, id: 'eyes_open', g: -8 }, // Amrita's eyes open after the landing squash (blink -> determined)
    { t: 25.5, id: 'sparkle_up', g: -10 }, // determined -> happy (on the C5 piano note)
  ],
  crowd: [],
};
