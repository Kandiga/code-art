// Extra cue events owned by the `e1927` scene author. Times are GLOBAL seconds on the 0.5 s beat grid
// (or 0.125 s sub-grid). id must be a known recipe in audio/sfx or a new id you tell the SFX author about.
// sfx: [{t, id, g?, pan?, dur?}]   crowd: [{t, kind, n, dur?}]
// All ids reuse existing recipes (recipes_a.mjs).
export default {
  sfx: [
    { t: 8.5, id: 'iris_click', g: -4 }, // the intertitle card irises away
    { t: 9.0, id: 'heart_pop', g: -8 }, // the speech balloon pops out with "Hello!" (the diegetic voice is cues.VO_DIEGETIC)
    { t: 9.125, id: 'lamp_ignite', g: -6 }, // the projector lamp strikes as the camera pulls back
    { t: 9.125, id: 'beam_hum', g: -8, dur: 0.875 },
  ],
  crowd: [],
};
