#!/usr/bin/env python3
"""
audio/vo/prosody.py - post-hoc intonation direction with Praat PSOLA (parselmouth).

Piper (VITS) has no pitch control, so after synthesis we reshape the F0 contour of a take:
    pitch_edit(y, sr, events, global_st=0)  ->  y2   (same length, same timing, formants preserved)

events: list of dicts, times in seconds (relative to the take), semitone offsets:
    {"t0":1.9, "t1":2.3, "st": +2.0}                         raised-cosine accent hump (peak +2 st)
    {"t0":2.5, "t1":3.0, "st0": 0, "st1": +3.5, "shape":"ramp"}   linear ramp, holds st1 afterwards
    {"t0":0.0, "t1":9.9, "st": -1.0, "shape":"plateau"}          flat offset over a range (60 ms cosine edges)
Each event also takes "edge" (seconds, default 0.06) for hump / plateau edges.
"""
import numpy as np


def _curve(t, events, global_st=0.0):
    out = np.full_like(t, float(global_st), dtype=np.float64)
    for e in events:
        shape = e.get("shape", "hump")
        t0, t1 = float(e["t0"]), float(e["t1"])
        if shape == "ramp":
            u = np.clip((t - t0) / max(t1 - t0, 1e-6), 0, 1)
            u = u * u * (3 - 2 * u) if e.get("smooth", True) else u
            out += e.get("st0", 0.0) + (e.get("st1", 0.0) - e.get("st0", 0.0)) * u
            continue
        edge = float(e.get("edge", 0.06))
        st = float(e["st"])
        if shape == "plateau":
            a = np.clip((t - (t0 - edge)) / edge, 0, 1)
            b = np.clip(((t1 + edge) - t) / edge, 0, 1)
            w = 0.5 - 0.5 * np.cos(np.pi * np.minimum(a, b))
        else:  # hump: raised cosine centred in [t0,t1], rising from t0 to the centre, falling to t1
            u = np.clip((t - t0) / max(t1 - t0, 1e-6), 0, 1)
            w = np.where((t >= t0) & (t <= t1), 0.5 - 0.5 * np.cos(2 * np.pi * u), 0.0)
        out += st * w
    return out


def pitch_edit(y, sr, events, global_st=0.0, fmin=60.0, fmax=420.0, time_step=0.01):
    import parselmouth
    from parselmouth.praat import call
    y = np.asarray(y, dtype=np.float64)
    snd = parselmouth.Sound(y, sampling_frequency=sr)
    manip = call(snd, "To Manipulation", time_step, fmin, fmax)
    tier = call(manip, "Extract pitch tier")
    n = call(tier, "Get number of points")
    if n < 3:
        return y
    ts = np.array([call(tier, "Get time from index", i) for i in range(1, n + 1)])
    fs = np.array([call(tier, "Get value at index", i) for i in range(1, n + 1)])
    f2 = fs * 2.0 ** (_curve(ts, events, global_st) / 12.0)
    new = call("Create PitchTier", "p", snd.xmin, snd.xmax)
    for t, f in zip(ts, f2):
        call(new, "Add point", float(t), float(f))
    call([manip, new], "Replace pitch tier")
    out = call(manip, "Get resynthesis (overlap-add)")
    z = out.values[0].astype(np.float64)
    if len(z) < len(y):
        z = np.pad(z, (0, len(y) - len(z)))
    return z[: len(y)]


def f0_track(y, sr, fmin=60.0, fmax=420.0, step=0.01):
    """-> (times, f0 Hz with 0 for unvoiced)"""
    import parselmouth
    snd = parselmouth.Sound(np.asarray(y, dtype=np.float64), sampling_frequency=sr)
    p = snd.to_pitch(time_step=step, pitch_floor=fmin, pitch_ceiling=fmax)
    return p.xs(), p.selected_array["frequency"]
