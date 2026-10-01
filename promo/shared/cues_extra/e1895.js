// Extra cue events owned by the `e1895` scene author. Times are GLOBAL seconds on the 0.5 s beat grid
// (or 0.125 s sub-grid). id must be a known recipe in audio/sfx or a new id you tell the SFX author about.
// sfx: [{t, id, g?, pan?, dur?}]   crowd: [{t, kind, n, dur?}]
//
// Picture <-> sound contract for 1895 (see shots/e1895.md):
//   train_chuff (base event 4.25, dur 1.25): puffs are drawn on the 0.25 s grid 4.25 4.5 4.75 5.0 5.25 (+5.5) -> please keep the
//   chuffs on 8ths (2 per beat), accelerating nothing; the 1.25 s event covers 4.25..5.5.
//   train_whistle 4.75: the whistle jet + "TOOOOT!" start on this frame; the station clock minute hand clicks to 12 on it.
//   crowd gasp 5.0: the platform folk flinch (hat flies off, arms up) — exactly the "audience flinches" beat.
export default {
  sfx: [],
  crowd: [
    { t: 5.0, kind: 'gasp', n: 4 },
    { t: 5.25, kind: 'murmur', n: 4, dur: 0.6 },
  ],
};
