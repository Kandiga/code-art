#!/usr/bin/env python3
"""
audio/vo/verify.py - QA of the FINAL processed VO: contract checks + ASR word-error-rate per line.

  python verify.py [--build audio/build] [--no-asr] [--models base.en,small.en]

Checks (per line, from audio/build/vo_lines.json + audio/build/vo/<id>.wav + stems/vo.wav):
  * onset (first sample > -40 dBFS) of the line placed in the stem is at cue t0 (+-10 ms)
  * speech end < maxEnd, reverb tail gone before the next VO line starts
  * peak <= -3 dBFS (sample and 4x true peak), loudness -20 LUFS (+-0.3)
  * ASR (faster-whisper, Whisper models, int8 CPU) of the processed line: WER vs the cue text.
    The 'primary' model gets a vocabulary prompt ("Amrita Cinema Studio...") because 'Amrita' is not an English
    word; an unprompted run is reported as well.
Results are merged back into vo_lines.json (fields: wer, asr{...}, checks{...}) and a report is printed.
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dsp  # noqa: E402

SR = dsp.SR


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", default=os.path.abspath(os.path.join(HERE, "..", "build")))
    ap.add_argument("--no-asr", action="store_true")
    ap.add_argument("--models", default="base.en,small.en")
    args = ap.parse_args()
    B = args.build
    rows = json.load(open(os.path.join(B, "vo_lines.json")))
    stem, sr = dsp.read_wav(os.path.join(B, "stems", "vo.wav"))
    assert sr == SR
    rows_sorted = sorted(rows, key=lambda r: r["t0"])
    nxt = {r["id"]: (rows_sorted[i + 1]["t0"] if i + 1 < len(rows_sorted) else None) for i, r in enumerate(rows_sorted)}
    bad = 0
    if not args.no_asr:
        from analyze import asr_wer, VOCAB_PROMPT
        models = args.models.split(",")
    for r in rows:
        a, _ = dsp.read_wav(os.path.join(B, r["file"]))
        i0 = int(round(r["t0"] * SR))
        # onset as seen in the STEM (measured on this line's own samples, all others are silent around it)
        seg = stem[:, max(0, i0 - int(0.05 * SR)): i0 + int(0.05 * SR)]
        first = dsp.onset_index(a, -40.0)  # dry+wet line: onset of the line file itself
        stem_on = max(0, i0 - int(0.05 * SR)) + dsp.onset_index(seg, -40.0) if dsp.onset_index(seg, -40.0) >= 0 else -1
        onset_err_ms = (stem_on - i0) / SR * 1000 if stem_on >= 0 else float("nan")
        tail = r["tailEnd"]
        checks = {
            "onset_err_ms": round(onset_err_ms, 3),
            "onset_ok": bool(abs(onset_err_ms) <= 10.0),
            "end_ok": bool(r["end"] < r["maxEnd"]),
            "tail_ok": bool(nxt[r["id"]] is None or tail <= nxt[r["id"]] + 1e-3),
            "peak_ok": bool(r["peakDb"] <= -3.0 and r["truePeakDb"] <= -3.0),
            "lufs_ok": bool(abs(r["lufs"] + 20.0) <= 0.3),
        }
        r["checks"] = checks
        if not all(v for k, v in checks.items() if k.endswith("_ok")):
            bad += 1
        if not args.no_asr:
            r["asr"] = {}
            for i, m in enumerate(models):
                prompt = VOCAB_PROMPT if True else None
                res = asr_wer(os.path.join(B, r["file"]), r["text"], m, prompt=prompt)
                res2 = asr_wer(os.path.join(B, r["file"]), r["text"], m, prompt=None) if i == 0 else None
                r["asr"][m] = {"hyp": res["hyp"], "wer": round(res["wer"], 4), "conf": round(res["conf"], 3)}
                if res2:
                    r["asr"][m + "_noprompt"] = {"hyp": res2["hyp"], "wer": round(res2["wer"], 4), "conf": round(res2["conf"], 3)}
            r["wer"] = r["asr"][models[0]]["wer"]
    json.dump(rows, open(os.path.join(B, "vo_lines.json"), "w"), indent=1)
    # ---- report
    print(f"{'id':9s} {'t0':>6s} {'onsetErr':>9s} {'end':>7s}/{'max':<6s} {'tail':>7s} {'peak':>6s} {'tp':>6s} {'LUFS':>6s}  WER  ASR")
    for r in rows:
        c = r["checks"]
        w = ""
        if "asr" in r:
            w = " ".join(f"{m}:{v['wer']*100:.0f}%" for m, v in r["asr"].items()) + f"  '{r['asr'][models[0]]['hyp']}'"
        flag = "" if all(v for k, v in c.items() if k.endswith("_ok")) else "  <-- CHECK"
        print(f"{r['id']:9s} {r['t0']:6.2f} {c['onset_err_ms']:+8.2f}ms {r['end']:7.3f}/{r['maxEnd']:<6.2f} {r['tailEnd']:7.3f} "
              f"{r['peakDb']:6.2f} {r['truePeakDb']:6.2f} {r['lufs']:6.2f}  {w}{flag}")
    if not args.no_asr:
        for m in list(rows[0]["asr"].keys()):
            e = sum(round(r["asr"][m]["wer"] * len(r["text"].split())) for r in rows)
            n = sum(len(r["text"].split()) for r in rows)
            print(f"overall WER [{m}]: {100 * e / n:.1f}% ({e}/{n} words)")
    # ---- stem spectrogram + waveform
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", os.path.join(B, "stems", "vo.wav"), "-lavfi",
                    "showspectrumpic=s=1800x420:legend=1:scale=log:fscale=log:start=60:stop=16000:color=intensity",
                    os.path.join(B, "vo", "_vo_stem_spectrogram.png")], check=False)
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", os.path.join(B, "stems", "vo.wav"), "-lavfi",
                    "showwavespic=s=1800x240:split_channels=0:colors=#ffb62e", os.path.join(B, "vo", "_vo_stem_wave.png")],
                   check=False)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
