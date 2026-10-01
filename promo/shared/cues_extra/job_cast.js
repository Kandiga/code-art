// Extra cue events owned by the `job_cast` scene author. Times are GLOBAL seconds on the 0.5 s beat grid
// (or 0.125 s sub-grid). id must be a known recipe in audio/sfx or a new id you tell the SFX author about.
// sfx: [{t, id, g?, pan?, dur?}]   crowd: [{t, kind, n, dur?}]
// The base list (cues.js) already carries: 34.25 + 0.25k foot_tap x5 (pan -0.6..+0.6, one icon lands per tap) and 35.5 cast_ready
// (all five strike a pose, the marks flash, Amrita snaps her clapperboard).
// Existing recipe only (audio/sfx/recipes_a.mjs): a quiet glitter on the pose burst, one 16th after the cast_ready downbeat so it does not smear the hit.
export default {
  sfx: [
    { t: 35.625, id: 'sparkle_up', g: -13, pan: 0.1 },   // 5 x 34 sparks fly off the marks as the cast lands its pose
  ],
  crowd: [],
};
