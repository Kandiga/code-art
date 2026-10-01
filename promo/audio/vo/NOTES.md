# audio/vo - narration (Piper TTS, fully offline, deterministic)

## How to run
```
audio/vo/setup.sh                      # one-time: .venv + voices + whisper (already done here)
node audio/vo/render.mjs [--no-asr] [--only vo1,vo3b] [--no-cache]    # or: import { renderVo } from './vo/render.mjs'
audio/vo/.venv/bin/python audio/vo/verify.py --models base.en,small.en   # contract checks + ASR per line
```
Outputs: `audio/build/stems/vo.wav` (60 s, stereo, float32, 48 kHz), `audio/build/vo/<id>.wav` (sample 0 = speech onset),
`audio/build/vo_lines.json` (id,text,t0,onset,end,maxEnd,peakDb,truePeakDb,lufs,lufsShortMax,rmsDb,tailEnd,words[],asr{},checks{},diegetic?).
All times come from `shared/cues.js` (read with node by `process.py`). Dry Piper takes are cached in `audio/vo/raw/` (seeded graph = bit-exact).

## Reuse by other agents (crowd, sfx)
* python: `audio/vo/.venv/bin/python`   models: `audio/vo/models/<voice>.onnx(.json)` (18 voices; Whisper in `models/hf`)
* Node: `import { speak, speakBatch, synthTakes, PY, MODELS } from '../vo/piper.mjs'`;
  `await speak(text, {voice, speaker, seed, lengthScale, noiseScale, noiseW, sentenceSilence})` -> Buf 48 kHz (+ `.dur`, `.words`).
  `segments:[{text,lengthScale,gapAfter}]` for per-phrase prosody; inline markup `army{v1.5c1.15}`.
* Python: `synth.py` (seeded; per-phoneme duration control via patched `dur_mult` input; word timings), `dsp.py`
  (EQ, de-esser, compressor, limiter, tape sat, plate IR, BS.1770 LUFS, true peak, rubberband), `prosody.py` (PSOLA pitch edit, Praat change-gender).
  libritts-high has 904 speakers (`speaker=` id) - handy for crowd voices.

## Narrator choice (evidence)
Candidates synthesized on the 11 real lines (1-3 seeds each), ASR with faster-whisper tiny.en/base.en (16 kHz, padded with silence; the
name lines vo3b/vo6a excluded from WER because Whisper cannot spell "Amrita"), DNSMOS P.835 (SIG/OVRL), Praat F0/HNR:

| voice | WER base.en | WER tiny.en | F0 Hz | HNR dB | DNSMOS SIG / OVRL |
|---|---|---|---|---|---|
| en_GB-jenny_dioco-medium | 0.0% | 0.0% | 206 | 12.0 | 3.59 / 3.38 |
| en_US-hfc_male-medium | 0.0% | 0.0% | 119 | 6.5 | 3.58 / 3.36 |
| en_US-hfc_female-medium | 0.0% | 0.0% | 245 | 10.9 | 3.60 / 3.36 |
| en_US-john-medium | 0.0% | 0.0% | 99 | 5.2 | 3.58 / 3.34 |
| en_US-kristin-medium | 0.0% | 0.0% | 144 | 9.9 | 3.55 / 3.31 |
| en_US-libritts-high#495 | 0.0% | 1.3% | 105 | 5.9 | 3.70 / 3.51 |
| en_US-libritts-high#608 | 0.0% | 1.3% | 125 | 7.8 | 3.54 / 3.29 |
| en_GB-cori-high | 0.0% | 1.7% | 216 | 11.3 | 3.65 / 3.43 |
| en_US-libritts-high#434 | 1.3% | 1.3% | 170 | 11.9 | 3.64 / 3.40 |
| en_US-libritts-high#717 | 1.3% | 1.3% | 177 | 10.3 | 3.62 / 3.38 |
| en_US-lessac-medium | 0.0% | 2.6% | 217 | 11.2 | 3.55 / 3.33 |
| en_US-joe-medium | 2.6% | 0.0% | 98 | 6.7 | 3.51 / 3.31 |
| en_GB-northern_english_male-medium | 0.0% | 2.6% | 116 | 6.9 | 3.51 / 3.31 |
| en_US-lessac-high | 0.0% | 5.1% | 201 | 10.8 | 3.58 / 3.39 |
| en_GB-alba-medium | 2.6% | 2.6% | 208 | 9.8 | 3.55 / 3.32 |
| en_US-libritts-high#482 | 3.8% | 1.3% | 112 | 9.3 | 3.57 / 3.28 |
| en_US-ryan-high | 5.1% | 4.3% | 170 | 7.9 | 3.50 / 3.28 |
| en_GB-alan-medium | 4.2% | 8.3% | 97 | 6.7 | 3.56 / 3.29 |
| en_US-libritts-high#480 | 3.8% | 9.0% | 111 | 8.3 | 3.55 / 3.26 |
| en_US-norman-medium | 10.3% | 5.1% | 107 | 7.0 | 3.49 / 3.24 |
| en_US-libritts-high | 10.3% | 7.7% | 180 | 8.1 | 3.51 / 3.22 |

