// =============================================================================
// promo/shared/cues.js — THE single source of truth for the 60.0 s film.
// Plain ESM, no Node/DOM APIs: imported by the browser renderer (/shared/cues.js)
// AND by every Node audio module. Sync is exact by construction: nothing else
// in the project may hard-code a time that is also listed here.
//
// Grid: 120 BPM, beat = 0.5 s, bar = 2.0 s, 30 bars = 60.0 s. 30 fps = 1800 frames.
// Bar n starts at t = 2n.  Frame f is the instant t = f / 30.
// =============================================================================

export const FPS = 30;
export const DURATION = 60;
export const FRAMES = FPS * DURATION; // 1800
export const BPM = 120;
export const BEAT = 60 / BPM; // 0.5
export const BAR = BEAT * 4; // 2.0
export const SAMPLE_RATE = 48000;
export const beats = (n) => n * BEAT;
export const bars = (n) => n * BAR;
export const frameTime = (f) => f / FPS;
export const timeFrame = (t) => Math.round(t * FPS);

// -----------------------------------------------------------------------------
// BRAND — the repo contained NO brand assets (empty repo, see BRAND.md).
// Only the strings the brief itself provides are canon. Everything flagged
// `placeholder:true` or `proposal:true` is listed in README + final report.
// -----------------------------------------------------------------------------
export const BRAND = {
  name: 'Amrita Cinema Studio', // canon (from brief)
  nameCaps: 'AMRITA CINEMA STUDIO',
  persona: 'Amrita', // canon: an AI agent who directs films end to end
  pronoun: 'she',
  credit: 'Directed by Amrita', // canon (from brief)
  tagline: 'Your story. Directed.', // PLACEHOLDER: brief's stated fallback
  taglinePlaceholder: true,
  cta: '[ YOUR URL HERE ]', // PLACEHOLDER: no URL exists anywhere
  ctaPlaceholder: true,
  // The eight jobs (canon: script, storyboard, camera, lighting, cast, edit, color, soundtrack)
  jobs: ['SCRIPT', 'STORYBOARD', 'CAMERA', 'LIGHT', 'CAST', 'SCORE', 'EDIT', 'COLOR'],
  // PROPOSAL palette (no brand colours exist). Every scene draws from this.
  palette: {
    ink: '#0E0D12', // near-black
    graphite: '#2A2833',
    paper: '#F2EBDC', // off-white paper
    paperShade: '#E6DCC6',
    amber: '#FFB62E', // light / marquee gold
    vermilion: '#F2542D', // Amrita's blades / accent
    cream: '#FFF3D6', // Amrita's face (the play triangle)
    teal: '#1FB5A6', // digital / future
    violet: '#6B5BFF', // neural
    sky: '#7CC4FF',
  },
  // PROPOSAL fonts (all SIL OFL, shipped via @fontsource, loaded from /node_modules)
  fonts: {
    display: 'Bebas Neue', // titles, labels, wordmark
    label: 'Inter', // small labels / credit
    hand: 'Caveat', // Act I hand lettering
    type: 'Special Elite', // typewriter / intertitles
    condensed: 'Oswald',
  },
  markPlaceholder: true, // the aperture-iris + play-triangle mark is OUR PROPOSAL
};

// -----------------------------------------------------------------------------
// Aspect ratios & portals
// -----------------------------------------------------------------------------
export const R169 = 16 / 9;
export const R239 = 2.39;

