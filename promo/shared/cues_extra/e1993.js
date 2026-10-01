// Extra cue events owned by the `e1993` scene author. Times are GLOBAL seconds on the 0.5 s beat grid
// (or 0.125 s sub-grid). id must be a known recipe in audio/sfx or a new id you tell the SFX author about.
// sfx: [{t, id, g?, pan?, dur?}]   crowd: [{t, kind, n, dur?}]
// All ids reuse existing recipes (recipes_a.mjs).
export default {
  sfx: [
    { t: 16.5, id: 'card_thunk', g: -6 },       // the clapperboard CLAP (same instant as the digital_scan sweep starts)
    { t: 17.25, id: 'eyes_open', g: -9 },        // the eye turns to look at us (a soft glass pop as the iris opens on the camera)
  ],
  crowd: [],
};
