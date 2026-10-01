# audio/ - the sound of the 60 s film

Everything is **deterministic Node ESM** (no `Math.random`, no `Date.now`; seeded `mulberry32` only) and timed from
`shared/cues.js` (`BEAT = 0.5 s`, `BAR = 2 s`, 120 BPM, `CHORDS`, `MOTIF`, `SFX`, `VO`, `CROWD`, `HITS`).
Never hard-code a time that is in cues. New SFX events go in `shared/cues_extra/<sceneId>.js`, never in `cues.js`.

```
audio/
  build.mjs            orchestrator CLI (music | sfx | vo | crowd | mix)
  lib/                 the shared DSP foundation (this README, section "Library")
    dsp.mjs            THE import: re-exports core gen filt fx verb dyn
    core.mjs           SR, Buf, addAt, fade, WAV I/O, resampler, RNG, note/dB helpers
    gen.mjs            osc (polyBLEP), noise, LFO, ADSR / curves, FM, Karplus, additive, stepGate
    filt.mjs           biquad, svf, onepole, ladder, formant bank, butterworth
    fx.mjs             delay, pingPong, chorus, ensemble, flanger, phaser, bitcrush, waveshape, tremolo, widen, varispeed, granularCloud
    verb.mjs           FFT, convolution, generated IRs, 8-line FDN reverb, presets, phone speaker
    dyn.mjs            envelope, compressor, sidechain, duck, gate, limiter (true-peak), softclip, automate
    meter.mjs          BS.1770-4 loudness, true peak, RMS, DC, windowed stats      (separate import)
    ff.mjs             ffmpeg helpers: pitchShift, timeStretch, filterChain, spectrogramPng, ebur128 (separate import)
    theory.mjs         chords, motif events, grid, scales, sequencer                (separate import)
    paths.mjs          ROOT / AUDIO / BUILD / STEMS / OUT, stemPath('music')
    cli.mjs            `spec | wave | stats | curve | silence` inspection CLI for any wav
    test/              run_all.mjs, test_*.mjs, bench.mjs, render_gallery.mjs
  music/render.mjs     export async function renderMusic()  -> build/stems/music.wav
  sfx/render.mjs       export async function renderSfx()    -> build/stems/sfx.wav
  vo/render.mjs        export async function renderVo()     -> build/stems/vo.wav + vo_lines.json
  crowd/render.mjs     export async function renderCrowd()  -> build/stems/crowd.wav
  mix.mjs              export async function mix()          -> ../out/audio_master.wav
  build/               generated (git-ignored): stems/, tmp/
```

## Conventions

| thing | rule |
|---|---|
| sample rate | **48 000 Hz** everywhere (`SR`); `readWav` resamples anything else on load |
| channels | stereo; `Buf = {L: Float32Array, R: Float32Array, length (samples), seconds}`; mono = bare `Float32Array` |
| precision | float32 storage, float64 filter state; **WAV output is 32-bit float** (`writeWav(path, buf)`; `{bits:24|16}` adds seeded TPDF dither) |
| time | **seconds** (global film time). Params ending `Ms` are milliseconds, `Db` decibels, `Hz` hertz |
| level | dB; `dbToLin`/`linToDb` (floors at -240). Stems are rendered at natural level, peak <= 0 dBFS, no normalising |
| length | every stem is exactly **60.000 s = 2 880 000 samples** (`new Buf(60)`); tails may not extend past it |
| pan | `addAt` with a mono `Float32Array`: constant-power law (centre = -3 dB per side). With a stereo `Buf`: balance (centre = unity). `Buf.fromMono(x)` = dual mono (unity) |
| randomness | `mulberry32(seed)`; derive seeds with `seedOf('kick', i)`; per-event rng is passed to sequencer instruments |
| allocation | functions return **new** arrays (inputs untouched); `*InPlace` / `Buf.gain()` / `fade()` / `normalizePeak()` mutate |
| mono vs stereo | stereo-producing fx (pingPong, chorus, ensemble, flanger, phaser, decorrelate, widen, reverb) always return a `Buf`; a mono input is treated as dual-mono |
| loudness target | master **-14 LUFS integrated, <= -1.5 dBTP** (TREATMENT.md); VO >= 6 dB over the bed; music ducks 8-10 dB under VO, crowd 5 dB |
| hard cut | all audio is cut at 22.0 s and digital silence (< -90 dBFS) runs to 22.5 s: use `cutAt(buf, 22.0)` and `silenceCheck(buf, 22.0, 22.5)` |

