// Extra cue events owned by the `e1939` scene author. Times are GLOBAL seconds on the 0.5 s beat grid
// (or 0.125 s sub-grid). id must be a known recipe in audio/sfx or a new id you tell the SFX author about.
// sfx: [{t, id, g?, pan?, dur?}]   crowd: [{t, kind, n, dur?}]
// All ids reuse existing recipes (recipes_a.mjs). Base cues (cues.js): 10.0 color_bloom, 10.5 chime_run.
// Amrita's skipping hops LAND on 10.5 (chime_run), 11.0 and 11.5 (below): a soft bubble "bloop" on each extra landing.
export default {
  sfx: [
    { t: 11.0, id: 'heart_pop', g: -10, pan: 0.15 }, // landing 2: sparkle burst + ring
    { t: 11.5, id: 'heart_pop', g: -9, pan: 0.3 }, //  landing 3: sparkle burst + ring (the dive starts 11.5)
  ],
  crowd: [],
};
