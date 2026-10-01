#!/usr/bin/env python3
"""
audio/vo/analyze.py - objective voice metrics + ASR (faster-whisper) for the VO pipeline.

  python analyze.py asr  <wav> [--ref "text"] [--model base.en]
  python analyze.py asr-lines <vo_lines.json> <dir-with-wavs> [--model ...] > report.json

Library use: from analyze import asr_wer, voice_metrics
"""
import json
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("HF_HOME", os.path.join(HERE, "models", "hf"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

_models = {}


def get_asr(name="base.en"):
    if name not in _models:
        from faster_whisper import WhisperModel
        _models[name] = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=2)
    return _models[name]


_NUM = [
    (r"\ba hundred and thirty\b", "130"),
    (r"\bone hundred and thirty\b", "130"),
    (r"\bone hundred thirty\b", "130"),
    (r"\bone thirty\b", "130"),
]


def norm(t):
    t = t.lower().replace("’", "'")
    for a, b in _NUM:
        t = re.sub(a, b, t)
    t = re.sub(r"[^a-z0-9' ]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def edit_distance(a, b):
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = cur
    return d[len(b)]


VOCAB_PROMPT = "Amrita Cinema Studio. Meet Amrita. Your story. Directed."


def asr_wer(path, ref, model="base.en", beam=5, prompt=None):
    """Transcribe wav, return dict(hyp, wer, errors, nref, conf) (conf = mean word probability).
    prompt: optional Whisper initial_prompt (vocabulary hint, e.g. the brand name 'Amrita')."""
    m = get_asr(model)
    segs, _ = m.transcribe(path, language="en", beam_size=beam, word_timestamps=True,
                           condition_on_previous_text=False, vad_filter=False, temperature=0.0,
                           initial_prompt=prompt)
    words, probs, text = [], [], ""
    for s in segs:
        text += s.text
        for w in (s.words or []):
            probs.append(w.probability)
    hyp = norm(text)
    r = norm(ref)
    rw, hw = r.split(), hyp.split()
    err = edit_distance(rw, hw)
    return {"hyp": text.strip(), "wer": err / max(1, len(rw)), "errors": err, "nref": len(rw),
            "conf": float(np.mean(probs)) if probs else 0.0, "minconf": float(np.min(probs)) if probs else 0.0}


_dns = {}


def dnsmos(y, sr):
    """Microsoft DNSMOS (P.835 primary model, via the ONNX files shipped in the `speechmos` wheel).
    Returns mean (sig, bak, ovrl) over 9.01 s windows (hop 1 s) of the 16 kHz signal."""
    import onnxruntime as ort
    import scipy.signal as ss
    import speechmos
    if "s" not in _dns:
        p = os.path.join(os.path.dirname(speechmos.__file__), "dnsmos_models", "sig_bak_ovr.onnx")
        _dns["s"] = ort.InferenceSession(p, providers=["CPUExecutionProvider"])
    x = ss.resample_poly(y, 16000, sr) if sr != 16000 else y
    x = np.clip(x, -1, 1).astype(np.float32)
    n = int(9.01 * 16000)
    while len(x) < n:
        x = np.concatenate([x, x])
    hops = int(np.floor(len(x) / 16000 - 9.01)) + 1
    polys = (np.poly1d([-0.08397278, 1.22083953, 0.0052439]), np.poly1d([-0.13166888, 1.60915514, -0.39604546]),
             np.poly1d([-0.06766283, 1.11546468, 0.04602535]))
    acc = []
    for i in range(hops):
        seg = x[i * 16000: i * 16000 + n]
        if len(seg) < n:
            continue
        raw = _dns["s"].run(None, {"input_1": seg[None, :]})[0][0]
        acc.append([polys[k](raw[k]) for k in range(3)])
    a = np.mean(acc, axis=0)
    return {"sig": float(a[0]), "bak": float(a[1]), "ovrl": float(a[2])}


def read_wav_mono(path):
    import soundfile as sf
    y, sr = sf.read(path, dtype="float32", always_2d=True)
    return y.mean(axis=1), sr


def voice_metrics(y, sr):
    """F0 stats (Praat), HNR, alpha-ratio / spectral tilt of the voiced speech."""
    import parselmouth
    from parselmouth.praat import call
    snd = parselmouth.Sound(y.astype(np.float64), sampling_frequency=sr)
    pitch = snd.to_pitch(time_step=0.01, pitch_floor=60, pitch_ceiling=420)
    f0 = pitch.selected_array["frequency"]
    f0v = f0[f0 > 0]
    if len(f0v) < 5:
        return {}
    st = 12 * np.log2(f0v / np.median(f0v))
    hnr = snd.to_harmonicity_cc(time_step=0.01, minimum_pitch=60)
    hv = hnr.values[hnr.values > -100]
    # spectral tilt: slope (dB/oct) of long-term average spectrum 200 Hz .. 5 kHz of voiced frames
    Y = np.abs(np.fft.rfft(y * np.hanning(len(y)))) ** 2
    fr = np.fft.rfftfreq(len(y), 1 / sr)
    band = (fr >= 200) & (fr <= 5000)
    # smooth in octave bins
    edges = np.geomspace(200, 5000, 14)
    pw = [10 * np.log10(Y[(fr >= a) & (fr < b)].mean() + 1e-20) for a, b in zip(edges[:-1], edges[1:])]
    cf = np.sqrt(edges[:-1] * edges[1:])
    slope = np.polyfit(np.log2(cf), pw, 1)[0]
    lo = Y[(fr >= 50) & (fr < 1000)].sum()
    hi = Y[(fr >= 1000) & (fr < 5000)].sum()
    return {"f0_med": float(np.median(f0v)), "f0_mean": float(f0v.mean()), "f0_sd_st": float(st.std()),
            "f0_range_st": float(np.percentile(st, 95) - np.percentile(st, 5)), "hnr": float(hv.mean()),
            "tilt_db_oct": float(slope), "alpha_ratio_db": float(10 * np.log10(hi / lo + 1e-20))}


def main():
    cmd = sys.argv[1]
    model = "base.en"
    if "--model" in sys.argv:
        model = sys.argv[sys.argv.index("--model") + 1]
    if cmd == "asr":
        ref = sys.argv[sys.argv.index("--ref") + 1] if "--ref" in sys.argv else ""
        print(json.dumps(asr_wer(sys.argv[2], ref, model), indent=1))
    elif cmd == "asr-lines":
        lines = json.load(open(sys.argv[2]))
        d = sys.argv[3]
        res = []
        for ln in lines:
            r = asr_wer(os.path.join(d, ln["id"] + ".wav"), ln["text"], model)
            r.update(id=ln["id"], text=ln["text"])
            res.append(r)
        print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
