# SCORE_B - the score for 26.0 .. 60.0 s

Original music: **one tempo (120 BPM, beat 0.5 s, bar 2 s), one 4-note motif (E4 G4 A4 C5), one 4-chord loop (C G Am F)**.
All pitches are diatonic to C major / A minor; every time comes from `shared/cues.js` (`CHORDS`, `MOTIF`, `MUSIC.sections`,
`HITS`, `SFX`, `VO`). Deterministic (seeded `mulberry32`, no `Math.random` / `Date.now`), 48 kHz, stereo, float32.
Nothing quotes any real film or piece: the material is a 4-note cell, a I-V-vi-IV loop, and its retrograde (C A G E) used once as an answer.

Files: `score_b.mjs` (the score + mixdown), `render.mjs` (`renderMusic()` = score A + score B + master -> `build/stems/music.wav`),
`test_b/` (numbers: `analyze.mjs`, `onsets.mjs`, `key_check.mjs`, `layers.mjs`, `view.mjs`).

```bash
node audio/music/score_b.mjs --solo     # B alone -> audio/build/stems/music_b.wav (60 s long, digital silence before 26.0, mastered)
node audio/music/render.mjs             # A (if audio/music/score_a.mjs exists) + B + master -> audio/build/stems/music.wav
node audio/music/test_b/analyze.mjs     # loudness per bar, peaks, hits at 37.0 / 58.0, tail, beat-grid transients
node audio/music/test_b/onsets.mjs      # every drum / pluck layer: note start vs nominal time (isolated notes)
node audio/music/test_b/key_check.mjs   # symbolic key + motif check, chroma of the rendered audio
node audio/music/test_b/view.mjs        # spectrogram + waveform PNGs in audio/build/tmp/score_b/
```
A layer cache (`audio/build/tmp/score_b_cache`, content-addressed by instrument id + notes + options + a hash of all instrument/lib
sources) makes re-mixing cheap; `--no-cache` bypasses it. The output is bit-identical with or without it.

## Public API

```js
import { renderScoreB, masterBus, buildLayers, voiceLead, stutter, filterOpen, TIME, LV } from './score_b.mjs';
renderScoreB(buf, ctx?)   // buf: 60 s dsp.Buf; ADDS the score for 26..60 into it (un-mastered). ctx: {log, cache, only, skip}
masterBus(buf, {ceilingDb=-2.1, glue=true})  // -> new Buf: glue compressor (1.5:1) + true-peak safety limiter
// render.mjs
renderMusic({log, cache}) -> Promise<path of build/stems/music.wav>
```
`ctx` is the same shape score A is given by `render.mjs`: `{ log: fn, cache: bool }` (both are optional for both scores).

## Arrangement (every row starts ON the bar line / downbeat given by cues)

