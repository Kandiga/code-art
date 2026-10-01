#!/usr/bin/env python3
"""Probe the diegetic 'Hello!' voice: synth with several male voices, 1927 'optical' chain, ASR + metrics."""
import json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import dsp, prosody, synth, process
from analyze import asr_wer, voice_metrics
D = json.load(open(os.path.join(HERE, "direction.json")))
voices = sys.argv[1].split(",") if len(sys.argv) > 1 else ["en_US-joe-medium", "en_US-john-medium", "en_US-hfc_male-medium", "en_US-norman-medium", "en_US-sam-medium", "en_US-mike-medium", "en_US-bryce-medium", "en_GB-northern_english_male-medium", "en_US-ryan-high"]
os.makedirs(os.path.join(HERE, "work", "hello"), exist_ok=True)
res = []
for v in voices:
    for seed in (1, 2, 3):
        for text in ("Hello!",):
            out = os.path.join(HERE, "work", "hello", f"{v}_s{seed}.wav")
            if not os.path.exists(out):
                synth.run_job({"id": "h", "voice": v, "seed": seed, "text": text, "length_scale": 0.95, "noise_scale": 0.8, "noise_w": 0.9, "out": out})
            y, sr = dsp.read_wav(out)
            y = y[0]
            m0 = voice_metrics(y.astype(np.float64), sr)
            # brighter / slightly nasal: pitch up ~+2.5 st, formants up ~+9 %
            y2 = prosody.change_voice(y, sr, 1.09, (m0.get("f0_med", 120)) * 2 ** (2.5 / 12), 1.2)
            y48 = dsp.resample_to(y2, sr)
            vo, noise = process.vintage_optical(y48, D, 1234)
            n = len(vo)
            on = dsp.onset_index(vo / (np.abs(vo).max() + 1e-9) * 0.3, -40)
            full = vo + noise * 1.0
            g = dsp.lin(-20 - dsp.lufs_integrated(full))
            full = full * g
            f = os.path.join(HERE, "work", "hello", f"{v}_s{seed}_vintage.wav")
            dsp.write_wav_f32(f, np.stack([full, full]))
            a = asr_wer(f, "Hello!", "base.en"); b = asr_wer(f, "Hello!", "tiny.en")
            d = dsp.end_index(vo * g, -40) - dsp.onset_index(vo * g, -40)
            res.append((v, seed, a["hyp"], b["hyp"], d / dsp.SR, m0.get("f0_med", 0)))
            print(f"{v:36s} s{seed} base:'{a['hyp']}' tiny:'{b['hyp']}' dur {d/dsp.SR:.2f} f0 {m0.get('f0_med',0):.0f} conf {a['conf']:.2f}", flush=True)