// Portal = the era's focal object. The era scene MUST draw this object at exactly
// (cx, cy, r) in 1920x1080 logical px at the end of its bar; the engine dives into
// it (zooms about it) while the next era is revealed inside it.
//  type: 'lens'|'eye'|'screen'|'porthole'|'phone'   ('screen'/'phone': r = half-width)
//
// music: era orchestration id (one harmonic progression, one tempo, same 4-note motif)
// grade: look preset id in web/engine/grade.js
export const ERAS = [
  { id: 'e1895', year: 1895, caption: 'THE TRAIN ARRIVES', ratio: 4 / 3, grade: 'bw_flicker', prop: 'crank', music: 'silent_piano', portal: { type: 'lens', cx: 1240, cy: 590, r: 110 } },
  { id: 'e1902', year: 1902, caption: 'STAGE MAGIC', ratio: 4 / 3, grade: 'sepia', prop: 'crank', music: 'piano_musicbox', portal: { type: 'eye', cx: 960, cy: 470, r: 120 } },
  { id: 'e1927', year: 1927, caption: 'THE FIRST WORDS', ratio: 1.37, grade: 'bw_talkie', prop: 'megaphone', music: 'lush_strings', portal: { type: 'screen', cx: 960, cy: 520, r: 230 } },
  { id: 'e1939', year: 1939, caption: 'FULL COLOR', ratio: 1.37, grade: 'threestrip', prop: 'megaphone', music: 'strings_harp', portal: { type: 'porthole', cx: 1300, cy: 440, r: 100 } },
  { id: 'e1960', year: 1960, caption: 'THE WIDESCREEN EPIC', ratio: 2.2, grade: 'warm70mm', prop: 'viewfinder', music: 'brass_choir', portal: { type: 'lens', cx: 1100, cy: 400, r: 130 } },
  { id: 'e1977', year: 1977, caption: 'SPACE OPERA', ratio: 2.39, grade: 'grain70s', prop: 'viewfinder', music: 'heroic_fanfare', portal: { type: 'porthole', cx: 1150, cy: 520, r: 95 } },
  { id: 'e1993', year: 1993, caption: 'DIGITAL CREATURES', ratio: 1.85, grade: 'clean90s', prop: 'clapper', music: 'synth_orch', portal: { type: 'eye', cx: 1000, cy: 450, r: 120 } },
  { id: 'e2009', year: 2009, caption: 'THE 3D BOOM', ratio: 1.43, grade: 'tealorange', prop: 'clapper', music: 'braams_taiko', portal: { type: 'lens', cx: 1180, cy: 560, r: 170 } },
  { id: 'e2025', year: 2025, caption: 'VERTICAL VIDEO', ratio: 9 / 16, grade: 'phone', prop: 'slate', music: 'lofi_phone', portal: { type: 'phone', cx: 960, cy: 540, r: 304 } },
];
ERAS.forEach((e, i) => {
  e.index = i;
  e.t0 = 4 + 2 * i;
  e.t1 = e.t0 + 2;
  e.prevRatio = i === 0 ? R169 : ERAS[i - 1].ratio;
  e.diveT0 = e.t0 + 1.5; // last beat of the bar = dive into portal (not for the last era)
  e.hasDive = i < ERAS.length - 1;
});
export const ERA_MATTE_TIME = 0.25; // aspect-ratio bars animate in over the first 0.25 s of each era

// -----------------------------------------------------------------------------
// Jobs (Act II, 8 bars) and Futures
// -----------------------------------------------------------------------------
export const JOBS = [
  { id: 'job_script', label: 'SCRIPT', blurb: 'words type themselves in the air and fold into a script', music: 'pulse' },
  { id: 'job_storyboard', label: 'STORYBOARD', blurb: 'panels snap into a grid, then pop into 3D', music: 'bass' },
  { id: 'job_camera', label: 'CAMERA', blurb: 'virtual cranes and drones fly into position; viewfinder overlay', music: 'drums' },
  { id: 'job_light', label: 'LIGHT', blurb: 'she paints light; key / fill / rim snap on', music: 'pads' },
  { id: 'job_cast', label: 'CAST', blurb: 'stylized ICON characters (no people) step onto their marks', music: 'strings' },
  { id: 'job_score', label: 'SCORE', blurb: 'an orchestra made of light assembles; she conducts the soundtrack we hear', music: 'orchestra' },
  { id: 'job_edit', label: 'EDIT', blurb: 'a timeline slides in; shots snap together on the beat', music: 'stutter' },
  { id: 'job_color', label: 'COLOR', blurb: 'a grade wipe sweeps the frame', music: 'filter_open' },
];
JOBS.forEach((j, i) => {
  j.index = i;
  j.t0 = 26 + 2 * i;
  j.t1 = j.t0 + 2;
});