| t (s) | bar | chord | what enters / happens | notes |
|---|---|---|---|---|
| 26.0 | 13 | C | **PULSE** - 8th-note filtered-saw pluck on the roots (C3), dotted-8th ping-pong echo | solo piano C5 from score A rings into it; alone under "She writes."; last beat = the motif as 16ths (E G A C) |
| 28.0 | 14 | G | **BASS** - syncopated 3+3+2 root line (analog bass) + long sub-808; last hit anticipates the next root | |
| 30.0 | 15 | Am | **DRUMS** - kick / snare+clap backbeat / 8th hats; snare-16th fill into 32.0 | VO "She shoots." |
| 32.0 | 16 | F | **PADS** - warm wide pad, voice-led, common tones tied: Fmaj7 Cadd9 Gsus2 Am7 Fmaj7; tom run into 34.0; pulse motif quote again | |
| 34.0 | 17 | C | **STRINGS** - 16th-note ostinato (compact inversions) + the motif as a violin counter-line (E5 G5 A5 C6); 16th hats; snare roll + cymbal swell into 36.0 | |
| 36.0 | 18 | G | **FULL ORCHESTRA** - horns / trumpets / low brass / strings / 6-voice choir swell on G, timpani roll, cymbal swell peaking on the hit; everything but the hit drops out for 70 ms before it | VO "She scores." |
| **37.0** | 18 | G | **BATON-DOWN HIT (L)** - impact L, timpani G2+D3, taiko, sub-808 G1, low brass, horns, trumpets, strings, 8-voice choir, crash, all on one downbeat; held to 38.0 | HITS L |
| 38.0 | 19 | Am | **STUTTER** - on-beat gated / retriggered 1/16 chops of the WHOLE jobs mix; the beat's own 16th always lands. Brass states the motif (horns E4.., trumpets E5..), low-brass pedal, choir Am, timpani | VO "She cuts." |
| 40.0 | 20 | F | **FILTER OPEN** - resonant 24 dB/oct low-pass over the whole mix, 240 Hz at 40.0 -> fully open at 42.0 (equal-power bypass in the last 120 ms); motif again over F (Fmaj9 reading); snare roll under the filter | |
| 42.0 | 21 | C | **THE FUTURE** - the band drops away (jobs fall out in < 1 s); ethereal choir, harp ripples on C6 (C E G A), granular shimmer, celesta; the choir sings the motif in C major | M hit |
| 44.0 | 22 | G | Gsus2 colour: retrograde answer (C6 A5 G5 E5), celesta echo of the motif two octaves up, high strings enter | S hit |
| 46.0 | 23 | Am | 2150 builds: tremolo strings, horn + low-brass swells, timpani roll, the motif in the choir on Am7 | M hit; VO 5 |
| **48.0** | 24 | F | **CLIMAX** - the kick returns (+ clap, hats, pulse, bass, taiko, timpani, crash); trumpets / horns / violins / 8-voice choir state the motif in major over Fmaj7 | cues: kick returns at 48.0 |
| 50.0 | 25 | Am | **RECAP** - tremolo strings + swelling Am7 -> Fmaj7, low-brass swell, two timpani rolls (A2 then F2), tonal riser to C6, tape-rewind of the music itself (the jobs mix played backwards, accelerating), impact M | no kick/bass/pulse: room for the applause |
| 53.92 | 26 | F | the recap is cut 80 ms before the end card (a held breath) | |
| 54.0 | 27 | C | **LOGO RESOLVE** - soft C major: choir, shimmer, harp bloom, celesta plays the motif one last time (E5 G5 A5 C6), sub on C | M hit (soft) |
| 56.0 | 28 | F | strings + horns + low-string pedal swell | |
| 57.0 | 28 | G | dominant: swell grows, timpani roll on G | |
| 57.9 | 28 | - | **the inhale**: every soft element is cut 100 ms before the hit | |
| **58.0** | 29 | C | **FINAL HIT** - impact L, sub-808 C1 + C2, timpani C3+G2, taiko, low brass, horns, trumpets, three string sections, 8-voice choir, crash, shimmer + harp sparkle; one big wide reverb (RT 3.3 s) | HITS L |
| 58..60 | | | the tail rings and fades (raised-cosine^2 from 59.2) to digital near-silence on the last sample | SFX click-off at 59.5 lands in it |

## Design notes

* **Stems build exactly on the cues**: `cues.MUSIC.sections[jobs].stems` times (26 pulse, 28 bass, 30 drums, 32 pads, 34 strings,
  36 orchestra, 38 stutter, 40 filter_open) are read from cues, as are the hit times (`HITS`), the kick-return (`SFX swell_climax`),
  the final hit (`MUSIC.endHit`) and the F -> G half-bar (`CHORDS[28]`).
* **Harmony**: the loop is C G Am F throughout. Jobs use darker colours (Fmaj7, Cadd9, Gsus2, Am7); the future uses the same chords in
  a major reading (the motif over C is the C6 arpeggio, over F it is Fmaj9, over Am7 it is just chord tones). Gsus2 keeps the motif's C
  from rubbing against a B; the real G major (with B) appears only at the dominant moments: the baton hit and 57.0.
