# SCORE A - the original score for 0 .. 26 s

`audio/music/score_a.mjs` (composer A). Cold open, nine eras, the NOW slam, the held breath, the sub drop and the solo-piano turn.
Everything is timed from `shared/cues.js` (`BEAT`, `BAR`, `ERAS[i].t0/diveT0`, `MOTIF`, `CHORDS`, `NOW_T`, `FREEZE_T`, `sceneById('turn')`); the only
literals are pitches and orchestration. Deterministic (seeded RNG, 48 kHz stereo float32), bit-identical across processes and cache modes.

## Run

```bash
node audio/music/score_a.mjs --solo            # -> audio/build/stems/music_a.wav (60 s stem; music 0-26 s, piano tail rings to ~29 s). ~15 s warm, ~35 s cold
node audio/music/score_a.mjs --solo --png      # + spectrograms in audio/music/test_a/*.png
node audio/music/score_a.mjs --solo --eras 0,3 # only some eras (dev); --dbg prints per-layer RMS / low / high share; --nocache disables the layer cache
node audio/music/test_a/check_a.mjs            # measurements + pass/fail on music_a.wav (silence, peaks, onsets, pitches, in-key, ranges, ...)
node audio/music/test_a/test_determinism.mjs   # cold vs cached vs cached, three fresh processes, SHA-1 identical (about 70 s)
```

```js
import { renderScoreA, planA, subBoom } from './score_a.mjs';
const r = await renderScoreA(buf, ctx);   // ADDS 0..~29 s of music into the shared 60 s stereo Buf; returns { local: Buf (32 s), report }
// ctx (all optional): { gainDb: trim of the whole of A, seed: re-roll micro-variation, cache: false, eras: [i...], quiet: true, log: fn, debug: true }
```

`renderScoreA` is self-contained (own era reverbs / processors / limiter), it does not need `ctx` sends. It already applies a -3.0 dBFS true-peak limiter
(never engaged: pre-limiter peak is -3.2 dBFS). `planA()` returns every planned pitched event `{era, layer, id, t, midi, dur, vel}` for tests.
Layer renders are cached in `audio/build/tmp/score_a/` (key = instrument + notes + options + source mtimes); the cache never changes the output.

## The piece

One tempo (120 BPM), one 4-note motif E4 G4 A4 C5 (rhythm = `cues.MOTIF`: E 1 beat, G and A half a beat, C held 2 beats) stated once per bar, one chord loop
(Am F C G, `cues.CHORDS`). Every era re-orchestrates it, gets bigger and "newer". Harmony is voice-led: the pad triads move by step or stay
(`E3 A3 C4` Am -> `F3 A3 C4` F -> `E3 G3 C4` C -> `D3 G3 B3` G -> Am: top voice C C C B C, inner A A G G A, lower E F E D E), bass line A2 F2 C3 G2.
Over G the motif's C is a sus4: the G bars use `D3 G3 D4` (9th instead of the 3rd) and let the harp supply the B.

**The dive (last beat of every era, `diveT0..t1`)**: four rising 16ths A-B-C-D (diatonic, steps into E) in the next era's register, played by that era's own
instrument (honky piano, celesta, spiccato, flute + harp gliss, spiccato + timpani roll, trumpet stabs + snare roll, synth pluck + reverse swell, brass stabs +
taiko ruff + riser) plus a swell/roll on the next chord's root. They resolve into the next era's first motif note E (E4 / E5 / E3 ...). The whole mix then
**dips 10 dB for 40 ms** right before each matte slide (cosine ramps, back to unity exactly at t0) so the new orchestration lands with a clean attack;
all downbeat events are locked to t0 + 0 .. 1.5 ms.

## Cold open 0 - 4

| t | what |
|---|---|
| 0 - 0.92 | true silence (projector motor from the SFX stem only) |
| 1.0 | `drone` A1 + E2 + A2 fades in (audible > -75 dBFS at 1.15 s), swells to 3.0 / 4.0, fades under the 1895 piano |
| 3.0 | ONE piano note, E4 (`piano_grand`, pedal, vel .56), `cathedral` reverb (RT ~6.5 s, +ghost reverse swell at -24 dB); the tail crosses 4.0 (about -4 dB re the dry note) and decays over the first era |

## The nine eras (4 - 22, one bar each; chord from `CHORDS`)

