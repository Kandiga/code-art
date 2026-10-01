#!/usr/bin/env python3
"""
audio/vo/dsp.py - small, dependency-light (numpy + scipy) DSP toolbox for the VO chain.
All functions are deterministic (seeded RNG only), float64 internally, 48 kHz.
"""
import math
import subprocess
import tempfile
import os

import numpy as np
import scipy.signal as ss

SR = 48000


# ----------------------------------------------------------------------------- basics
def db(x):
    return 20 * np.log10(np.maximum(x, 1e-12))


def lin(d):
    return 10 ** (d / 20.0)


def resample_to(y, sr_in, sr_out=SR):
    if sr_in == sr_out:
        return y.astype(np.float64)
    g = math.gcd(int(sr_in), int(sr_out))
    return ss.resample_poly(y.astype(np.float64), int(sr_out // g), int(sr_in // g), window=("kaiser", 12.0))


def read_wav(path):
    import soundfile as sf
    y, sr = sf.read(path, dtype="float64", always_2d=True)
    return y.T, sr  # (ch, n)


def write_wav_f32(path, y, sr=SR):
    """y: (n,) or (ch,n) -> IEEE-float32 WAV with a minimal header (no PEAK/timestamp chunk: files are byte-exact
    across renders, libsndfile would embed a time stamp)."""
    y = np.asarray(y)
    if y.ndim == 1:
        y = y[None, :]
    ch = y.shape[0]
    data = np.ascontiguousarray(y.T.astype("<f4")).tobytes()
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"RIFF" + (36 + len(data)).to_bytes(4, "little") + b"WAVE")
        f.write(b"fmt " + (16).to_bytes(4, "little") + (3).to_bytes(2, "little") + ch.to_bytes(2, "little")
                + int(sr).to_bytes(4, "little") + (int(sr) * 4 * ch).to_bytes(4, "little") + (4 * ch).to_bytes(2, "little")
                + (32).to_bytes(2, "little"))
        f.write(b"data" + len(data).to_bytes(4, "little") + data)


# ----------------------------------------------------------------------------- filters (RBJ cookbook)
def _norm(b, a):
    return np.array([[b[0] / a[0], b[1] / a[0], b[2] / a[0], 1.0, a[1] / a[0], a[2] / a[0]]])


def peaking(f0, gain_db, q, sr=SR):
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / sr
    al = np.sin(w0) / (2 * q)
    c = np.cos(w0)
    return _norm([1 + al * A, -2 * c, 1 - al * A], [1 + al / A, -2 * c, 1 - al / A])


def low_shelf(f0, gain_db, slope=0.8, sr=SR):
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / sr
    c, s = np.cos(w0), np.sin(w0)
    al = s / 2 * np.sqrt((A + 1 / A) * (1 / slope - 1) + 2)
    tA = 2 * np.sqrt(A) * al
    b = [A * ((A + 1) - (A - 1) * c + tA), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - tA)]
    a = [(A + 1) + (A - 1) * c + tA, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - tA]
    return _norm(b, a)


def high_shelf(f0, gain_db, slope=0.8, sr=SR):
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / sr
    c, s = np.cos(w0), np.sin(w0)
    al = s / 2 * np.sqrt((A + 1 / A) * (1 / slope - 1) + 2)
    tA = 2 * np.sqrt(A) * al
    b = [A * ((A + 1) + (A - 1) * c + tA), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - tA)]
    a = [(A + 1) - (A - 1) * c + tA, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - tA]
    return _norm(b, a)


def hpf(y, fc, order=4, sr=SR):
    return ss.sosfilt(ss.butter(order, fc, "highpass", fs=sr, output="sos"), y, axis=-1)


def lpf(y, fc, order=4, sr=SR):
    return ss.sosfilt(ss.butter(order, fc, "lowpass", fs=sr, output="sos"), y, axis=-1)


def bpf(y, lo, hi, order=2, sr=SR):
    return ss.sosfilt(ss.butter(order, [lo, hi], "bandpass", fs=sr, output="sos"), y, axis=-1)


def eq(y, bands, sr=SR):
    """bands: list of ('peak',f,gain,q) | ('low',f,gain) | ('high',f,gain) | ('hpf',f) | ('lpf',f)."""
    for b in bands:
        k = b[0]
        if k == "peak":
            y = ss.sosfilt(peaking(b[1], b[2], b[3], sr), y)
        elif k == "low":
            y = ss.sosfilt(low_shelf(b[1], b[2], sr=sr), y)
        elif k == "high":
            y = ss.sosfilt(high_shelf(b[1], b[2], sr=sr), y)
        elif k == "hpf":
            y = hpf(y, b[1], sr=sr)
        elif k == "lpf":
            y = lpf(y, b[1], sr=sr)
    return y