* **Voice leading**: `voiceLead()` = dynamic programming over all legal voicings (no minor 2nds, compact span), minimising motion of
  every voice (extra weight on the top line); `tieChords()` ties common tones so pads / choir / strings breathe instead of re-attacking.
* **Humanisation**: seeded velocity jitter (+-4..6 %) everywhere; timing stays exactly on the grid (only rolls are loose by design).
* **Space for the voice**: the motif counter-line sits in the gaps between VO lines; the whole stem also gets a gentle "vocal pocket"
  (peak EQ -2.6 dB at 2.3 kHz, -1.4 dB at 520 Hz, +-80 ms around every `cues.VO` line); the mix stage still ducks the stem 8-10 dB.
  The only unavoidable overlap is the baton hit (37.0) inside "She scores." and the climax inside VO 5 (the mix ducks).
* **Held breaths**: 70 ms before the baton hit, 80 ms before the end card and 100 ms before the final hit every pre-hit element is cut,
  so the hit itself starts from near-silence and its transient is the first thing the ear sees. Hit layers are separate groups so
  they are not dipped.
* **Master**: `masterBus()` = RMS glue compressor (-17 dB, 1.5:1, 40 ms / 280 ms) + 5 ms-lookahead true-peak limiter at -2.1 dBFS;
  a 28 Hz Butterworth high-pass removes sub-audible energy before it.
* **Reverbs**: one send per bus per section (plate for synth/snare, hall for drums/strings/harp, bigHall for pads/brass/fx, cathedral
  for the choir/shimmer, a custom RT 3.3 s cathedral for the final hit). All tails are time-limited: jobs release < 1 s after 42.0, the
  future releases over 1.3 s after 50.0, the recap and the soft end-card section are cut before the next hit.

## Measured (all numbers from `test_b/*`, final render; B alone = `music_b.wav`, A + B + master = `music.wav`)

**Level / loudness (B alone, 2 s windows, LUFS, ungated)** - the jobs rise every bar, the future breathes, the end is the loudest moment

| bar | 26 | 28 | 30 | 32 | 34 | 36 | 38 | 40 | 42 | 44 | 46 | 48 | 50 | 52 | 54 | 56 | 58 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LUFS | -25.4 | -24.7 | -21.6 | -20.4 | -19.0 | -15.8 | -15.5 | -14.9 | -20.3 | -19.8 | -18.4 | -14.9 | -20.8 | -16.8 | -23.5 | -22.2 | -14.9 |

* integrated -18.1 LUFS (B alone), LRA 9.6; whole stem A + B: -18.8 LUFS, LRA 10.5 (eras -29 -> -16, turn -25, jobs -25 -> -15, future -20 -> -15, end card -23, final hit -15).
* sample peak -2.12 dBFS, true peak -2.10 dBTP, DC < 5e-7, no clipped sample. Master: glue compressor max GR 3.5 dB (1-2 dB average in the loud bars),
  true-peak limiter max GR 0.44 dB (only the two hits touch it). The premaster peaks at +0.8 dBFS on the baton hit (all hit layers sum coherently).
* Spectral balance (dB re total power per octave band, 38-40 s): 20-40 Hz -11, 40-80 -8, 80-160 -5, 160-320 -9, 320-640 -9, 640-1.3k -11, 1.3-2.6k -15, 2.6-5k -17, 5-10k -18, 10-20k -22.
  Sub (20-40 Hz) is only strong on the two hits (-7 dB share at 37-38, -7 at 58-59); the 28 Hz high-pass keeps the headroom for the mids.

**Timing**