export const FUTURES = [
  { id: 'f2050', year: 2050, caption: 'HOLOGRAM CINEMA', t0: 42, t1: 44, blurb: 'holographic living-room cinema' },
  { id: 'f2100', year: 2100, caption: 'NEURAL CINEMA', t0: 44, t1: 46, blurb: 'a story painted from thought' },
  { id: 'f2150', year: 2150, caption: 'DREAM CINEMA', t0: 46, t1: 50, blurb: 'the audience physically inside the story, made of particles of light' },
];

// -----------------------------------------------------------------------------
// SCENES — contiguous, cover [0, 60). kind: '2d' (Canvas2D drawn world) | '3d' (three.js)
// ratio: render aspect of the 3D target (visible picture is letterboxed to matteRatio)
// -----------------------------------------------------------------------------
export const SCENES = [
  { id: 'coldopen', kind: '2d', t0: 0, t1: 4, section: 'coldopen' },
  ...ERAS.map((e) => ({ id: e.id, kind: '2d', t0: e.t0, t1: e.t1, section: 'past', era: e.index })),
  { id: 'turn', kind: '3d', t0: 22, t1: 26, section: 'turn', ratio: R169 }, // bars fold to 2.39 by t=24
  ...JOBS.map((j) => ({ id: j.id, kind: '3d', t0: j.t0, t1: j.t1, section: 'jobs', job: j.index, ratio: R239 })),
  ...FUTURES.map((f) => ({ id: f.id, kind: '3d', t0: f.t0, t1: f.t1, section: 'future', ratio: R239 })),
  { id: 'recap', kind: '3d', t0: 50, t1: 54, section: 'recap', ratio: R239 },
  { id: 'endcard', kind: '3d', t0: 54, t1: 60, section: 'end', ratio: R239 },
];
export const SECTIONS = [
  { id: 'coldopen', t0: 0, t1: 4 },
  { id: 'past', t0: 4, t1: 22 },
  { id: 'turn', t0: 22, t1: 26 },
  { id: 'jobs', t0: 26, t1: 42 },
  { id: 'future', t0: 42, t1: 50 },
  { id: 'recap', t0: 50, t1: 54 },
  { id: 'end', t0: 54, t1: 60 },
];
export const NOW_T = 21.5; // HUD slams "NOW"
export const FREEZE_T = 22.0; // everything freezes; paper tears from 22.5

export function sceneAt(t) {
  const tt = Math.min(Math.max(t, 0), DURATION - 1e-6);
  for (const s of SCENES) if (tt >= s.t0 && tt < s.t1) return s;
  return SCENES[SCENES.length - 1];
}
export function sceneById(id) {
  return SCENES.find((s) => s.id === id);
}
export function eraIndexAt(t) {
  if (t < 4 || t >= 22) return -1;
  return Math.min(8, Math.floor((t - 4) / 2));
}

// Running year counter for the HUD. Returns {year:number, now:boolean, show:boolean, roll:0..1}
// Act I: holds the era year for 1.5 s, rolls to the next era year during the dive beat.
// Future: jumps (roll anim over first 0.25 s of each future).
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export function yearAt(t) {
  if (t >= 4 && t < 22) {
    const k = eraIndexAt(t);
    const e = ERAS[k];
    const lt = t - e.t0;
    if (k === 8) return lt >= 1.5 ? { year: 2025, now: true, show: true, roll: 0 } : { year: 2025, now: false, show: true, roll: 0 };
    if (lt < 1.5) return { year: e.year, now: false, show: true, roll: 0 };
    const x = ease((lt - 1.5) / 0.5);
    return { year: e.year + (ERAS[k + 1].year - e.year) * x, now: false, show: true, roll: x };
  }
  if (t >= 42 && t < 50) {
    const k = t < 44 ? 0 : t < 46 ? 1 : 2;
    const f = FUTURES[k];
    const prev = k === 0 ? 2025 : FUTURES[k - 1].year;
    const x = ease((t - f.t0) / 0.25);
    return { year: prev + (f.year - prev) * x, now: false, show: true, roll: x, future: true };
  }
  return { year: 2025, now: false, show: false, roll: 0 };
}

