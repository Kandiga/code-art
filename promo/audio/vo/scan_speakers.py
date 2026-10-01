#!/usr/bin/env python3
"""Scan a sample of en_US-libritts-high speakers (904) for deep, clean 'narrator' candidates.
   python scan_speakers.py [N=60] -> work/speakers.json (F0, HNR, DNSMOS per speaker)"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import synth
from analyze import voice_metrics, dnsmos

N = int(sys.argv[1]) if len(sys.argv) > 1 else 60
voice = "en_US-libritts-high"
pv = synth.load_voice(voice, 1)
cfg = json.load(open(os.path.join(synth.MODELS, voice + ".onnx.json")))
ids = sorted(cfg["speaker_id_map"].values())
rng = np.random.RandomState(5)
pick = sorted(rng.choice(ids, N, replace=False).tolist())
out = {}
text = "Now it takes one director. Meet Amrita. For a hundred and thirty years, it took an army to make a movie."
for sid in pick:
    a, _ = synth.synth_segment(pv, text, sid, 1.0, 0.667, 0.8)
    m = voice_metrics(a.astype(np.float64), pv.config.sample_rate)
    d = dnsmos(a, pv.config.sample_rate)
    out[sid] = {**m, **d, "dur": len(a) / pv.config.sample_rate}
    print(sid, round(m.get("f0_med", 0)), round(m.get("hnr", 0), 1), round(d["sig"], 2), round(d["ovrl"], 2), flush=True)
os.makedirs("work", exist_ok=True)
json.dump(out, open("work/speakers.json", "w"), indent=1)
