#!/usr/bin/env python3
"""
audio/vo/compare.py - narrator selection by evidence.
Synthesizes the 11 real narration lines with every candidate voice (2 seeds), then measures
duration vs. cue window, F0 / HNR / tilt, and ASR intelligibility (WER + mean word confidence).

  python compare.py run   [--voices a,b,c] [--seeds 1,2] [--asr tiny.en,base.en]
  python compare.py table
Raw results: audio/vo/work/compare.json (gitignored scratch)
"""
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
sys.path.insert(0, HERE)

# the contract lines (read from shared/cues.js by node so nothing is hard-coded)
def cue_lines():
    js = ("import * as c from '../../shared/cues.js';"
          "console.log(JSON.stringify({vo:c.VO,dia:c.VO_DIEGETIC}))")
    out = subprocess.check_output(["node", "--input-type=module", "-e", js], cwd=HERE)
    return json.loads(out)


DEFAULT_VOICES = [
    "en_US-ryan-high", "en_GB-cori-high", "en_GB-alan-medium", "en_US-lessac-high",
    "en_US-kristin-medium", "en_GB-northern_english_male-medium", "en_GB-jenny_dioco-medium",
    "en_US-hfc_female-medium", "en_GB-alba-medium", "en_US-libritts-high",
    "en_US-hfc_male-medium", "en_US-john-medium", "en_US-norman-medium", "en_US-joe-medium",
    "en_US-lessac-medium",
]


def main():
    cmd = sys.argv[1]
    arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    voices = arg("--voices", ",".join(DEFAULT_VOICES)).split(",")
    seeds = [int(s) for s in arg("--seeds", "1,2").split(",")]
    asrs = arg("--asr", "tiny.en,base.en").split(",")
    os.makedirs(WORK, exist_ok=True)
    resf = os.path.join(WORK, "compare.json")
    res = json.load(open(resf)) if os.path.exists(resf) else {}
    if cmd == "run":
        from synth import run_job
        from analyze import asr_wer, read_wav_mono, voice_metrics, VOCAB_PROMPT
        lines = cue_lines()["vo"]
        for v in voices:
            for seed in seeds:
                for ln in lines:
                    key = f"{v}|{seed}|{ln['id']}"
                    if key in res and all(m in res[key].get("asr", {}) for m in asrs):
                        continue
                    wav = os.path.join(WORK, "cmp", v, f"s{seed}_{ln['id']}.wav")
                    if not os.path.exists(wav):
                        run_job({"id": ln["id"], "voice": v, "seed": seed, "text": ln["text"], "out": wav,
                                 "speaker": 0})
                    y, sr = read_wav_mono(wav)
                    r = res.get(key, {})
                    r.update(voice=v, seed=seed, id=ln["id"], dur=len(y) / sr, win=ln["maxEnd"] - ln["t0"])
                    r["metrics"] = voice_metrics(y, sr)
                    r.setdefault("asr", {})
                    for m in asrs:
                        if m not in r["asr"]:
                            nm, _, flag = m.partition("+")
                            r["asr"][m] = asr_wer(wav, ln["text"], nm, prompt=VOCAB_PROMPT if flag == "p" else None)
                    res[key] = r
                    json.dump(res, open(resf, "w"), indent=1)
                print("done", v, seed, flush=True)
    if cmd in ("run", "table"):
        table(res, voices)


def table(res, voices):
    rows = []
    for v in voices:
        rs = [r for k, r in res.items() if not k.startswith("_dns") and r["voice"] == v]
        if not rs:
            continue
        row = {"voice": v}
        for m in sorted({m for r in rs for m in r["asr"]}):
            ok = [r for r in rs if m in r["asr"]]
            err = sum(r["asr"][m]["errors"] for r in ok)
            n = sum(r["asr"][m]["nref"] for r in ok)
            row["wer_" + m] = err / max(1, n)
            row["conf_" + m] = float(np.mean([r["asr"][m]["conf"] for r in ok]))
        row["f0"] = float(np.mean([r["metrics"].get("f0_med", 0) for r in rs]))
        row["f0sd"] = float(np.mean([r["metrics"].get("f0_sd_st", 0) for r in rs]))
        row["hnr"] = float(np.mean([r["metrics"].get("hnr", 0) for r in rs]))
        row["tilt"] = float(np.mean([r["metrics"].get("tilt_db_oct", 0) for r in rs]))
        row["alpha"] = float(np.mean([r["metrics"].get("alpha_ratio_db", 0) for r in rs]))
        # fit: ratio of natural duration to cue window (>1 means it must be sped up)
        fit = {}
        for r in rs:
            fit.setdefault(r["id"], []).append(r["dur"] / r["win"])
        row["fit"] = {k: float(np.mean(x)) for k, x in fit.items()}
        row["worst_fit"] = max(row["fit"].values())
        dk = "_dns|" + v
        if dk not in res:
            from analyze import dnsmos
            ys = []
            for r in sorted(rs, key=lambda r: (r["seed"], r["id"])):
                if r["seed"] != 1:
                    continue
                y, sr = read_wav_mono(os.path.join(WORK, "cmp", v, f"s{r['seed']}_{r['id']}.wav"))
                ys.append(np.concatenate([y, np.zeros(int(0.25 * sr), np.float32)]))
            res[dk] = dnsmos(np.concatenate(ys), sr)
            json.dump(res, open(os.path.join(WORK, "compare.json"), "w"), indent=1)
        row["dns_sig"], row["dns_ovrl"] = res[dk]["sig"], res[dk]["ovrl"]
        rows.append(row)
    ms = sorted({k[4:] for r in rows for k in r if k.startswith("wer_")})
    hdr = f"{'voice':36s} " + " ".join(f"WER:{m:7s}" for m in ms) + " " + " ".join(f"conf:{m:7s}" for m in ms) + \
          "  F0   F0sd  HNR  tilt  alpha  worstFit  dnsSIG dnsOVR"
    print(hdr)
    for r in rows:
        print(f"{r['voice']:36s} " + " ".join(f"{100*r['wer_'+m]:11.1f}%" for m in ms) + " " +
              " ".join(f"{r['conf_'+m]:12.3f}" for m in ms) +
              f" {r['f0']:5.0f} {r['f0sd']:4.1f} {r['hnr']:5.1f} {r['tilt']:5.1f} {r['alpha']:6.1f} {r['worst_fit']:6.2f}  {r['dns_sig']:6.2f} {r['dns_ovrl']:6.2f}")
    return rows


if __name__ == "__main__":
    main()