// -----------------------------------------------------------------------------
// HITS — impact frames (camera shake / flash / audio transient). s: S|M|L
// Both the renderer (T.impact) and the audio verifier read this list.
// -----------------------------------------------------------------------------
export const HITS = [
  { t: 22.0, s: 'M', why: 'freeze' },
  { t: 22.5, s: 'L', why: 'sub drop + tear starts' },
  { t: 24.0, s: 'M', why: 'spot ignites on stage' },
  { t: 25.0, s: 'L', why: 'Amrita lands + "Meet Amrita."' },
  { t: 26.0, s: 'M', why: 'jobs begin' },
  { t: 28.0, s: 'S' }, { t: 30.0, s: 'S' }, { t: 32.0, s: 'S' }, { t: 34.0, s: 'S' },
  { t: 36.0, s: 'S' },
  { t: 37.0, s: 'L', why: 'orchestra hit (baton down)' },
  { t: 38.0, s: 'S' }, { t: 40.0, s: 'S' },
  { t: 42.0, s: 'M', why: '2050' },
  { t: 44.0, s: 'S', why: '2100' },
  { t: 46.0, s: 'M', why: '2150' },
  { t: 50.0, s: 'M', why: 'recap' },
  { t: 54.0, s: 'M', why: 'end card' },
  { t: 58.0, s: 'L', why: 'FINAL HIT' },
];
const HIT_STRENGTH = { S: 0.4, M: 0.7, L: 1.0 };
const HIT_TAU = { S: 0.12, M: 0.2, L: 0.35 };
// Decaying impact envelope 0..~1 (use for micro-shake, flash, bloom kick)
export function impact(t) {
  let v = 0;
  for (const h of HITS) {
    const d = t - h.t;
    if (d >= -1 / 60 && d < 1.5) v += HIT_STRENGTH[h.s] * Math.exp(-Math.max(d, 0) / HIT_TAU[h.s]);
  }
  return Math.min(v, 1.4);
}

// -----------------------------------------------------------------------------
// TITLES — drawn by the ENGINE (web/engine/titles.js) so collisions are checkable.
// zone ids are fixed rectangles in the 1920x1080 safe area (see titles.js).
// -----------------------------------------------------------------------------
export const TITLES = [
  { id: 't_blank', text: 'Every film starts with a blank page.', t0: 1.5, t1: 4.0, zone: 'lower', style: 'hand' },
  { id: 't_meet', text: 'Meet Amrita.', t0: 25.0, t1: 26.0, zone: 'lower', style: 'slam' },
  ...JOBS.map((j) => ({ id: 'lab_' + j.label.toLowerCase(), text: j.label, t0: j.t0, t1: j.t1, zone: 'label', style: 'label' })),
  { id: 't_wordmark', text: BRAND.nameCaps, t0: 54.5, t1: 60, zone: 'endTitle', style: 'wordmark' },
  { id: 't_tagline', text: BRAND.tagline, t0: 56.5, t1: 60, zone: 'endTagline', style: 'tagline' },
  { id: 't_cta', text: BRAND.cta, t0: 57.5, t1: 60, zone: 'endCta', style: 'cta' },
  { id: 't_credit', text: BRAND.credit, t0: 57.0, t1: 60, zone: 'endCredit', style: 'credit' },
];
// Era captions (top-left) + year counter + film-strip HUD are drawn by hud.js from ERAS / FUTURES / yearAt().
export const HUD_VISIBLE = [
  [4, 22.0], // Act I
  [42, 50], // the future
];
export const hudVisible = (t) => HUD_VISIBLE.some(([a, b]) => t >= a && t < b);