Decision: **en_GB-cori-high** (female, calm, warm, F0 ~216 Hz, HNR 11 dB, DNSMOS OVRL 3.43, 0 % WER base.en, 1.7 % tiny.en) shaped with
Praat change-gender (formant ratio 0.97, median 192 Hz, range x1.15) for a slightly deeper, more authoritative register.
en_US-ryan-high (orchestrator's suggestion) was rejected on data: it misheard "She writes/shoots" as "He/Key ..." in 6 of 11 first takes
(WER 5.1 % base / 4.3 % tiny, DNSMOS OVRL 3.28). libritts speaker 495 scored the best DNSMOS (3.51) but is breathy/low-HNR and its
spectrum is dull (alpha ratio +1.4 dB), so it was not used. Diegetic "Hello!": en_US-hfc_male-medium (most intelligible male
voice in a 9-voice 'Hello!' probe) shifted brighter/nasal (formant x1.09, median 172 Hz, wider range) + vintage_optical.

## Direction (see direction.json - every number there)
* Prosody tools: per-line length_scale / noise_scale / noise_w, inter-word `space_mult`, per-word duration markup, inserted breaths of air
  (`gaps`), word-anchored PSOLA pitch accents, per-word gain, noise-vocoded hush layer, 'depth' sub layer.
* vo1 hushed: noise_scale 0.55, noise_w 0.7, hush layer 0.22, drier reverb. vo2: pause after "years," 0.32 s, "army" vowels x1.5 + pitch +2.6 st.
* vo3a "Now it takes ... one director." 190 ms air before "one", pitch lift on "director". vo3b "Meet ... Amrita." 130 ms air, name spelled
  phonetically ([[ɐmɹˈiːtə]]) so every TTS and ASR pronounces it Am-REE-ta, wetter reverb (0.17).
* vo4a-d each its own line on its downbeat (cues t0). vo5 pitch ramps up on "started." (+3.2 st). vo6a/vo6b slower, stately, 0.6x word-space.
* Fit: onset == t0 exactly (leading silence trimmed at -40 dBFS); end < maxEnd - 30 ms. All lines fit with ls*1.0 and tempo 1.0 (no rubberband needed);
  fit loop is length_scale first (min 0.86x) then rubberband (max +10 %).
* Chain: HPF 80 Hz -> low shelf +2.5 dB@190 -> -1.5 dB@380 -> +2.5 dB@3.2 kHz presence -> air shelf -> de-ess 5.2-9.8 kHz (4:1) ->
  comp1 3:1 peak -> comp2 2:1 RMS -> tape saturation (30 % parallel) -> air exciter (>10.8 kHz harmonics) -> plate reverb 12 % (rt60 1.2 s, 14 ms pre-delay,
  tail hard-gated 12 ms before the next VO onset) -> normalise -20 LUFS integrated per line -> look-ahead limiter at -3.15 dBFS.
* vo_hello: room 0.35 s -> 300-3500 Hz band-pass + 2.4 kHz resonance -> asymmetric soft clip -> wow 0.35 % @0.9 Hz + flutter 0.18 % @7 Hz -> optical hiss (-34 dB),
  24 Hz frame thump, Poisson dust crackle; the noise is gated like an optical noise-reduction shutter (only around the word).

## Final results (processed lines, `verify.py`)
| id | t0 | speech end | maxEnd | peak dBFS | LUFS | -60 dB tail end | WER small.en | WER base.en (no prompt) |
|---|---|---|---|---|---|---|---|---|
| vo1 | 1.5 | 3.768 | 3.95 | -4.25 | -20.0 | 4.131 | 0% | 0% |
| vo_hello | 9 | 9.468 | 9.7 | -9.41 | -20.0 | 9.593 | 0% | 0% |
| vo2 | 16 | 20.380 | 21.4 | -6.9 | -20.0 | 20.876 | 0% | 0% |
| vo3a | 22.5 | 24.166 | 24.6 | -6.99 | -20.0 | 24.705 | 0% | 0% |
| vo3b | 25 | 25.869 | 26 | -11.6 | -20.0 | 25.961 | 0% | 100% |
| vo4a | 26 | 26.834 | 27.7 | -7.62 | -20.0 | 27.099 | 0% | 0% |
| vo4b | 30 | 30.617 | 31.7 | -8.37 | -20.0 | 31.009 | 0% | 0% |
| vo4c | 36 | 36.816 | 37.7 | -8.57 | -20.0 | 37.291 | 0% | 0% |
| vo4d | 38 | 38.646 | 39.7 | -7.59 | -20.0 | 39.014 | 0% | 0% |
| vo5 | 46 | 47.625 | 49.2 | -7.26 | -20.0 | 48.145 | 0% | 0% |
| vo6a | 55 | 56.309 | 56.45 | -5.42 | -20.0 | 56.456 | 0% | 67% |
| vo6b | 56.5 | 57.895 | 57.95 | -8.87 | -20.0 | 58.433 | 0% | 0% |

Onset error 0.00 ms on all lines (stem == exact sum of placed lines). True peak <= -3 dBTP everywhere. Overall WER **0/48 words (small.en)**.
base.en with the brand prompt scores 16.7 % but every miss is a hallucinated word after the real speech ("Yeah", "See you", "us", doubled "Hello")
in the padding/reverb tail; small.en and base.en-without-prompt read all 12 lines correctly (4/48 only from those same tail words). Real "Amrita" is
transcribed correctly by small.en in vo3b and vo6a. Spectrogram of the stem: `audio/build/vo/_vo_stem_spectrogram.png` (a thin horizontal stripe near 1.8 kHz is
an artefact of ffmpeg's log-frequency display; a Welch spectrum of vo2 shows only a 3-5 dB dip there).

## Known issues / hand-off notes
* vo3b is a 0.87 s line, so at -20 LUFS integrated its peak is -11.6 dBFS (quieter peak than the others); `mixHintDb` in direction.json can be used by the mixer.
* The window for vo2 (16.0-21.4) is longer than the line (ends 20.38); there is room for the mixer to place SFX tails after it.
* Casting seeds were chosen for vo1-vo6a by ASR confidence + pace; the time-boxed refine pass (more takes of vo3b/vo6b, pitch tuning) was not done.
* `work/` (comparison scratch, ~60 MB of takes) is gitignored (`audio/vo/.gitignore`); `models/` and `.venv/` are gitignored by the repo root.
