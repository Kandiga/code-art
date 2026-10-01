// Extra cue events owned by the `job_script` scene author. Times are GLOBAL seconds on the 0.5 s beat grid
// (or 0.125 s sub-grid). id must be a known recipe in audio/sfx or a new id you tell the SFX author about.
// sfx: [{t, id, g?, pan?, dur?}]   crowd: [{t, kind, n, dur?}]
// The base list (cues.js) already carries: 26.0 + 0.125k typewriter_key x8 · 27.0 typewriter_bell · 27.25 page_fold · 27.5 page_snap.
// Existing recipes only (audio/sfx/recipes_a.mjs), so nothing here can be "unknown":
export default {
  sfx: [
    { t: 27.125, id: 'paper_flutter', dur: 0.35, g: -9, pan: -0.3 }, // the eight words flatten into pages and swirl to the assembly point
    { t: 27.625, id: 'sparkle_up', g: -10, pan: -0.15 },              // sparkle trail while the bound booklet floats to Amrita
  ],
  crowd: [],
};