# ----------------------------------------------------------------------------- dynamics
def _gain_computer(env_db, thr, ratio, knee):
    x = env_db - thr
    if knee > 0:
        out = np.where(2 * x < -knee, 0.0,
                       np.where(2 * np.abs(x) <= knee, (1 / ratio - 1) * (x + knee / 2) ** 2 / (2 * knee),
                                (1 / ratio - 1) * x))
    else:
        out = np.where(x > 0, (1 / ratio - 1) * x, 0.0)
    return out


def _smooth_gr(gr, atk_n, rel_n):
    """Attack/release smoothing of gain-reduction (dB, <=0) at control rate; python loop is fine (6 kHz)."""
    ca = math.exp(-1.0 / max(atk_n, 1e-3))
    cr = math.exp(-1.0 / max(rel_n, 1e-3))
    out = np.empty_like(gr)
    s = 0.0
    for i, g in enumerate(gr):
        c = ca if g < s else cr
        s = c * s + (1 - c) * g
        out[i] = s
    return out


def compressor(y, thr_db, ratio, atk_ms, rel_ms, knee_db=6.0, makeup_db=0.0, look_ms=1.5, detect="peak",
               sr=SR, ctl=8, return_gr=False, sidechain=None):
    """Feed-forward soft-knee compressor with look-ahead; control signal computed at sr/ctl."""
    n = len(y)
    sc = y if sidechain is None else sidechain
    pad = (-n) % ctl
    a = np.abs(np.concatenate([sc, np.zeros(pad)]))
    if detect == "rms":
        a = np.sqrt(ss.lfilter([1 - math.exp(-1 / (0.005 * sr))], [1, -math.exp(-1 / (0.005 * sr))], a ** 2))
    blocks = a.reshape(-1, ctl).max(axis=1)
    env_db = db(blocks)
    gr = _gain_computer(env_db, thr_db, ratio, knee_db)
    rate = sr / ctl
    gr_s = _smooth_gr(gr, atk_ms * 1e-3 * rate, rel_ms * 1e-3 * rate)
    # upsample control to audio rate (linear), apply look-ahead shift
    t_ctl = (np.arange(len(gr_s)) + 0.5) * ctl
    g_db = np.interp(np.arange(n) + look_ms * 1e-3 * sr, t_ctl, gr_s)
    g = lin(g_db + makeup_db)
    return (y * g, g_db) if return_gr else y * g


def deess(y, lo=5200.0, hi=9800.0, thr_db=-34.0, ratio=4.0, atk_ms=0.6, rel_ms=25.0, sr=SR, max_red_db=9.0):
    """Split-band de-esser: only the sibilant band is compressed (dynamic EQ), the rest is untouched."""
    band = bpf(y, lo, hi, order=2, sr=sr)
    rest = y - band
    # RMS-ish detection on the band (2-pole bandpass has ~unity gain at centre)
    cb, gr_db = compressor(band, thr_db, ratio, atk_ms, rel_ms, knee_db=4.0, detect="rms", sr=sr, ctl=4, return_gr=True)
    gr_db = np.maximum(gr_db, -max_red_db)
    return rest + band * lin(gr_db)


def limiter(y, ceiling_db=-3.0, look_ms=2.0, rel_ms=60.0, sr=SR):
    """Look-ahead peak limiter (multi-channel aware: detection on max over channels)."""
    x = np.atleast_2d(y)
    det = np.max(np.abs(x), axis=0)
    ceil = lin(ceiling_db)
    n = x.shape[1]
    need = np.minimum(1.0, ceil / np.maximum(det, 1e-9))
    nd = db(need)
    la = max(1, int(look_ms * 1e-3 * sr))
    # min-filter over look-ahead window so gain is ready BEFORE the peak, then smooth release
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    nd = minimum_filter1d(nd, size=2 * la + 1, mode="nearest")
    nd = uniform_filter1d(nd, size=la, mode="nearest")
    # one-pole release
    out = np.empty_like(nd)
    s = 0.0
    cr = math.exp(-1.0 / (rel_ms * 1e-3 * sr / 8))
    # run at /8 control rate
    c8 = nd[::8]
    o8 = np.empty_like(c8)
    for i, g in enumerate(c8):
        s = g if g < s else cr * s + (1 - cr) * g
        o8[i] = s
    g_db = np.minimum(np.interp(np.arange(n), np.arange(len(c8)) * 8, o8), nd + 0.0)
    g = lin(g_db)
    yy = x * g
    # hard safety clip at ceiling
    yy = np.clip(yy, -ceil, ceil)
    return yy[0] if np.ndim(y) == 1 else yy