* **Baton hit: onset 37.0000 s (|d| = 0.04 ms). FINAL hit: onset 57.9999 s (|d| = 0.10 ms).** The 70 ms / 100 ms held breaths before them measure -55 dBFS RMS.
* Every drum / pluck layer, note by note, in isolation (`onsets.mjs`, 47 layers): worst note start vs nominal time **0.90 ms** (kick 0.02, snare 0.04, hats 0.04, timpani 0.00-0.04,
  taiko 0.00-0.02, impacts 0.04, pulse 0.15, bass 0.9, sub 0.13, harp 0.04). Nothing is over 5 ms.
* In the finished mix (`analyze.mjs`, HF transient at each beat of 30-42 and 48-50): median |offset| 0.81 ms, the beat-comb correlation peaks at lag +1 ms;
  22 of 27 beats are within +-5 ms - the other five (35.5, 36.0, 37.5, 40.0, 49.0) are swells (cymbal swell peaks ON 36.0), slow-attack brass (49.0) or beats under the closed filter (40.0).
* Click scan (`clicks.mjs`, HF spikes > 18 dB over the local level): 4 in the whole stem, all below -56 dBFS and on the 1/32 grid: the stutter edits, group cuts and dips are click-free.

**Tail**: RMS per 0.25 s after the hit: -14.1, -15.8, -16.0, -15.6, -15.9, -18.9 (59.25), -27.8 (59.5, the SFX click-off lands here), -51.0 (59.75); peak of the last 50 ms -91.7 dBFS; the last sample is 0.

**Music theory** (`key_check.mjs`): all 728 pitched notes of the 109 layers are diatonic to C / Am; the motif (E G A C) is stated at 27.5 and 33.5 (pulse, 16ths), 34.0 (violins), 38.0 and 40.0 (horns + trumpets), 42.0 and 46.0 (choir; its retrograde C A G E answers at 44.0), 45.0 (celesta echo), 48.0 (trumpets, horns, violins) and 54.0 (celesta, the logo melody); chroma of the rendered stem: chord tones carry 51-89 % of the pitched
energy per bar and out-of-key energy is < 9 % everywhere except 30-32 (18 %: the first drum bar is mostly snare / hat noise, nothing pitched is out of key).
In the future bars out-of-key energy is 0.8-2.1 %, at the logo resolve 0.4 %.

**Stereo** (`stereo.mjs`): side/mid -16 dB (the opening pulse) opening to -3 dB in the future; L/R correlation 0.95 -> 0.32; correlation of the < 150 Hz band >= 0.92 everywhere
(centred low end); mono fold-down loses at most 1.8 dB.

**Determinism** (`determinism.mjs`): warm run (layer cache), cold run (`--no-cache`) and a second warm run in three fresh processes give the same SHA-1 of the WAV.
Render time: B alone ~40-60 s warm / ~70-120 s cold on the shared (load 12-15) machine; `render.mjs` (A + B + master) ~70 s; RSS ~410 MB.

## Known issues / notes for the mixer

* No audio playback exists here: balance was set by loudness, spectral and chroma measurements and by reading spectrograms, not by ear.
* Overlaps with narration that the arrangement cannot avoid: the baton hit at 37.0 lands inside "She scores." (36.0-37.7) and the 48.0 climax inside VO 5 (46.0-49.2).
  The stem already has a deeper vocal pocket there (x1.3 / x1.8 of the 2.6 dB at 2.3 kHz); the mix stage's 8-10 dB duck still applies.
* The recap's tonal riser (`rRiser`), tape-rewind instrument (`rTape`) and the rewound-music texture (`rRewind`) are deliberately quiet (-8 / -8 / -14 dB trims in `LV`):
  the SFX stem has its own `riser` and `rewind_texture` at 50.0. If the sum is too busy, mute `rRiser` / `rTape` (`ctx.skip: ['rRiser', 'rTape']`).
* Strings / choir / brass are synthesised (see `INSTRUMENTS.md`): convincing as a mix element behind reverb, not as exposed solos.
* The master `masterBus()` is mild on purpose; the final mix still has to bring the whole film to -14 LUFS / -1.5 dBTP.
