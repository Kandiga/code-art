// Extra cue events owned by the `e1960` scene author. Times are GLOBAL seconds on the 0.5 s beat grid
// (or 0.125 s sub-grid). id must be a known recipe in audio/sfx or a new id you tell the SFX author about.
// sfx: [{t, id, g?, pan?, dur?}]   crowd: [{t, kind, n, dur?}]
// All ids reuse existing recipes (recipes_a.mjs). Base cues (cues.js): 12.5 horn_distant, 13.0 wind_desert.
export default {
  sfx: [
    { t: 12.25, id: 'iris_click', g: -7 }, // the viewfinder snaps around the sun (brackets glint)
  ],
  crowd: [],
};