// -----------------------------------------------------------------------------
// VO — Piper neural TTS, processed per line. t0 = line start (audio onset),
// maxEnd = hard end by which the line MUST be finished (audio builder time-fits).
// -----------------------------------------------------------------------------
export const VO = [
  { id: 'vo1', t0: 1.5, maxEnd: 3.95, text: 'Every film starts with a blank page.' },
  { id: 'vo2', t0: 16.0, maxEnd: 21.4, text: 'For a hundred and thirty years, it took an army to make a movie.' },
  { id: 'vo3a', t0: 22.5, maxEnd: 24.6, text: 'Now it takes one director.' },
  { id: 'vo3b', t0: 25.0, maxEnd: 26.0, text: 'Meet Amrita.' },
  { id: 'vo4a', t0: 26.0, maxEnd: 27.7, text: 'She writes.' },
  { id: 'vo4b', t0: 30.0, maxEnd: 31.7, text: 'She shoots.' },
  { id: 'vo4c', t0: 36.0, maxEnd: 37.7, text: 'She scores.' },
  { id: 'vo4d', t0: 38.0, maxEnd: 39.7, text: 'She cuts.' },
  { id: 'vo5', t0: 46.0, maxEnd: 49.2, text: "And she's just getting started." },
  { id: 'vo6a', t0: 55.0, maxEnd: 56.45, text: 'Amrita Cinema Studio.' },
  { id: 'vo6b', t0: 56.5, maxEnd: 57.95, text: BRAND.tagline.replace(/\s+/g, ' ') }, // "Your story. Directed."
];
// Diegetic line in the 1927 talkie (not narration; radio/optical-soundtrack filter).
export const VO_DIEGETIC = [{ id: 'vo_hello', t0: 9.0, maxEnd: 9.7, text: 'Hello!', filter: 'vintage_optical' }];

// -----------------------------------------------------------------------------
// MUSIC — one tempo, one 4-note motif, one 4-chord loop, re-orchestrated.
// Motif: E4 G4 A4 C5  rhythm: [beat0 len1] [beat1 len.5] [beat1.5 len.5] [beat2 len2]
//   reads minor over Am (Am7 arpeggio) and major over C (C6 arpeggio).
// -----------------------------------------------------------------------------
export const MOTIF = {
  notes: [
    { beat: 0, len: 1, midi: 64 }, // E4
    { beat: 1, len: 0.5, midi: 67 }, // G4
    { beat: 1.5, len: 0.5, midi: 69 }, // A4
    { beat: 2, len: 2, midi: 72 }, // C5
  ],
  barBeats: 4,
};
// Chord per bar (0..29). Arrays = two chords per bar (half-bars).
// Roots/qualities: Am F C G (+ "add9/6" colour allowed). Final bar = C major.
export const CHORDS = [
  'Am', 'Am', // 0-1  cold open drone on A
  'Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G', 'Am', // 2-10 nine eras
  'Am', 'F', // 11-12 turn (silence/sub drop; solo piano motif)
  'C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F', // 13-20 jobs
  'C', 'G', 'Am', 'F', // 21-24 futures (major)
  'Am', 'F', // 25-26 recap (riser)
  'C', ['F', 'G'], 'C', // 27 logo resolve, 28 tagline->dominant, 29 FINAL (hit at 58.0)
];
export const chordAtBar = (n) => CHORDS[Math.max(0, Math.min(29, n))];

