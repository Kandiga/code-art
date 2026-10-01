#!/usr/bin/env python3
"""Casting: synthesize N seeds of every line with its designed prosody and rank the takes.
   score = ASR confidence (+ exact match, padded Whisper base.en) - pace error vs the line's target - cue-fit penalty
   python takes.py [--seeds 1,2,3,4,5] [--only vo1,vo2] [--out work/takes.json]
The winning seed of each line is written into direction.json ("seed") by hand/--apply."""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import dsp, prosody, synth, process
from analyze import asr_wer, voice_metrics

ap = argparse.ArgumentParser()
ap.add_argument("--seeds", default="1,2,3,4,5")
ap.add_argument("--only", default="")
ap.add_argument("--apply", action="store_true")
ap.add_argument("--direction", default=os.path.join(HERE, "direction.json"))
a = ap.parse_args()
D = json.load(open(a.direction))
cues = process.load_cues()
items = [(c, "narrator") for c in cues["vo"]]
only = set(x for x in a.only.split(",") if x)
seeds = [int(s) for s in a.seeds.split(",")]
outf = os.path.join(HERE, "work", "takes.json")
res = json.load(open(outf)) if os.path.exists(outf) else {}
best = {}
for cue, role in items:
    if only and cue["id"] not in only:
        continue
    spec = D["lines"][cue["id"]]
    vcfg = D["voices"][spec.get("voice", role)]
    avail = cue["maxEnd"] - cue["t0"] - D["fit"]["end_margin_s"]
    target = spec.get("target_s")
    rows = []
    for sd in seeds:
        sp = dict(spec); sp["seed"] = sd
        y22, sr22, words, path = process.get_take(f"cast_{cue['id']}", vcfg, sp, 1.0, True)
        if spec.get("gaps"):
            y22, words = process.apply_gaps(y22, sr22, words, spec["gaps"])
            import soundfile as sf
            sf.write(path, y22.astype(np.float32), sr22, subtype="FLOAT")  # ASR sees the gapped take
        sh = dict(vcfg.get("shape", {})); sh.update(spec.get("shape", {}))
        if sh:
            y22 = prosody.change_voice(y22, sr22, sh.get("formant_ratio", 1.0), sh.get("median_hz", 0.0), sh.get("range", 1.0))
        dur = len(y22) / sr22
        r = asr_wer(path, cue["text"], "tiny.en", prompt=("Amrita." if "Amrita" in cue["text"] else None))
        m = voice_metrics(y22.astype(np.float64), sr22)
        score = r["conf"] - (0 if r["errors"] == 0 else 2.0) - (5.0 if dur > avail else 0.0)
        if target:
            score -= 0.8 * abs(dur - target) / target
        rows.append(dict(seed=sd, dur=round(dur, 3), conf=round(r["conf"], 3), err=r["errors"], hyp=r["hyp"], f0sd=round(m.get("f0_sd_st", 0), 2), score=round(score, 3)))
    rows.sort(key=lambda r: -r["score"])
    best[cue["id"]] = rows[0]["seed"]
    res[cue["id"]] = rows
    print(f"{cue['id']:6s} avail {avail:.2f} target {target}")
    for r in rows:
        print(f"   seed {r['seed']}: dur {r['dur']:.2f} conf {r['conf']:.3f} err {r['err']} f0sd {r['f0sd']} score {r['score']:+.3f}  '{r['hyp']}'", flush=True)
    json.dump(res, open(outf, "w"), indent=1)
    # cast takes are scratch: remove them from raw/
    for f in os.listdir(os.path.join(HERE, "raw")):
        if f.startswith("cast_"):
            os.remove(os.path.join(HERE, "raw", f))
if a.apply:
    for k, v in best.items():
        D["lines"][k]["seed"] = v
    json.dump(D, open(a.direction, "w"), indent=1, ensure_ascii=False)
print("best:", best)