## Running

```bash
node audio/build.mjs                    # all stages: music sfx vo crowd mix (missing modules are skipped with a notice)
node audio/build.mjs music sfx          # selected stages (always run in the order music sfx vo crowd mix)
node audio/build.mjs --par --jobs 2     # sources in niced child processes (the machine has 4 shared cores)
node audio/build.mjs mix                # mix only;  --force mixes even if a source stage failed
node audio/build.mjs --list | --verify  # which stages exist / durations + loudness of every stem and the master

node audio/lib/test/run_all.mjs         # all library tests (about 40 s)
node audio/lib/test/bench.mjs           # 60 s stereo timings of the heavy primitives
node audio/lib/test/render_gallery.mjs  # demo signals + spectrogram PNGs in audio/build/tmp/libtest/gallery/
```

## Seeing and measuring (there is no audio playback in this environment)

```bash
node audio/lib/cli.mjs spec  audio/build/stems/music.wav            # -> audio/build/tmp/music_spec.png (log-frequency spectrogram)
node audio/lib/cli.mjs spec  in.wav out.png --start 20 --dur 6 --w 1600 --h 700 [--lin]
node audio/lib/cli.mjs wave  in.wav                                 # waveform PNG (L / R)
node audio/lib/cli.mjs stats in.wav                                 # LUFS, LRA, true peak, RMS, crest, DC, clipped samples
node audio/lib/cli.mjs stats in.wav 16 21.4                         # the same for a window (VO line vs bed)
node audio/lib/cli.mjs curve in.wav [s]                             # momentary (or short-term) loudness over time
node audio/lib/cli.mjs silence mix.wav 22.0 22.5                    # exit 0 if digital silence
```

Open the PNGs with the Read tool. In code: `spectrogramPng(bufOrWav, 'out.png', {start, dur, w, h})`, `wavePng(...)`.
Equivalent raw ffmpeg: `ffmpeg -i in.wav -lavfi showspectrumpic=s=1600x700:legend=1:fscale=log:drange=100 -frames:v 1 out.png`.
Read a spectrogram like this: x = time, y = log-frequency, colour = dBFS (`drange` 100 dB). Look for: clean harmonic lines
(no mirrored "alias" lines above Nyquist/2), smooth reverb decays (no isolated horizontal lines = no metallic ringing),
click-free starts (vertical broadband lines = clicks), and exact silence (black) where the cues demand it.

## Library (`import * as dsp from '../lib/dsp.mjs'`)

### core
`SR`, `Buf` (`new Buf(sec=60)`, `.clone()`, `.gain(dB)`, `.scale(g)`, `.slice(t0,t1)`, `Buf.from(L,R)`, `Buf.fromMono(x,pan)`),
`newBuf(sec)`, `mono(sec)`, `isBuf`, `addAt(dst, src, tSec, gainDb=0, pan=0, {srcStart,srcLen})` (clips both ends, chainable),
`addAtStereo(dst, L, R, t, g, pan)`, `sumBufs(list)`, `fade(buf, inSec, outSec, 'cos'|'lin'|'exp')`, `cutAt(buf, t, fadeSec)`,
`normalizePeak(buf, dB)`, `peakOf`, `toMono`, `reverse`, `extend`, `concat`, `writeWav`, `readWav`, `encodeWav`, `decodeWav`,
`resample(x, srcRate, dstRate)` / `resampleBy(x, speed)` (Kaiser-sinc), time/pitch: `sec(n) samples(s) midiToHz hzToMidi noteToMidi('A4') midiToNote`,
level: `dbToLin linToDb`, math: `clamp lerp invLerp smoothstep smootherstep nextPow2 nearestPrime`, RNG: `mulberry32(seed)` (`r()`, `r.range`, `r.int`,
`r.gauss`, `r.pick`, `r.bool`, `r.fork`), `hashString(str)`, `seedOf(...parts)`.