export const MUSIC = {
  key: 'C / Am',
  bpm: BPM,
  motif: MOTIF,
  chords: CHORDS,
  // Section arrangement. `layers` are stems that must exist; stems accumulate in the jobs.
  sections: [
    { id: 'open', t0: 0, t1: 4, style: 'drone_only', notes: 'low drone from 1.0; ONE piano note (E4, midi 64) at t=3.0 (eyes open), long reverb tail' },
    { id: 'past', t0: 4, t1: 22, style: 'eras', notes: 'motif once per bar re-orchestrated per ERAS[i].music; same chords (CHORDS) & tempo; matte/portal whooshes ride on top' },
    { id: 'now', t0: 21.5, t1: 22.0, style: 'cut', notes: 'NOW slam at 21.5; ALL audio hard-cut at 22.0 (reverb tails killed by 22.05)' },
    { id: 'silence', t0: 22.0, t1: 22.5, style: 'silence', notes: 'ONE BEAT OF TOTAL SILENCE (digital silence < -90 dBFS) — the film\'s held breath' },
    { id: 'turn', t0: 22.5, t1: 26.0, style: 'sub_drop_piano', notes: 'sub drop at 22.5 (long tail); solo piano plays the motif: E4 24.0, G4 24.5, A4 25.0 (=Meet Amrita hit), C5 25.5 held into 26.0' },
    {
      id: 'jobs', t0: 26, t1: 42, style: 'build',
      notes: 'cumulative stems, one new element on each job downbeat',
      stems: [
        { t: 26, id: 'pulse', desc: '8th-note synth pulse (filtered saw, plucky) on the chord roots' },
        { t: 28, id: 'bass', desc: 'sub/analog bass line on chord roots, syncopated' },
        { t: 30, id: 'drums', desc: 'kick/snare/hat groove, 120 BPM, fills into each bar line' },
        { t: 32, id: 'pads', desc: 'warm wide pads on chords' },
        { t: 34, id: 'strings', desc: 'driving string ostinato (16ths) + motif counter-line' },
        { t: 36, id: 'orchestra', desc: 'FULL ORCHESTRA: brass, choir ooh, timpani; the baton-down hit lands at 37.0 (L)' },
        { t: 38, id: 'stutter', desc: 'on-beat stutter edits: gated/retriggered 1/16 chops of the whole mix, lands each beat' },
        { t: 40, id: 'filter_open', desc: 'lowpass filter sweep opening up from 40.0 to 42.0 over the full mix, ends fully open at 42.0' },
      ],
    },
    { id: 'future', t0: 42, t1: 50, style: 'ethereal_major', notes: 'ethereal choir, granular shimmer; motif in FULL MAJOR (C6 arpeggio over C/G/Am/F); 2150 (46-50) builds to climax; kick returns at 48.0' },
    { id: 'recap', t0: 50, t1: 54, style: 'riser_rewind', notes: 'riser 50->54, tape-rewind texture, timpani roll, applause swell; tension toward the end card' },
    { id: 'end', t0: 54, t1: 60, style: 'resolve_hit', notes: 'logo resolve on C major at 54.0 (soft); dominant G at 57.0; FINAL ORCHESTRAL HIT on C major at 58.0 (+ projector click-off at 59.5); 2 s reverb tail to 60.0' },
  ],
  // The era orchestration ladder (each era plays the motif once per bar, + a bed)
  eraStyles: {
    silent_piano: 'upright silent-film piano, dry & slightly out-of-tune, ragtime vamp, tape wobble',
    piano_musicbox: 'silent-film piano + music box / celesta twinkle (stage magic)',
    lush_strings: 'lush legato string section, warm, first "sound" era (reel-to-reel hiss)',
    strings_harp: 'golden-age strings + harp glissandi + woodwind runs (full color)',
    brass_choir: 'epic brass + wordless male/female choir, big timpani, widescreen warmth',
    heroic_fanfare: 'heroic brass fanfare with snare rolls; ORIGINAL melody, nothing recognizable',
    synth_orch: 'synth-orchestra hybrid: analog pads, FM bells, orchestral stabs, gated reverb snare',
    braams_taiko: 'trailer braams + taiko drums, low distorted brass, risers',
    lofi_phone: 'lo-fi phone-speaker beat: band-limited 400 Hz-4 kHz, mono, bitcrush, vinyl, dusty drums',
  },
  endHit: { t: 58.0, chord: 'C', desc: 'full orchestra + choir + timpani + sub, wide, long tail to 60.0' },
  projectorClickOff: 59.5,
};

// -----------------------------------------------------------------------------
// SFX — event list. id → recipe lives in audio/sfx/*.mjs (audio builder).
// {t, id, g?: dB trim, pan?: -1..1, dur?: seconds, ...params}
// Scene agents may ADD events by exporting from shared/cues_extra/<sceneId>.js.
// -----------------------------------------------------------------------------
import extras from './cues_extra/index.js';

