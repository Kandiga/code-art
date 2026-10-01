// Extra cue events owned by the `e1902` scene author. Times are GLOBAL seconds on the 0.5 s beat grid
// (or 0.125 s sub-grid). id must be a known recipe in audio/sfx or a new id you tell the SFX author about.
// sfx: [{t, id, g?, pan?, dur?}]   crowd: [{t, kind, n, dur?}]
export default {
  sfx: [
    { t: 7.0, id: 'eyes_open', g: -3 }, // the sleepy moon wakes: its eye opens (7.0-7.5) and stares into the lens
  ],
  crowd: [],
};