### gen
`osc(type, freqOrArray, n, {phase, width, pm, centered})` types `sine saw ramp square pulse tri` (polyBLEP/BLAMP: alias floor < -55 dB at 5 kHz);
`unison(type, freq, n, {voices, detuneCents, spread, seed})` -> `{L,R}`; `noise('white'|'gauss'|'pink'|'brown'|'blue'|'violet', n, seed, {rms=0.3})`;
`lfo(shape, rate, n, {min,max,phase,seed})`, `drift(n, rateHz, depth, seed)`; envelopes `adsr(n,{a,d,s,r,aCurve,dCurve,rCurve})`,
`expDecay(n, tau)`, `perc(n,{a,tau})`, `curve(n, [[t,v],...], 'lin'|'exp'|'smooth'|'cos'|'hold')`, `ramp`, `glide(f0,f1,n,'exp')`, `constant`,
`regionEnv(n, [[t0,t1],...], {attack,release,hold})`, `slew(x, attackSec, releaseSec)`, `stepGate(n,{stepSec,duty,pattern,t0})` (stutter / chop gates);
`fmOsc`, `karplus`, `additive`; array ops `mul add scaleArr mixArrays addInPlace mulInPlace`.

### filters (cutoff / Q / gain accept a scalar **or** a per-sample `Float32Array`; `Buf` in -> `Buf` out)
`biquad(x, 'lp'|'hp'|'bp'|'notch'|'peak'|'lowshelf'|'highshelf'|'allpass', freq, q=0.707, gainDb=0, {update=8})`, `biquadChain(x, [{type,f,q,g}])` (`eq`),
`biquadCoefs`, `biquadMag`, `butter(x,'lp'|'hp', f, order)`, `lowpass/highpass/bandpass`, `onepole(x,'lp'|'hp',f)`, `dcBlock`, `svf(x, 'lp'|'hp'|'bp'|'notch'|'peak'|'allpass', f, q)`
(TPT: safest for fast sweeps), `ladder(x, cutoff, res, {drive})` (Moog-style, saturating), `formant(x, 'a'|'e'|'i'|'o'|'u', {voice:'bass'|'tenor'|'alto'|'soprano', to, morph, shift})`
(5-formant parallel bank, feed it a vibrato saw for choir "ooh/aah"), `allpass1`, `fastTanh`.

### effects
`delay(x, time, feedback, mix, {damp, hpHz, sat, wowMs, tail, stereoSpread, wetOnly})`, `pingPong(x, time, fb, mix, {damp, tail, width})`,
`chorus`, `ensemble` (string-machine), `flanger`, `phaser`, `bitcrush(x,{bits, rate, dither})`, `waveshape(x, 'tanh'|'soft'|'atan'|'cubic'|'hard'|'fold'|'tri'|'asym', drive, {oversample:1|2|4, bias, mix})`,
`tremolo`, `autopan`, `widen(buf, width, {bassMonoHz})`, `msEncode/msDecode`, `haas`, `decorrelate` (mono -> wide), `balance`,
`pitchResample(x, semis)` / `stretchResample` (changes duration), `varispeed(x, speedArray)` (tape stop, rewind, doppler, dives), `granularCloud(src, seconds, opts)` (shimmer beds, risers),
`upsample2/downsample2`, `schroederAllpass`.

### reverb
* `reverb(x, {size, decay(RT60), damp, preDelay, wet, dry, wetOnly, width, mod, early, diffusion, lowCut, highCut, tail, seed})` - 8-line FDN, Householder feedback, damped, modulated.
* `convReverb(x, ir | 'hall', {wet, dry, wetOnly, tail})`, `makeIR(kind, overrides)` kinds `room chamber hall cathedral plate spring projector_room phone`; `convolve(x, h, {tail, full})`.
* `applyReverb(x, preset, overrides)` presets: `room chamber hall bigHall cathedral cave plate spring projector (=projector_room) phone (=phone_speaker)`.
* `phoneSpeaker(x, {lo=400, hi=4000, mono, drive})` (the 2025 lo-fi beat), `reverseReverb(x,{preset,tail})` -> `{buf, offset}`.
* `FFT`, `RFFT`, `magSpectrum(x, N, start)` for analysis.
* **Level**: every reverb is energy-normalised, `wet: 1` ~ same power as dry for noise-like input. Typical inserts: wet 0.15-0.4. Pass `tail` (seconds) to extend a one-shot's buffer.
* Skip-ahead: silent stretches are skipped, so a sparse 60 s send costs ~0.5 s instead of ~1.1 s.
* Send pattern (one reverb per bus, not per note): `bus = addAt(...many notes...); out = reverb(bus, {wetOnly: true, wet: 0.35, ...}); addAt(mix, out, 0)`.

