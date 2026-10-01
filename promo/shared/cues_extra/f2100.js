// Extra cue events owned by the `f2100` scene author (2100 NEURAL CINEMA, 44.0-46.0).
// Times are GLOBAL seconds on the 0.5 s beat grid (or 0.125 s sub-grid). ids are existing recipes already used by cues.js.
// sfx: [{t, id, g?, pan?, dur?}]   crowd: [{t, kind, n, dur?}]
export default {
  sfx: [
    { t: 44.0, id: 'digital_scan', dur: 0.25, g: -4 },        // the digital glitch pop on the cut (together with year_jump)
    { t: 44.0, id: 'baton_whoosh', g: -7, pan: 0.35 },        // baton ictus 1: first volley of ribbons bursts from the forehead
    { t: 44.5, id: 'baton_whoosh', g: -8, pan: 0.30 },        // ictus 2: the moon is painted (eyes: happy -> determined)
    { t: 45.0, id: 'baton_whoosh', g: -8, pan: 0.30 },        // ictus 3: hills / road
    { t: 45.375, id: 'sparkle_up', g: -8, pan: 0.0 },         // castle windows + stars light up
    { t: 45.5, id: 'baton_whoosh', g: -6, pan: 0.30 },        // ictus 4: final volley, Amrita's eyes go wide (awe)
    { t: 45.5, id: 'chime_run', g: -7, pan: 0.0 },
  ],
  crowd: [],
};
