// Extra cue events owned by the `job_score` scene author. Times are GLOBAL seconds on the 0.5 s beat grid
// (or 0.125 s sub-grid). id must be a known recipe in audio/sfx or a new id you tell the SFX author about.
// sfx: [{t, id, g?, pan?, dur?}]   crowd: [{t, kind, n, dur?}]
// The base list (cues.js) already carries: 36.0 orch_tune (dur 1.0, the tuning swell the light-orchestra assembles to) and 37.0 baton_whoosh;
// HITS has the L orchestral hit at 37.0 (baton lands on the ictus). The visuals also pulse on 37.5 and 38.0 (beats 2 and 3 of the
// conducting pattern) from the music itself; no extra SFX is needed there.
export default { sfx: [], crowd: [] };