### dynamics
`envelope(x,{attackMs,releaseMs,mode:'peak'|'rms'})`, `compressor(x,{thresholdDb, ratio, attackMs, releaseMs, kneeDb, makeupDb, detect, lookaheadMs, sidechain, scHpHz, mix, returnGr})`,
`sidechainCompress(x, key, opts)` (kick -> pads), `duck(x, key, {depthDb, attackMs, releaseMs, mode:'audio'|'control'})`, `duckRegions(x, [[t0,t1],...], {depthDb:9})` (VO ducking),
`gate`, `automate(x, [[t, dB],...])` (mix rides), `applyGain(x, gainArray)`, `softclip(x,{ceilingDb, knee})`,
`limiter(x,{ceilingDb:-1, lookaheadMs:5, releaseMs:120, truePeak:true})` (zero latency, offline; `result.stats.maxReductionDb`).

### meter (`import * as meter from '../lib/meter.mjs'`)
`integratedLoudness(buf)` (BS.1770-4: K-weighting, 400 ms blocks / 75 % overlap, -70 LUFS absolute + -10 LU relative gates), `measure(buf)` (integrated, LRA, momentary / short-term max,
true peak, sample peak, RMS, crest, DC, clipped), `formatReport`, `loudnessCurve(buf, 'momentary'|'short', hop)`, `truePeak(buf, t0, t1)` (4x, 32-tap),
`truePeakEnvelope`, `lufsGateStats(buf, t0, t1)` -> `{integrated, ungated, momentaryMax, shortTermMax, rmsDb, peakDb, truePeakDb}` (compare VO vs bed on the same window; use
`.ungated` for lines shorter than 400 ms), `rmsDb`, `peakDb`, `rmsCurve`, `crestDb`, `dcOffset`, `silenceCheck(buf, t0, t1, -90)`, `clipCount`, `gainToLufs(buf, target)`, `analyze` (reusable prefix sums).

### ff (`import * as ff from '../lib/ff.mjs'`)
`run(args)`, `runAsync(args)`, `filterChain(buf, 'af string')`, `pitchShift(buf, semis, {formant, transients, window})` (rubberband; keeps length; onset smear is about +-10 ms, use
`transients:'crisp', window:'short'` for percussive sounds), `timeStretch(buf, ratio)`, `shimmerReverb(buf, {passes, shift})`, `spectrogramPng`, `wavePng`, `ebur128(bufOrPath)` (independent
reference), `decodeAny(path)` (mp3/ogg/flac/...), `probe`, `convert`, `loudnorm`.

### theory (`import * as th from '../lib/theory.mjs'`)
`chordNotes(name, octave, voicing, {inversion, add})` voicings `close open wide bass root power shell drop2`, names `Am F C G` + `add9 6 sus2 sus4 maj7 7 9 ...`;
`chordForTime(t)` (half-bar aware: bar 28 is F then G at 57.0) -> `{name, bar, half, t0, t1, next}`; `chordSpans(t0, t1, {merge})`; `parseChord`;
`motifEvents(t0, {transposeSemis, octave, stretch, rhythm:'orig'|'even', notes, vel})` -> `[{t, dur, midi, vel}]` (`'even'` = E 24.0, G 24.5, A 25.0, C 25.5 for the turn piano);
`motifBars([2,3,4], opts)`; `barStart(n)`, `barOf`, `beatInBar`, `beatTimes(t0, t1, subdiv)`, `beatGrid`; `SCALES`, `scaleNotes`, `quantizeToScale`, `inKey` (C major / A minor);
sequencer: `renderEvents(events, (ev, {hz, rng, i}) => noteBuf, {seconds, cache, gainDb, pan, buf})`, `steps('x.X.x...', t0, {subdiv})`, `arp(midis, t0, opts)`, `euclid`, `humanize`.

## Recipes

