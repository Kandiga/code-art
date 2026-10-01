#!/usr/bin/env python3
"""
audio/vo/process.py - the VO "studio": direction.json + cues -> processed, fitted, placed lines.

  python process.py [--only vo1,vo3b] [--cues cues.json] [--out audio/build] [--no-cache]

Reads  : audio/vo/direction.json   (voices, per-line prosody, chain settings)
         cues (VO, VO_DIEGETIC, BRAND) via `node` import of shared/cues.js (never hard-coded here)
Writes : <out>/stems/vo.wav          60 s stereo float32, lines placed with onset == t0
         <out>/vo/<id>.wav           per-line processed wav, sample 0 == speech onset (-40 dBFS rule)
         <out>/vo_lines.json         [{id,text,t0,onset,end,maxEnd,peakDb,lufs,rmsDb,diegetic?, ...}]
Raw (dry) synthesized takes are cached in audio/vo/raw/ (committed) so the final render is bit-exact
even if onnxruntime changes; delete a take to re-synthesize it.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dsp  # noqa: E402
import prosody  # noqa: E402
import synth  # noqa: E402

SR = dsp.SR
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))  # promo/
RAW = os.path.join(HERE, "raw")


# ----------------------------------------------------------------------------- cues
def load_cues():
    js = ("import * as c from '../../shared/cues.js';"
          "console.log(JSON.stringify({vo:c.VO,dia:c.VO_DIEGETIC,tagline:c.BRAND.tagline,dur:c.DURATION}))")
    out = subprocess.check_output(["node", "--input-type=module", "-e", js], cwd=HERE)
    return json.loads(out)


# ----------------------------------------------------------------------------- takes (synth + cache)
def take_key(voice, speaker, seed, segments):
    blob = json.dumps({"v": 3, "voice": voice, "speaker": speaker, "seed": seed, "segs": segments}, sort_keys=True)
    return hashlib.sha1(blob.encode()).hexdigest()[:12]


def get_take(lid, voice_cfg, spec, ls_mul, use_cache=True):
    """-> (y22k float64, sr, words[{w,t0,t1}], path). Segment length_scales are multiplied by ls_mul."""
    segs = []
    for s in spec["segments"]:
        segs.append({
            "text": s["text"],
            "length_scale": round(float(s.get("ls", 1.0)) * ls_mul, 4),
            "noise_scale": float(s.get("ns", voice_cfg.get("ns", 0.667))),
            "noise_w": float(s.get("nw", voice_cfg.get("nw", 0.8))),
            "gap_after": float(s.get("gap", 0.0)),
            "sentence_silence": float(s.get("ss", 0.0)),
        })
    seed = int(spec.get("seed", voice_cfg.get("seed", 1)))
    speaker = int(voice_cfg.get("speaker", 0))
    key = take_key(voice_cfg["voice"], speaker, seed, segs)
    path = os.path.join(RAW, f"{lid}.{key}.wav")
    wpath = os.path.splitext(path)[0] + ".words.json"
    if not (use_cache and os.path.exists(path) and os.path.exists(wpath)):
        os.makedirs(RAW, exist_ok=True)
        synth.run_job({"id": lid, "voice": voice_cfg["voice"], "speaker": speaker, "seed": seed,
                       "segments": segs, "out": path})
    y, sr = dsp.read_wav(path)
    words = json.load(open(wpath))
    return y[0].astype(np.float64), sr, words, path


def prune_raw(keep):
    if not os.path.isdir(RAW):
        return
    for f in os.listdir(RAW):
        p = os.path.join(RAW, f)
        if p not in keep and os.path.splitext(p)[0] + ".wav" not in keep and f.endswith((".wav", ".words.json")):
            base = f[:-len(".words.json")] + ".wav" if f.endswith(".words.json") else f
            if os.path.join(RAW, base) not in keep:
                os.remove(p)


# ----------------------------------------------------------------------------- the chain
def narrator_chain(y, cfg, spec, seed_base):
    """dry mono 48 k -> (dry, wet(2,n+tail)) processed with consistent 'trailer VO' character."""
    c = cfg["chain"]
    tone = dict(c["tone"])
    tone.update(spec.get("tone", {}))
    # level the voiced signal to a fixed working level so thresholds mean the same for every line
    voiced = np.abs(y) > 0.02 * np.abs(y).max()
    y = y * (dsp.lin(-23.0) / (np.sqrt(np.mean(y[voiced] ** 2)) + 1e-12))
    y = dsp.hpf(y, c["hpf"], order=4)
    y = dsp.eq(y, [("low", tone["low_hz"], tone["low_db"]),
                   ("peak", 380.0, tone["mud_db"], 1.0),
                   ("peak", tone["pres_hz"], tone["pres_db"], tone["pres_q"]),
                   ("high", 10500.0, tone["air_db"])])
    d = c["deess"]
    y = dsp.deess(y, d["lo"], d["hi"], d["thr_db"], d["ratio"], d["atk_ms"], d["rel_ms"])
    k1, k2 = c["comp1"], c["comp2"]
    y = dsp.compressor(y, k1["thr_db"], k1["ratio"], k1["atk_ms"], k1["rel_ms"], k1["knee_db"], k1["makeup_db"],
                       detect="peak")
    y = dsp.compressor(y, k2["thr_db"], k2["ratio"], k2["atk_ms"], k2["rel_ms"], k2["knee_db"], k2["makeup_db"],
                       detect="rms")
    sat = c["sat"]
    y = dsp.tape_saturate(y, sat["drive"], sat["bias"], sat["wet"])
    hush = float(spec.get("hush", 0.0))
    if hush > 0:
        y = y + dsp.whisper_layer(y, seed=seed_base + 5) * hush
    return y


def make_reverb(y, cfg, spec, seed_base, tail_limit_s):
    """-> wet stereo (2, n_total). Plate IR is seeded so every render is identical."""
    r = cfg["chain"]["reverb"]
    wet = float(spec.get("wet", r["wet"]))
    rt = float(spec.get("rt60", r["rt60"]))
    pre = float(spec.get("predelay_ms", r["predelay_ms"]))
    ir = dsp.plate_ir(rt, pre, seed=r["seed"], mults=tuple(r["mults"]), hp=r["hp"], lp=r["lp"])
    send = dsp.hpf(y, 220.0, 2)
    w = dsp.reverb(send, ir, wet)
    if tail_limit_s is not None:
        # hard guarantee: the tail is gone (cosine fade over 120 ms) by the next line's first sample
        n = w.shape[1]
        t = np.arange(n) / SR
        fade = np.clip((tail_limit_s - t) / 0.12, 0.0, 1.0)
        w = w * (0.5 - 0.5 * np.cos(np.pi * fade))
    return w


def combine(dry, wet):
    n = max(len(dry), wet.shape[1])
    L = np.zeros(n)
    R = np.zeros(n)
    L[: len(dry)] += dry
    R[: len(dry)] += dry
    L[: wet.shape[1]] += wet[0]
    R[: wet.shape[1]] += wet[1]
    return np.stack([L, R])


# ----------------------------------------------------------------------------- hello: 1927 optical sound-on-film
def vintage_optical(y, cfg, seed):
    """Diegetic 1927 talkie 'Hello!': small room -> carbon-mic band-pass (300-3500 Hz, resonant) -> amp
    distortion -> wow & flutter (transport). Returns (voice, noise): noise = optical-track hiss + 24 Hz frame
    thump + dust crackle, kept separate so the caller can gate it like a noise-reduction shutter."""
    v = cfg["vintage"]
    rng = np.random.RandomState(seed)
    # 1) a little room (small hall, 0.35 s, 3 ms pre-delay, band-limited)
    ir = dsp.plate_ir(v["room_rt60"], 3.0, seed=seed + 1, mults=(1.0, 0.7, 0.4), hp=300.0, lp=4500.0)
    wet = dsp.reverb(dsp.hpf(y, 250.0, 2), ir, v["room_wet"])
    wet_m = 0.5 * (wet[0] + wet[1])
    n = len(y)
    x = np.pad(y, (0, len(wet_m) - n)) + wet_m
    # 2) carbon-microphone / early optical response: steep 300-3500 Hz band-pass + presence resonance
    x = dsp.hpf(x, v["bp_lo"], order=4)
    x = dsp.lpf(x, v["bp_hi"], order=4)
    x = dsp.eq(x, [("peak", 1100.0, 3.0, 1.2), ("peak", v["res_hz"], v["res_db"], v["res_q"])])
    # 3) light distortion (asymmetric soft clip: even + odd harmonics), then re-band-limit
    x = x / (np.abs(x).max() + 1e-9)
    d = v["drive"]
    x = np.tanh(d * (x + 0.12)) - np.tanh(d * 0.12)
    x = dsp.lpf(dsp.hpf(x, v["bp_lo"], 2), v["bp_hi"], 2)
    # 4) wow & flutter via a modulated fractional delay (peak pitch deviation in %, rate in Hz)
    t = np.arange(len(x)) / SR
    wow = v["wow_pct"] / 100 / (2 * np.pi * v["wow_hz"]) * np.sin(2 * np.pi * v["wow_hz"] * t + rng.uniform(0, 6.28))
    flu = v["flutter_pct"] / 100 / (2 * np.pi * v["flutter_hz"]) * np.sin(2 * np.pi * v["flutter_hz"] * t + rng.uniform(0, 6.28))
    wn = dsp.lpf(rng.randn(len(x)), 9.0, 2)
    wn = wn / (np.abs(wn).max() + 1e-9) * v["weave_pct"] / 100 / (2 * np.pi * 4.0)
    pos = np.arange(len(x)) + (wow + flu + wn) * SR
    x = np.interp(pos, np.arange(len(x)), x)
    x = x / (np.abs(x).max() + 1e-9) * 0.5  # voice peaks at -6 dBFS (noise levels below are relative to this)
    # 5) optical track noise: hiss (band-limited), 24 fps frame-rate thump, dust crackle (Poisson clicks)
    hiss = dsp.bpf(rng.randn(len(x)), 250.0, 5200.0, 2)
    hiss = hiss / np.sqrt(np.mean(hiss ** 2)) * dsp.lin(v["hiss_db"])
    thump = dsp.bpf(np.sin(2 * np.pi * 24.0 * t + rng.uniform(0, 6.28)) + 0.5 * np.sin(2 * np.pi * 48.0 * t), 18.0, 140.0, 2)
    thump = thump / (np.abs(thump).max() + 1e-9) * dsp.lin(v["thump_db"])
    clicks = np.zeros(len(x))
    nclk = rng.poisson(v["crackle_per_s"] * len(x) / SR)
    for _ in range(nclk):
        i = rng.randint(0, len(x))
        L = min(rng.randint(8, 70), len(x) - i)
        amp = dsp.lin(v["crackle_db"] + rng.gamma(2.0, 3.0)) * rng.choice([-1, 1])
        clicks[i: i + L] += amp * np.exp(-np.arange(L) / (L / 4.0)) * rng.randn(L)
    clicks = dsp.hpf(clicks, 400.0, 1)
    noise = dsp.lpf(dsp.hpf(hiss + thump + clicks, 60.0, 2), 6500.0, 2)
    return dsp.lpf(dsp.hpf(x, 60.0, 2), 6500.0, 2), noise


# ----------------------------------------------------------------------------- fit + finish
def smooth_env(n, regions, sr=SR, edge=0.03):
    """Gain envelope (dB) with raised-cosine edges: regions = [(t0,t1,db)]."""
    g = np.zeros(n)
    t = np.arange(n) / sr
    for t0, t1, d in regions:
        a = np.clip((t - (t0 - edge)) / (2 * edge), 0, 1)
        b = np.clip(((t1 + edge) - t) / (2 * edge), 0, 1)
        w = 0.5 - 0.5 * np.cos(np.pi * np.minimum(a, b))
        g += d * w
    return g


def find_word(words, key, nth=0):
    k = "".join(ch for ch in key.lower() if ch.isalnum() or ch == "'")
    hits = [w for w in words if "".join(ch for ch in w["w"].lower() if ch.isalnum() or ch == "'") == k]
    if len(hits) <= nth:
        raise KeyError(f"word '{key}' not found in {[w['w'] for w in words]}")
    return hits[nth]


def resolve_pitch_events(spec_pitch, words):
    ev = []
    for e in spec_pitch.get("events", []):
        e = dict(e)
        if "word" in e:
            w = find_word(words, e.pop("word"), e.pop("nth", 0))
            e["t0"] = w["t0"] + e.pop("pad0", 0.0)
            e["t1"] = w["t1"] + e.pop("pad1", 0.0)
        ev.append(e)
    return ev


def lead_in(x, n):
    return x


def render_line(cue, role, spec, D, next_t0, use_cache=True, log=print):
    vcfg = D["voices"][spec.get("voice", role)]
    cfg = D
    seed_base = int(spec.get("seed", vcfg.get("seed", 1))) * 101 + 7
    avail = cue["maxEnd"] - cue["t0"] - float(spec.get("end_margin_s", D["fit"]["end_margin_s"]))
    ls_mul, tempo = 1.0, 1.0
    min_ls = D["fit"]["min_ls_mul"]
    max_tempo = D["fit"]["max_tempo"]
    hist = []
    for attempt in range(8):
        y22, sr22, words, path = get_take(cue["id"], vcfg, spec, ls_mul, use_cache)
        # --- intonation direction on the raw take (PSOLA), word-anchored
        pe = spec.get("pitch", {})
        if pe.get("events") or pe.get("global_st"):
            y22 = prosody.pitch_edit(y22, sr22, resolve_pitch_events(pe, words), pe.get("global_st", 0.0))
        y = dsp.resample_to(y22, sr22, SR)
        wd = [dict(w) for w in words]
        # --- per-word gain direction (dB) before dynamics
        wg = spec.get("word_gain", [])
        if wg:
            regs = []
            for e in wg:
                w = find_word(wd, e["word"], e.get("nth", 0))
                regs.append((w["t0"] + e.get("pad0", 0.0), w["t1"] + e.get("pad1", 0.0), e["db"]))
            y = y * dsp.lin(smooth_env(len(y), regs))
        # --- final-stage rate trim (Rubber Band), only after length_scale has been exhausted
        if abs(tempo - 1.0) > 1e-4:
            y = dsp.time_stretch(y, tempo)
            for w in wd:
                w["t0"] /= tempo
                w["t1"] /= tempo
        # --- processing
        if role == "narrator":
            dry = narrator_chain(y, D, spec, seed_base)
            noise = None
            wet = make_reverb(dry, D, spec, seed_base, None if next_t0 is None else None)
        else:
            dry, noise = hello_chain(y, D, spec, seed_base)
            wet = np.zeros((2, len(dry)))
        # onset/end measured on the dry voice after the final gain; gain from total loudness
        # (tail limit is applied after we know the onset: time origin = onset)
        res = finalize(cue, role, dry, noise, wet, D, spec, next_t0)
        dur = res["end_s"] - res["onset_s"]
        hist.append((round(ls_mul, 4), round(tempo, 4), round(dur, 3)))
        if dur <= avail + 1e-9:
            break
        f = avail / dur
        if ls_mul * f * 0.997 >= min_ls and tempo == 1.0:
            ls_mul *= f * 0.997
        else:
            ls_mul = max(min_ls, ls_mul * f * 0.997) if tempo == 1.0 and ls_mul > min_ls else ls_mul
            tempo = min(max_tempo, tempo / (f * 0.997)) if tempo > 0 else tempo
            if tempo >= max_tempo - 1e-9 and attempt >= 5:
                break
    res["words"] = []
    for w in wd:
        res["words"].append({"w": w["w"], "t0": round(cue["t0"] + (w["t0"] - res["onset_s"]), 4),
                             "t1": round(cue["t0"] + (w["t1"] - res["onset_s"]), 4)})
    res["ls_mul"], res["tempo"], res["fit_history"] = ls_mul, tempo, hist
    res["take"] = os.path.basename(path)
    return res


def hello_chain(y, D, spec, seed_base):
    v = D["vintage"]
    y = dsp.hpf(y, 60.0, 2)
    if spec.get("formant_shift"):
        # brighter / slightly nasal timbre: shift spectral envelope without moving pitch (rubberband formant)
        y = dsp.ffmpeg_filter(y, SR, f"rubberband=pitch={2 ** (spec['formant_shift'] / 12):.5f}:formant=shifted:"
                                     f"transients=crisp:pitchq=quality")[0][: len(y)]
    # voice-only path (gets the vintage mic/optical colour) and noise path (hiss/crackle) kept separate
    vo, noise = vintage_optical(y, D, seed_base)
    return vo, noise


def finalize(cue, role, dry, noise, wet, D, spec, next_t0):
    """Level, limit, find onset/end, trim to onset, enforce tail-before-next-line. -> dict.
    Order matters for short lines: loudness is measured on the TRIMMED line (block alignment shifts with
    the trim), so onset <-> gain are iterated to a fixed point."""
    target = D["level"]["lufs"]
    ceil = D["level"]["peak_db"] - 0.15  # inter-sample headroom so true peak stays <= -3 dBTP
    n = len(dry)
    g = dsp.lin(target - dsp.lufs_integrated(combine(dry if noise is None else dry + noise, wet)))
    onset_s = end_s = 0.0
    for _ in range(6):
        d0 = dry * g
        onset, end = dsp.onset_index(d0, -40.0), dsp.end_index(d0, -40.0)
        onset_s, end_s = onset / SR, end / SR
        if noise is not None:
            # optical noise-reduction shutter: hiss/crackle only exist around the word (10 ms in, 140 ms out)
            t = np.arange(n) / SR
            a_ = np.clip((t - onset_s) / 0.010, 0, 1)
            b_ = np.clip(((end_s + 0.14) - t) / 0.14, 0, 1)
            src = dry + noise * (0.5 - 0.5 * np.cos(np.pi * np.minimum(a_, b_)))
        else:
            src = dry
        # tail limit in take time: next line's onset (cue time) minus 12 ms, origin = this line's onset
        tl = None if (next_t0 is None or role != "narrator") else (next_t0 - cue["t0"]) - 0.012 + onset_s
        w = make_reverb_gated(wet, tl)
        full = combine(src, w)
        t_end = max(dsp.end_index(full * g, -72.0), end)
        g_new = dsp.lin(target - dsp.lufs_integrated(full[:, onset:t_end]))  # `full` is unscaled here
        if abs(g_new / g - 1) < 2e-4:
            g = g_new
            break
        g = g_new
    d0 = dry * g
    onset, end = dsp.onset_index(d0, -40.0), dsp.end_index(d0, -40.0)
    onset_s, end_s = onset / SR, end / SR
    t_end = max(dsp.end_index(full * g, -72.0), end)
    full = full[:, onset:t_end] * g
    nf = int(0.02 * SR)
    full[:, -nf:] *= np.linspace(1, 0, nf)[None, :]
    full = dsp.limiter(full, ceil, look_ms=2.0, rel_ms=80.0)
    for _ in range(3):  # limiter costs a little loudness on peaky lines -> re-trim, re-limit
        lu = dsp.lufs_integrated(full)
        if abs(lu - target) < 0.05:
            break
        full = dsp.limiter(full * dsp.lin(target - lu), ceil, look_ms=2.0, rel_ms=80.0)
    return {"audio": full, "onset_s": onset_s, "end_s": end_s, "gain_db": float(20 * np.log10(g))}


def make_reverb_gated(wet, tail_limit_s):
    if tail_limit_s is None:
        return wet
    n = wet.shape[1]
    t = np.arange(n) / SR
    fade = np.clip((tail_limit_s - t) / 0.12, 0.0, 1.0)
    return wet * (0.5 - 0.5 * np.cos(np.pi * fade))


def render_all(args):
    cues = load_cues()
    D = json.load(open(args.direction))
    only = set(x for x in args.only.split(",") if x)
    items = [(c, "narrator") for c in cues["vo"]] + [(c, "diegetic") for c in cues["dia"]]
    items.sort(key=lambda it: it[0]["t0"])
    out_dir = args.out
    os.makedirs(os.path.join(out_dir, "vo"), exist_ok=True)
    os.makedirs(os.path.join(out_dir, "stems"), exist_ok=True)
    total = int(round(cues["dur"] * SR))
    stem = np.zeros((2, total))
    rows, keep = [], set()
    for idx, (cue, role) in enumerate(items):
        if only and cue["id"] not in only:
            continue
        spec = D["lines"][cue["id"]]
        if cue["id"] == "vo6b":
            spec = dict(spec)
        nxt = items[idx + 1][0]["t0"] if idx + 1 < len(items) else None
        res = render_line(cue, role, spec, D, nxt, use_cache=not args.no_cache)
        a = res["audio"]
        keep.add(os.path.join(RAW, res["take"]))
        wav = os.path.join(out_dir, "vo", cue["id"] + ".wav")
        dsp.write_wav_f32(wav, a)
        i0 = int(round(cue["t0"] * SR))
        j = min(total, i0 + a.shape[1])
        stem[:, i0:j] += a[:, : j - i0]
        pk = float(dsp.db(np.abs(a).max()))
        row = {
            "id": cue["id"], "text": cue["text"], "t0": cue["t0"],
            "onset": round(cue["t0"], 6),  # by construction: line sample 0 (first > -40 dBFS) is placed at t0
            "end": round(cue["t0"] + (res["end_s"] - res["onset_s"]), 4),
            "maxEnd": cue["maxEnd"],
            "peakDb": round(pk, 2), "truePeakDb": round(dsp.true_peak_db(a), 2),
            "lufs": round(dsp.lufs_integrated(a), 2), "lufsShortMax": round(dsp.lufs_short_max(a), 2),
            "rmsDb": round(dsp.rms_db(a), 2),
            "tailEnd": round(cue["t0"] + dsp.end_index(a, -60.0) / SR, 3),
            "file": f"vo/{cue['id']}.wav", "voice": D["voices"][spec.get("voice", role)]["voice"],
            "lengthScaleMul": round(res["ls_mul"], 4), "tempo": round(res["tempo"], 4),
            "mixHintDb": spec.get("mix_hint_db", 0.0), "words": res["words"],
        }
        if role == "diegetic":
            row["diegetic"] = True
        rows.append(row)
        print(f"{cue['id']:8s} onset {cue['t0']:.3f} end {row['end']:.3f} (max {cue['maxEnd']}) lufs {row['lufs']} "
              f"peak {row['peakDb']} tp {row['truePeakDb']} ls*{res['ls_mul']:.3f} tempo {res['tempo']:.3f}", flush=True)
    if not only:
        dsp.write_wav_f32(os.path.join(out_dir, "stems", "vo.wav"), stem)
        json.dump(rows, open(os.path.join(out_dir, "vo_lines.json"), "w"), indent=1)
        prune_raw(keep)
    else:
        json.dump(rows, open(os.path.join(out_dir, "vo_lines.partial.json"), "w"), indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default=os.path.join(ROOT, "audio", "build"))
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--direction", default=os.path.join(HERE, "direction.json"))
    args = ap.parse_args()
    render_all(args)


if __name__ == "__main__":
    main()
