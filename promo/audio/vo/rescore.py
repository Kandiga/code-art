#!/usr/bin/env python3
"""Re-score every candidate take in work/cmp/<voice>/s<seed>_<id>.wav with the final (padded) ASR protocol,
DNSMOS and voice metrics; print the selection table.  python rescore.py [voice-substring ...]"""
import json, os, sys, glob
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from analyze import asr_wer, VOCAB_PROMPT, read_wav_mono, voice_metrics, dnsmos
from compare import cue_lines

WORK = os.path.join(HERE, "work")
cache_f = os.path.join(WORK, "rescore.json")
cache = json.load(open(cache_f)) if os.path.exists(cache_f) else {}
lines = {l["id"]: l for l in cue_lines()["vo"]}
filt = sys.argv[1:]
voices = sorted(d for d in os.listdir(os.path.join(WORK, "cmp")) if not filt or any(f in d for f in filt))
rows = []
name_hyp = {}
for v in voices:
    files = sorted(glob.glob(os.path.join(WORK, "cmp", v, "s*_vo*.wav")))
    if not files:
        continue
    err = {"base.en": 0, "tiny.en": 0}
    nref = 0
    conf, f0, hnr, tilt, alpha, f0sd = [], [], [], [], [], []
    she = 0
    fit = {}
    per_seed_y = {}
    for fpath in files:
        b = os.path.basename(fpath)
        seed, lid = b[:-4].split("_", 1)
        ln = lines[lid]
        y, sr = read_wav_mono(fpath)
        k = f"{v}|{b}"
        c = cache.get(k, {})
        dirty = k not in cache
        for m in err:
            if m not in c:
                c[m] = asr_wer(fpath, ln["text"], m); dirty = True
        if "metrics" not in c:
            c["metrics"] = voice_metrics(y.astype(np.float64), sr); c["dur"] = len(y) / sr; dirty = True
        if dirty:
            cache[k] = c
            json.dump(cache, open(cache_f, "w"))
        if lid in ("vo3b", "vo6a"):   # name lines: Whisper does not know 'Amrita' -> reported separately
            name_hyp.setdefault(v, []).append(c["base.en"]["hyp"])
        else:
            for m in err:
                err[m] += c[m]["errors"]
            nref += c["base.en"]["nref"]
        conf.append(c["base.en"]["conf"])
        mt = c["metrics"]
        f0.append(mt.get("f0_med", 0)); hnr.append(mt.get("hnr", 0)); tilt.append(mt.get("tilt_db_oct", 0)); alpha.append(mt.get("alpha_ratio_db", 0)); f0sd.append(mt.get("f0_sd_st", 0))
        if lid.startswith("vo4"):
            she += c["base.en"]["errors"] + c["tiny.en"]["errors"]
        fit.setdefault(lid, []).append(c["dur"] / (ln["maxEnd"] - ln["t0"]))
    s1 = [f for f in files if os.path.basename(f).startswith("s1_")]
    ys = []
    for f in s1:
        y, sr = read_wav_mono(f)
        ys.append(np.concatenate([y, np.zeros(int(0.25 * sr), np.float32)]))
    dk = f"dns|{v}"
    if dk not in cache:
        cache[dk] = dnsmos(np.concatenate(ys), sr); json.dump(cache, open(cache_f, "w"))
    rows.append(dict(voice=v, n=len(files), wer_b=err["base.en"] / nref, wer_t=err["tiny.en"] / nref, wer_np=0.0, names=name_hyp.get(v, []),
                     she=she, conf=float(np.mean(conf)), f0=float(np.mean(f0)), f0sd=float(np.mean(f0sd)), hnr=float(np.mean(hnr)),
                     tilt=float(np.mean(tilt)), alpha=float(np.mean(alpha)), fit=max(float(np.mean(x)) for x in fit.values()),
                     fit_vo6a=float(np.mean(fit["vo6a"])), fit_vo3b=float(np.mean(fit["vo3b"])), sig=cache[dk]["sig"], ovrl=cache[dk]["ovrl"]))
print(f"{'voice':40s} n  WERb  WERt  WERnp She  conf   F0 F0sd  HNR  tilt  alpha  fit6a fit3b  SIG  OVRL")
for r in sorted(rows, key=lambda r: (r["wer_b"] + r["wer_t"], -r["ovrl"])):
    print(f"{r['voice']:40s} {r['n']:2d} {100*r['wer_b']:4.1f}% {100*r['wer_t']:4.1f}% {100*r['wer_np']:4.1f}% {r['she']:3d} {r['conf']:.3f} {r['f0']:4.0f} {r['f0sd']:4.1f} {r['hnr']:5.1f} {r['tilt']:5.1f} {r['alpha']:6.1f} {r['fit_vo6a']:5.2f} {r['fit_vo3b']:5.2f} {r['sig']:5.2f} {r['ovrl']:5.2f}")
json.dump(rows, open(os.path.join(WORK, "rescore_table.json"), "w"), indent=1)