Mix: every layer has a dB trim and a reverb send; the bar is calibrated to a target loudness so the arc rises (momentary LUFS of the bar, measured on the finished stem).
Era processors (`inst.PROCESSORS`) run on the era sum after the reverb; the 2009 reverb tail is squeezed into the phone band over the 0.25 s matte squeeze at 20.0.

| t0 | era / chord | motif voice (register) | bed / pad | rhythm | colour | dive pickup (last beat) | room + processing | LUFS (bar) |
|---|---|---|---|---|---|---|---|---|
| 4 | 1895 Am | upright piano, out of tune x1.25, E4 G4 A4 C5 | none | ragtime stride LH: A2+A3 oom, A3 C4 E4 pah, E3+E2, whisper of pah | - | RH run A3 B3 C4 D4 (cresc.) | room .16; tape wobble, reel hiss, vinyl crackle | -27.1 |
| 6 | 1902 F | honky piano E4..C5 + celesta E5..C6 | - | busier oom-pah (F2+C3, F3 A3 C4, syncopated stab) | music box answers the motif at E6..C7, a beat later | piano A3..D4 + celesta A4..D5 | chamber .20; wobble, hiss, crackle | -26.1 |
| 8 | 1927 C | violins E5 G5 A5 C6 + violas E4..C5 (legato, fast bow) | strings pad E3 G3 C4, cellos+basses C2 G2 | pizz: C3 G3 C2 on the downbeat, E4 G4 C5 on beat 2; **only sustained notes under "Hello!" (9.0-9.7)** | optical-soundtrack band 130 Hz-5.8 kHz, near-mono, hiss | strings swell on G2 D3 G3 + spiccato A4 B4 C5 D5 | chamber .24; `opticalSoundtrack` | -24.4 |
| 10 | 1939 G | violins E5..C6 + clarinet E4..C5 + flute E5..C6 (breath) | strings pad D3 G3 D4, cello G2 D3 | harp glissando G2 -> G5 starting exactly on t0, then rolling arpeggio 8ths | golden-age warmth | harp gliss G3 -> D6 + flute A5 B5 C6 D6 | hall .26; `goldenAge` | -22.9 |
| 12 | 1960 Am | horns E4..C5 + horns E3..C4 (fast attack) | choir ooh>aah on A2 E3 A3 C4 E4 A4, tuba A1 A2 E3, cellos | timpani A2 (+rim on the downbeat) beats 1 and 3 | widescreen bigHall | timpani roll on the next root F2 + brass swell F2 C3 + spiccato A4..D5 | bigHall .30; `warmTape` | -20.2 |
| 14 | 1977 F | trumpets E5 G5 A5 C6 + trumpets E4..C5 (original melody = the motif, nothing quotes a fanfare) | horns F3 A3 C4, low brass F2 C3 | snare march (8 hits) + a 20 hits/s roll across the last beat, timpani F2, 16th ostinato F3 C4 A3 C4, crash on the downbeat | heroic | trumpet stabs A4 B4 C5 D5 + snare roll | hall .27; `warmTape`, wobble, hiss | -18.3 |
| 16 | 1993 C | FM bell E4..C5 + FM bell E5..C6 (LP 6.5 kHz) | analog pad E3 G3 C4 E4, legato strings | kick 1 + 3 (+ghost), gated snare 2 + 4, synth bass C2 line | supersaw stab on the downbeat; **VO2 starts 16.0: -3 dB dip at 3.2 kHz** | synth pluck A4..D5 + reverse swell into 18.0 | plate .22; `brickwallBright` | -17.0 |
| 18 | 2009 G | brass_low E3 G3 A3 C4 + E2..C3 + stabbing horns E4..C5 | tremolo basses G2 D3 G3 D4 | BRAAM G1 + impact M on the downbeat, taiko 1, 2.5, 3, 4, sub G1 | **VO2** (-3 dB at 3.2 kHz), HP 32 Hz | brass stabs A3..D4 + taiko ruff + 1 s riser peaking at 20.0 | bigHall .24; `brickwallBright` | -14.4 |
| 20 | 2025 Am | felt piano E4..C5 (laid back, 3 ms late) | soft analog pad | boom-bap: kick on 1 and 2.5 (+ghost; pre-saturated so its harmonics live in the phone band), dusty snare 2 + fill, swung hats, bass A2 | band-limited mono 400 Hz-4 kHz, 11-bit / 16 kHz crush, vinyl; **VO2** dip | - (NOW) | room .10; `lofiPhone`, `vinylCrackle` | -16.3 incl. NOW lead-in (beat alone about -20) |