const SFX_BASE = [];
const S = (t, id, o = {}) => SFX_BASE.push({ t, id, ...o });

// --- cold open
S(0.0, 'projector_motor', { dur: 4.0, spinUp: 2.0 }); // rattle + low motor, spins up
S(1.0, 'lamp_ignite'); // thunk + arc buzz
S(1.0, 'beam_hum', { dur: 3.0 });
S(3.0, 'eyes_open'); // soft glass pop + tiny tinkle (coincides with the piano note)
S(3.5, 'riser_short', { dur: 0.5 });
// --- the past
ERAS.forEach((e, i) => {
  S(e.t0, 'matte_slide', { g: -6 }); // aspect-ratio bars sliding (soft thunk)
  if (e.hasDive) {
    S(e.diveT0, 'dive_whoosh', { dur: 0.5 });
  }
});
S(4.0, 'iris_click');
S(4.0, 'crank_loop', { dur: 1.5 });
S(4.25, 'train_chuff', { dur: 1.25 });
S(4.75, 'train_whistle');
S(6.0, 'curtain_swish');
S(6.5, 'magic_poof');
S(6.75, 'sparkle_up');
S(8.0, 'card_thunk'); // intertitle card slaps in
S(10.0, 'color_bloom'); // shimmering swell: the world floods with color
S(10.5, 'chime_run');
S(12.5, 'horn_distant');
S(13.0, 'wind_desert', { dur: 1.0 });
S(14.5, 'laser_zap', { pan: -0.4 });
S(14.75, 'laser_zap', { pan: 0.0 });
S(15.0, 'laser_zap', { pan: 0.4 });
S(15.0, 'model_explosion', { g: -4 });
S(16.5, 'digital_scan', { dur: 0.5 });
S(17.0, 'creature_roar');
S(18.5, 'pop_out'); // 3D "pop-out" whoosh + bass thump
S(19.0, 'imax_boom');
S(20.0, 'matte_squeeze'); // frame squeezes to 9:16
S(20.5, 'phone_tap');
S(20.75, 'notification_ping');
S(21.0, 'swipe');
S(21.25, 'heart_pop');
S(21.375, 'heart_pop', { pan: 0.3 });
S(21.5, 'now_slam');
// --- the turn
S(22.5, 'sub_drop');
S(22.5, 'paper_tear', { dur: 1.5 });
S(23.0, 'paper_flutter', { dur: 1.5 });
S(24.0, 'spot_clunk'); // stage spot ignites + hum
S(24.5, 'whoosh_down', { dur: 0.5 }); // Amrita drops in
S(25.0, 'land_thud');
S(25.0, 'title_hit');
// --- the jobs (labels: soft tick on every downbeat)
JOBS.forEach((j) => S(j.t0, 'label_tick'));
for (let k = 0; k < 8; k++) S(26 + 0.125 * k, 'typewriter_key', { pan: -0.2 + 0.05 * k }); // 8 keys = 8 words typed in the air
S(27.0, 'typewriter_bell');
S(27.25, 'page_fold');
S(27.5, 'page_snap');
for (let k = 0; k < 6; k++) S(28.25 + 0.125 * k, 'panel_snap', { pan: -0.5 + 0.2 * k }); // 6 storyboard panels
S(29.5, 'panel_pop_3d');
S(30.0, 'crane_servo', { dur: 1.0 });
S(30.25, 'drone_buzz', { dur: 1.0 });
S(31.0, 'viewfinder_on');
S(31.5, 'focus_beep');
S(32.0, 'brush_light', { dur: 0.5 });
S(32.5, 'light_clunk', { id2: 'key', pan: -0.4 }); // key
S(33.0, 'light_clunk', { id2: 'fill', pan: 0.4 }); // fill
S(33.5, 'light_clunk', { id2: 'rim', pan: 0.0, g: 1 }); // rim
for (let k = 0; k < 5; k++) S(34.25 + 0.25 * k, 'foot_tap', { pan: -0.6 + 0.3 * k }); // 5 icon characters onto marks
S(35.5, 'cast_ready');
S(36.0, 'orch_tune', { dur: 1.0 }); // orchestra tune-up swell into the hit
S(37.0, 'baton_whoosh');
for (let k = 0; k < 6; k++) S(38.25 + 0.25 * k, 'timeline_click', { pan: -0.5 + 0.2 * k }); // 6 shots snap on the beat grid
S(38.0, 'timeline_slide', { dur: 0.25 });
S(39.75, 'playhead_zip');
S(40.0, 'grade_wipe', { dur: 1.0 }); // shimmer sweep
S(41.0, 'grade_set');
S(41.5, 'riser_short', { dur: 0.5 });
// --- the future
S(42.0, 'year_jump');
S(42.0, 'holo_hum', { dur: 2.0 });
S(44.0, 'year_jump');
S(44.5, 'neural_swell', { dur: 1.5 });
S(46.0, 'year_jump');
S(46.0, 'dream_shimmer', { dur: 4.0 });
S(48.0, 'swell_climax', { dur: 2.0 });
// --- recap + end
S(50.0, 'rewind_texture', { dur: 4.0 });
S(50.0, 'riser', { dur: 4.0 });
S(53.0, 'push_whoosh', { dur: 1.0 });
S(54.0, 'logo_resolve');
S(56.0, 'tagline_tick');
S(57.0, 'cta_tick');
S(58.0, 'impact_big');
S(59.5, 'projector_clickoff');

