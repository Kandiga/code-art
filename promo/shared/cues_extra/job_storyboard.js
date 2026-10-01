// Extra cue events owned by the `job_storyboard` scene author. Times are GLOBAL seconds on the 0.5 s beat grid
// (or 0.125 s sub-grid). id must be a known recipe in audio/sfx or a new id you tell the SFX author about.
// sfx: [{t, id, g?, pan?, dur?}]   crowd: [{t, kind, n, dur?}]
// The base list (cues.js) already carries: 28.25 + 0.125k panel_snap x6 · 29.5 panel_pop_3d.
// Existing recipes only (audio/sfx/recipes_a.mjs):
export default {
  sfx: [
    { t: 28.0, id: 'swipe', g: -12, pan: 0.2 },        // ghost grid brackets fade in as the first panel is dealt
    { t: 29.625, id: 'sparkle_up', g: -9, pan: 0.0 },   // shimmer as the diorama layers settle after the pop
  ],
  crowd: [],
};
