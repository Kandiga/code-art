// Extra cue events owned by the `coldopen` scene author. Times are GLOBAL seconds on the 0.5 s beat grid
// (or 0.125 s sub-grid). id must be a known recipe in audio/sfx or a new id you tell the SFX author about.
// sfx: [{t, id, g?, pan?, dur?}]   crowd: [{t, kind, n, dur?}]
//
// NEW SFX ID (needs a recipe): 'pencil_scratch' — dry graphite-on-paper strokes, 1.0 s, soft & close, a few separate strokes
// (compass swing 2.0, six quick blade strokes 2.25-2.8, three triangle strokes 2.7-3.0). Visual: the sketch writes on 2.0-3.0.
export default {
  sfx: [
    { t: 2.0, id: 'pencil_scratch', dur: 1.0, g: -7 },
  ],
  crowd: [],
};