**NOW 21.5** (not through the phone filter): 0.55 s noise+tone riser peaking at 21.5, strings crescendo on A (A3 E4 A4 C5), harp rush A2 -> A7 in about 0.25 s, then a full-band
Am hit voiced upward (A1 A2 E3 | A3 C4 E4 A4 | E4 A4 C5 E5 trumpets) with timpani + taiko + cymbal + impact M + sub, about -13.5 LUFS. 14 dB breath dip before it.
**22.0**: hard cut (3 ms cosine), every tail dead (`cutAt`), **22.0 - 22.5 is exact digital silence** (max |x| = 0).

## Turn 22.5 - 26 (+ tail)

| t | what |
|---|---|
| 22.5 | **sub boom** (own synthesis, mono, peak -9 dBFS): A1 sine (55 Hz, settles from 5 semitones sharp in 45 ms) + 3rd harmonic, A0 (27.5 Hz) body, 110 Hz 2nd harmonic so it speaks on small speakers; two-stage decay, tail about 2.5 s (-15 dB at +1.0 s, -33 dB at +2.5 s). Supports (does not copy) `cues.SFX` `sub_drop`. |
| 22.5 - 24.0 | the cold-open drone breathes back (A1 E2 A2, -30 dB, hidden under VO3a), gone by 24.4 |
| 24.0 | solo `piano_grand`: E4 24.0 (vel .50), G4 24.5 (.56), A4 25.0 (.74, "Meet Amrita") , C5 25.5 (.70, held, key down to 26.5) - the "even" reading of the motif. Left hand sparse: F2 + C3 at 24.0, F1 + F2 + F3 at 25.0 (short, so the F clears before the C chord at 26.0). Pitches measured: 329.1 / 392.3 / 440.4 / 523.6 Hz (within 3 cents). |
| reverb | `bigHall` (RT 4.2 s) wet .5, pedal down; the tail rings on across the jobs downbeat 26.0 (C5 is the common tone of F and C): -35 dBFS RMS at 26.5-27.5, gone by 29. **Score B must not cut it** (it is added, not replaced). |

## Measured (`test_a/check_a.mjs`)

* 22.0-22.5: peak -inf dBFS, max |x| = 0; music alive (RMS -16.7 dBFS) up to 21.998.
* peak -3.2 dBFS (true peak -3.2 dBTP), no clipping, DC < 5e-6; 0-30 s integrated -19.6 LUFS, LRA 13.7, momentary max -13.1 (the NOW hit).
* Downbeat onsets (start of the biggest rise, 1.2-9 kHz): every era t0 and NOW within -1.5..-0.5 ms, flux 10-23 dB; sub drop -0.5 ms; piano E4 -0.5 ms.
* Notes: 269 planned pitched events, all diatonic to C / Am, all inside the instruments' playable ranges, all within +-6 ms of the 16th grid (glissandi excepted).
* Stereo: L/R correlation .5-.9; mono sum within -1.6 dB of stereo.

## Mix notes for the mixer

* The era bars are shaped to rise 14 dB; do not normalise per era. A fixed trim of music A is available as `ctx.gainDb`.
* VO windows: vo1 1.5-3.95 (drone + one note: quiet already), vo_hello 9.0 (sustained C5 only), vo2 16.0-21.4 (eras 1993-2025 already carry a -3 dB dip at 3.2 kHz),
  vo3a 22.5-24.6 (sub + drone only until 24.0), vo3b 25.0 (piano A4 / C5; a duck deeper than 6 dB would bury the only music of the turn).
* The hard cut at 22.0 and the silence are part of the music stem; do not add reverb or tails from other stems into 22.0-22.5 (the SFX stem has nothing there by design).

## Known limits

* Pure synthesis: strings / choir / brass are convincing as a mix element behind reverb, not as exposed solos (see `INSTRUMENTS.md`).
* The pre-downbeat dip is audible as a tiny "breath" on sustained pads (that is the intent; set the depth in `dipBefore` calls if it is too much).
* No headphones in this environment: balance was set by loudness / spectral measurements and spectrogram review, not by ear.