# ----------------------------------------------------------------------------- colour
def tape_saturate(y, drive=2.0, bias=0.08, wet=0.35, sr=SR):
    """Subtle tape-ish saturation: 4x oversampled asymmetric tanh (even+odd harmonics), HF soft roll-off,
    low 'head bump' (+1 dB @ 90 Hz); blended in parallel so character, not distortion."""
    up = ss.resample_poly(y, 4, 1, window=("kaiser", 10.0))
    # pre-emphasis so highs saturate a touch more (tape-like), de-emphasis after
    pre = ss.lfilter([1, -0.5], [1, 0], up)
    s = np.tanh(drive * (pre + bias)) - np.tanh(drive * bias)
    s = s / (drive * (1 - bias * bias * 0 + 0))  # unity small-signal gain
    s = ss.lfilter([1], [1, -0.5], s)
    s = ss.resample_poly(s, 1, 4, window=("kaiser", 10.0))[: len(y)]
    s = lpf(s, 17000, 2, sr)
    s = ss.sosfilt(peaking(90, 1.0, 0.8, sr), s)
    return (1 - wet) * y + wet * s


def air_exciter(y, level_db=-30.0, lo=5500.0, hi=10500.0, hp=10800.0, sr=SR):
    """Harmonic 'air': Piper voices are band-limited at 11 kHz. Rectify the 5.5-10.5 kHz band (adds 2f/3f partials
    above 11 kHz that follow the voice's own envelope), keep only >10.8 kHz, tilt down, blend very low."""
    band = bpf(y, lo, hi, 2, sr)
    up = ss.resample_poly(band, 2, 1)
    ex = np.abs(up) - np.mean(np.abs(up))
    ex = ss.resample_poly(ex, 1, 2)[: len(y)]
    ex = hpf(ex, hp, 4, sr)
    ex = lpf(ex, 17500.0, 2, sr)
    r = np.sqrt(np.mean(ex ** 2)) + 1e-12
    r0 = np.sqrt(np.mean(band ** 2)) + 1e-12
    return y + ex * (r0 / r) * lin(level_db)


def whisper_layer(y, seed=7, bands=20, fmin=140.0, fmax=9500.0, env_hz=45.0, sr=SR):
    """Noise-vocoded copy of y (same temporal/spectral envelope, noise excitation) = breath / hush layer."""
    rng = np.random.RandomState(seed)
    noise = rng.randn(len(y))
    edges = np.geomspace(fmin, fmax, bands + 1)
    out = np.zeros_like(y)
    lp = ss.butter(2, env_hz, "lowpass", fs=sr, output="sos")
    for lo, hi in zip(edges[:-1], edges[1:]):
        sos = ss.butter(2, [lo, min(hi, sr / 2 - 100)], "bandpass", fs=sr, output="sos")
        b = ss.sosfilt(sos, y)
        env = np.maximum(ss.sosfilt(lp, np.abs(b)), 0) * (math.pi / 2)  # mean-abs -> rms-ish
        nb = ss.sosfilt(sos, noise)
        nb = nb / (np.sqrt(np.mean(nb ** 2)) + 1e-12)
        out += nb * env
    return out


# ----------------------------------------------------------------------------- reverb
def plate_ir(rt60=1.2, predelay_ms=14.0, seed=11, sr=SR, mults=(1.0, 0.75, 0.42), xover=(450.0, 3200.0),
             hp=220.0, lp=9000.0, build_ms=7.0):
    """Synthetic stereo 'plate': dense decorrelated noise IR, 3-band frequency-dependent decay, unit energy."""
    n = int(rt60 * 1.25 * sr)
    rng = np.random.RandomState(seed)
    t = np.arange(n) / sr
    irs = []
    for ch in range(2):
        nz = rng.randn(n)
        # zero-phase (filtfilt) crossovers: the three bands stay in phase, so no comb/notch where they overlap
        lo = ss.sosfiltfilt(ss.butter(2, xover[0], "lowpass", fs=sr, output="sos"), nz)
        mid = ss.sosfiltfilt(ss.butter(1, [xover[0], xover[1]], "bandpass", fs=sr, output="sos"), nz)
        hi = ss.sosfiltfilt(ss.butter(2, xover[1], "highpass", fs=sr, output="sos"), nz)
        ir = sum(b * 10 ** (-3 * t / (rt60 * m)) for b, m in zip((lo, mid, hi), mults))
        ir *= 1 - np.exp(-t / (build_ms * 1e-3))
        ir = hpf(ir, hp, 2, sr)
        ir = lpf(ir, lp, 2, sr)
        irs.append(ir)
    pre = np.zeros(int(predelay_ms * 1e-3 * sr))
    ir = np.stack([np.concatenate([pre, i]) for i in irs])
    ir /= math.sqrt(np.sum(ir ** 2) / 2)
    return ir  # (2, n)


def reverb(y, ir, wet_gain):
    """Convolve mono y with stereo IR -> (2,n+len(ir)-1) wet-only signal scaled by wet_gain."""
    return np.stack([ss.fftconvolve(y, ir[c]) for c in range(2)]) * wet_gain


