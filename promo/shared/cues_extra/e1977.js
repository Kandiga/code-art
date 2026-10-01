// Extra cue events owned by the `e1977` scene author. Times are GLOBAL seconds on the 0.5 s beat grid
// (or 0.125 s sub-grid). id must be a known recipe in audio/sfx or a new id you tell the SFX author about.
// sfx: [{t, id, g?, pan?, dur?}]   crowd: [{t, kind, n, dur?}]
// All ids reuse existing recipes (recipes_a.mjs).
export default {
  sfx: [
    { t: 14.25, id: 'viewfinder_on', g: -8 },   // Amrita snaps her viewfinder up to frame the model shot (beat 1.5 of the bar)
    { t: 15.25, id: 'sparkle_up', g: -14 },     // the cockpit glow powers up: the porthole becomes the hero circle
  ],
  crowd: [],
};
