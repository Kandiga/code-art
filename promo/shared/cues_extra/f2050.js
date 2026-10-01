// Extra cue events owned by the `f2050` scene author (2050 HOLOGRAM CINEMA, 42.0-44.0). Times are GLOBAL seconds on the 0.5 s beat grid.
// ids are existing recipes (audio/sfx). The crowd (gasp 42.5 / laugh 43.25 / oh 43.75) is already in cues.js; the picture is cut to it:
//   42.00 HIT M + glitch-in      42.25 the pane unfolds, parallax layers fly apart   42.50 GASP: family leans in, loco headlamp ignites on the horizon
//   43.00 the loco BREAKS THROUGH the screen (kid points)   43.25 LAUGH: toot + steam   43.50 loco dissolves into light, Amrita snaps the slate   43.75 'OH': the moon glows
export default {
  sfx: [
    { t: 42.0, id: 'digital_scan', dur: 0.25, g: -4 },
    { t: 42.25, id: 'sparkle_up', g: -9, pan: -0.2 },
    { t: 42.5, id: 'chime_run', g: -11, pan: 0.15 },
    { t: 43.0, id: 'pop_out', g: -3 },
    { t: 43.25, id: 'train_whistle', g: -6, pan: 0.25 },
    { t: 43.5, id: 'magic_poof', g: -7, pan: 0.2 },
    { t: 43.5, id: 'timeline_click', g: -5, pan: -0.35 },
    { t: 43.75, id: 'chime_run', g: -9 },
  ],
  crowd: [],
};