# ----------------------------------------------------------------------------- loudness (BS.1770-4)
_K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
_K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def k_weight(x):
    x = np.atleast_2d(x)
    y = ss.lfilter(_K1[0], _K1[1], x, axis=-1)
    return ss.lfilter(_K2[0], _K2[1], y, axis=-1)


def lufs_integrated(x, sr=SR):
    """Gated integrated loudness (400 ms blocks, 75 % overlap, -70 abs gate, -10 LU relative gate)."""
    x = np.atleast_2d(x)
    k = k_weight(x)
    blk, hop = int(0.4 * sr), int(0.1 * sr)
    n = k.shape[1]
    if n < blk:
        k = np.pad(k, ((0, 0), (0, blk - n)))
        n = blk
    starts = np.arange(0, n - blk + 1, hop)
    cs = np.cumsum(np.concatenate([np.zeros((k.shape[0], 1)), k ** 2], axis=1), axis=1)
    ms = (cs[:, starts + blk] - cs[:, starts]) / blk  # (ch, nblocks)
    z = ms.sum(axis=0)  # all channel weights 1.0
    lk = -0.691 + 10 * np.log10(np.maximum(z, 1e-12))
    g1 = z[lk > -70]
    if len(g1) == 0:
        return -70.0
    rel = -0.691 + 10 * np.log10(g1.mean()) - 10
    g2 = z[lk > rel]
    if len(g2) == 0:
        return -70.0
    return float(-0.691 + 10 * np.log10(g2.mean()))


def lufs_short_max(x, sr=SR):
    """Maximum short-term (3 s window, 1 s hop; windows shorter than 3 s are zero-padded) loudness."""
    x = np.atleast_2d(x)
    k = k_weight(x)
    n = k.shape[1]
    w = min(3 * sr, max(n, int(0.4 * sr)))  # lines shorter than 3 s: the whole line is the window
    if n < w:
        k = np.pad(k, ((0, 0), (0, w - n)))
        n = w
    cs = np.cumsum(np.concatenate([np.zeros((k.shape[0], 1)), k ** 2], axis=1), axis=1)
    starts = np.arange(0, n - w + 1, int(0.1 * sr))
    ms = (cs[:, starts + w] - cs[:, starts]) / w
    z = ms.sum(axis=0)
    return float(-0.691 + 10 * np.log10(max(z.max(), 1e-12)))


def true_peak_db(x, sr=SR):
    x = np.atleast_2d(x)
    up = ss.resample_poly(x, 4, 1, axis=-1)
    return float(db(np.abs(up).max()))


def rms_db(x, thr_db=-60.0):
    """RMS (dBFS) over samples that are not digital silence (gated: frames above thr)."""
    x = np.atleast_2d(x)
    m = np.sqrt(np.mean(x ** 2, axis=0))
    keep = m > lin(thr_db)
    if not keep.any():
        return -120.0
    return float(db(np.sqrt(np.mean(x[:, keep] ** 2))))


# ----------------------------------------------------------------------------- ffmpeg helpers
def ffmpeg_filter(y, sr, af, out_sr=None, ch=1):
    """Run y (n,) or (ch,n) through an ffmpeg -af chain, return (ch,n) float64."""
    y = np.atleast_2d(y)
    with tempfile.TemporaryDirectory() as d:
        a, b = os.path.join(d, "a.wav"), os.path.join(d, "b.wav")
        write_wav_f32(a, y, sr)
        cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", a, "-af", af]
        if out_sr:
            cmd += ["-ar", str(out_sr)]
        cmd += ["-c:a", "pcm_f32le", b]
        subprocess.run(["nice", "-n", "10"] + cmd, check=True)
        z, s2 = read_wav(b)
    return z


def time_stretch(y, tempo, sr=SR, pitch=1.0):
    """Rubber Band via ffmpeg (formant-preserved, crisp transients). tempo>1 = faster/shorter."""
    af = (f"rubberband=tempo={tempo:.6f}:pitch={pitch:.6f}:transients=crisp:detector=compound:"
          f"phase=laminar:window=standard:smoothing=off:formant=preserved:pitchq=quality:channels=together")
    z = ffmpeg_filter(y, sr, af)
    return z[0] if np.ndim(y) == 1 else z


def onset_index(x, thr_db=-40.0):
    """First sample whose |x| (max over channels) exceeds thr_db (dBFS)."""
    x = np.atleast_2d(x)
    m = np.abs(x).max(axis=0)
    idx = np.nonzero(m > lin(thr_db))[0]
    return int(idx[0]) if len(idx) else -1


def end_index(x, thr_db=-40.0):
    x = np.atleast_2d(x)
    m = np.abs(x).max(axis=0)
    idx = np.nonzero(m > lin(thr_db))[0]
    return int(idx[-1]) + 1 if len(idx) else -1