export const SFX = [...SFX_BASE, ...extras.sfx].sort((a, b) => a.t - b.t);

// -----------------------------------------------------------------------------
// CROWD — a real human audience, from 42.0: individual voice clips + individual
// hand-claps (never noise). kinds: gasp laugh whoa oh no_way murmur cheer clap applause
// n = number of distinct voices/people; applause: t0..t1 with level envelope
// -----------------------------------------------------------------------------
export const CROWD = [
  { t: 42.5, kind: 'gasp', n: 3 },
  { t: 43.25, kind: 'laugh', n: 2 },
  { t: 43.75, kind: 'oh', n: 2 },
  { t: 44.5, kind: 'whoa', n: 4 },
  { t: 45.25, kind: 'no_way', n: 2 },
  { t: 45.5, kind: 'murmur', n: 6, dur: 1.5 },
  { t: 46.5, kind: 'gasp', n: 8 },
  { t: 47.0, kind: 'whoa', n: 10 },
  { t: 47.5, kind: 'laugh', n: 6 },
  { t: 48.0, kind: 'cheer', n: 12 },
  { t: 49.5, kind: 'whoa', n: 8 },
  { t: 49.0, kind: 'applause', t1: 58.0, peak: 54.0, base: 0.15, peakLevel: 1.0, n: 90 }, // swells to 54.0, sustains under the end card, fades by 58
  { t: 53.5, kind: 'cheer', n: 20 },
  { t: 54.25, kind: 'cheer', n: 14 },
  ...extras.crowd,
];

// -----------------------------------------------------------------------------
// Helper: build the per-frame time struct passed to every scene.
// -----------------------------------------------------------------------------
export function makeT(t) {
  const tt = Math.min(Math.max(t, 0), DURATION);
  const sc = sceneAt(tt);
  const lt = tt - sc.t0;
  const dur = sc.t1 - sc.t0;
  const beat = tt / BEAT;
  const bar = Math.floor(tt / BAR);
  const era = sc.section === 'past' ? ERAS[sc.era] : null;
  return {
    t: tt,
    f: tt * FPS, // fractional frame
    scene: sc,
    lt,
    dur,
    u: Math.min(1, Math.max(0, lt / dur)),
    beat, // global beat (float)
    bar,
    bt: (tt - bar * BAR) / BEAT, // beat within bar 0..4
    boil: Math.floor(tt * 12 + 1e-6), // 12 fps line-boil index
    boilT: Math.floor(tt * 12 + 1e-6) / 12,
    impact: impact(tt),
    era,
    chord: chordAtBar(bar),
  };
}