```js
import * as dsp from '../lib/dsp.mjs';
import * as th from '../lib/theory.mjs';
import * as meter from '../lib/meter.mjs';
const { SR, Buf } = dsp;

// 1. a note instrument + the motif, rendered on the grid
const pluck = (ev, { hz }) => {
  const n = Math.round((ev.dur + 1.5) * SR);
  const x = dsp.osc('tri', hz, n).map((v, i) => v * ev.vel * 0.4);
  return dsp.mul(x, dsp.adsr(n, { a: 0.004, d: 0.4, s: 0.2, r: 1.0 }));
};
const bus = th.renderEvents(th.motifBars([2, 3, 4, 5]), pluck, { seconds: 60, cache: (e) => `${e.midi}|${e.dur}` });
const wet = dsp.applyReverb(bus, 'hall', { wet: 0.3, tail: 0 });

// 2. a moving filter + choir
const saw = dsp.osc('saw', 220, 4 * SR), cutoff = dsp.curve(4 * SR, [[0, 200], [4, 9000]], 'exp');
const swept = dsp.svf(saw, 'lp', cutoff, 4);
const ooh = dsp.formant(dsp.osc('saw', 220, 4 * SR), 'o', { voice: 'soprano', to: 'a', morph: dsp.curve(4 * SR, [[0, 0], [4, 1]]) });

// 3. VO over a bed: duck the music 9 dB while the lines speak, then check the VO sits >= 6 dB above the bed
import { VO } from '../../shared/cues.js';
const ducked = dsp.duckRegions(music, VO.map((v) => [v.t0, v.maxEnd]), { depthDb: 9, attackMs: 60, releaseMs: 500 });
const d = meter.lufsGateStats(vo, 16, 21.4).ungated - meter.lufsGateStats(ducked, 16, 21.4).ungated;

// 4. master: gain to -14 LUFS then true-peak limit
const g = meter.gainToLufs(mixBuf, -14);
const master = dsp.limiter(mixBuf.clone().gain(g), { ceilingDb: -1.5 });
console.log(meter.formatReport(meter.measure(master)));
```

## Validation (run `audio/lib/test/run_all.mjs`)

* **Loudness vs ffmpeg `ebur128=peak=true`** on 8 test signals (sine, pink noise, gated loud/silent/quiet/loud, music-like stereo, reverb wash, -62 dB noise, clipped sine):
  worst integrated-loudness difference **0.04 LU**, worst true-peak difference **0.10 dB**; windowed `lufsGateStats` matches ffmpeg on slices within 0.01 LU. Note: on the
  fs/4@45 deg inter-sample-peak signal ffmpeg itself reads 0.64 dB above the analytic value (-1.94 dBTP); `meter.mjs` reads -1.8, so that case is checked analytically.
* Biquad / SVF / Butterworth / ladder responses match theory (-3 dB at fc, slopes, shelf gains), modulated filters stay bounded under 60 Hz <-> 20 kHz sweeps with high Q.
* FFT convolution equals direct convolution (error < 3e-7); RFFT round-trip 4e-16. FDN RT60 follows the `decay` parameter (within +-25 %), tails are decorrelated (|L/R corr| < 0.35),
  unit energy at `wet: 1`. Chords / chordForTime / motif tested against `shared/cues.js` (half-bar chord at 57.0, motif grid, all voicings diatonic).
* Bit-identical output from two fresh processes.
* Speed on 60 s stereo (4 loaded cores): 6 biquads 0.2 s, FDN reverb 1.1 s dense / 0.5 s sparse, convolution reverb (4.6 s IR) 1.3 s, limiter + true-peak 1.1 s,
  whole chain (6 biquads + reverb + limiter) about 1.8 s.

## Gotchas

* A reverb call on a 60 s bus cannot ring past the end of the buffer: use `tail` for one-shots, and fade / cut where the cues demand it (22.0 s hard cut, 60.0 s end).
* `biquad` with per-sample frequency refreshes coefficients every 8 samples (`update` option); use `svf` for audio-rate sweeps.
* FDN sizes below ~0.7 get peaky (metallic) responses because modal density follows the line lengths; the `room` preset keeps size 0.85 and gets its small-room feel from a 0.5 s RT.
* `pitchShift` / `timeStretch` / `shimmerReverb` shell out to ffmpeg (rubberband); everything else is pure JS.
* `meter` filters start cold at `t0` for windowed stats, so earlier audio never leaks into the window; a window shorter than 400 ms has no gated value (`integrated = -Infinity`), use `.ungated`.
* The mono `addAt` pan law is -3 dB at centre; a mono source panned centre is quieter than `Buf.fromMono(x)` by 3 dB per side, by design (constant power).
