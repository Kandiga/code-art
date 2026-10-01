"""audio/crowd/py/common.py - tiny shared helpers (48 kHz mono float arrays, seeded RNG, WAV I/O)."""
import json
import os
import numpy as np
import soundfile as sf
from scipy import signal

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
CROWD = os.path.dirname(HERE)
LIB = os.path.join(CROWD, 'lib')


def rng_of(*parts):
    """deterministic RandomState from any parts (stable across runs/machines: crc32 of the joined string)."""
    import zlib
    return np.random.RandomState(zlib.crc32('|'.join(str(p) for p in parts).encode()) & 0x7FFFFFFF)


def db(x):
    return 20 * np.log10(np.maximum(x, 1e-12))


def lin(d):
    return 10 ** (d / 20.0)


def write_wav(path, y, sr=SR):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    sf.write(path, np.asarray(y, dtype=np.float32), sr, subtype='FLOAT')


def read_wav(path):
    y, sr = sf.read(path, dtype='float64')
    if y.ndim > 1:
        y = y.mean(axis=1)
    if sr != SR:
        from math import gcd
        g = gcd(int(sr), SR)
        y = signal.resample_poly(y, SR // g, int(sr) // g)
    return y


def resample_to(y, sr_in, sr_out=SR):
    from math import gcd
    if sr_in == sr_out:
        return np.asarray(y, dtype=np.float64)
    g = gcd(int(sr_in), int(sr_out))
    return signal.resample_poly(np.asarray(y, dtype=np.float64), int(sr_out) // g, int(sr_in) // g)


def curve(n, pts, log=False, smooth_ms=0.0):
    """piecewise-linear control curve over n samples. pts = [(t_sec, value), ...]. log=True interpolates in log domain."""
    t = np.arange(n) / SR
    ts = np.array([p[0] for p in pts], float)
    vs = np.array([p[1] for p in pts], float)
    v = np.exp(np.interp(t, ts, np.log(vs))) if log else np.interp(t, ts, vs)
    if smooth_ms > 0:
        k = max(1, int(smooth_ms * 1e-3 * SR))
        ker = np.hanning(2 * k + 1)
        ker /= ker.sum()
        v = np.convolve(np.pad(v, (k, k), mode='edge'), ker, mode='valid')
    return v


def smooth_noise(n, rng, rate_hz):
    """slowly varying zero-mean unit-ish noise (random points every 1/rate_hz s, cosine-interpolated)."""
    m = int(n / SR * rate_hz) + 3
    pts = rng.randn(m)
    u = np.arange(n) / SR * rate_hz
    i = np.minimum(u.astype(int), m - 2)
    f = u - i
    f = 0.5 - 0.5 * np.cos(np.pi * f)
    return pts[i] * (1 - f) + pts[i + 1] * f


def onset_index(x, thr_db=-40.0):
    pk = np.abs(x).max()
    if pk <= 0:
        return 0
    idx = np.nonzero(np.abs(x) > pk * lin(thr_db))[0]
    return int(idx[0]) if len(idx) else 0


def end_index(x, thr_db=-40.0):
    pk = np.abs(x).max()
    idx = np.nonzero(np.abs(x) > pk * lin(thr_db))[0]
    return int(idx[-1]) + 1 if len(idx) else len(x)


def trim(x, thr_db=-45.0, pad_ms=4.0, tail_ms=20.0):
    a = max(0, onset_index(x, thr_db) - int(pad_ms * 1e-3 * SR))
    b = min(len(x), end_index(x, thr_db) + int(tail_ms * 1e-3 * SR))
    return x[a:b]


def fade_edges(x, in_ms=3.0, out_ms=12.0):
    x = x.copy()
    ni = min(len(x), int(in_ms * 1e-3 * SR))
    no = min(len(x), int(out_ms * 1e-3 * SR))
    if ni > 0:
        x[:ni] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(ni) / ni)
    if no > 0:
        x[len(x) - no:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(no) / no)
    return x


def active_rms_db(x, win_ms=20.0, gate_db=-30.0):
    """RMS (dBFS) over the 'active' 20 ms blocks (those within gate_db of the loudest block)."""
    n = int(win_ms * 1e-3 * SR)
    m = len(x) // n
    if m == 0:
        return float(db(np.sqrt(np.mean(x ** 2) + 1e-18)))
    b = np.sqrt(np.mean(x[: m * n].reshape(m, n) ** 2, axis=1))
    pk = b.max()
    sel = b > pk * lin(gate_db)
    return float(db(np.sqrt(np.mean(b[sel] ** 2) + 1e-18)))


def set_active_rms(x, target_db=-24.0, peak_cap_db=-1.0):
    g = lin(target_db - active_rms_db(x))
    y = x * g
    pk = np.abs(y).max()
    cap = lin(peak_cap_db)
    if pk > cap:
        y = y * (cap / pk)
    return y


def biquad_filter(x, kind, f, q=0.707, gain_db=0.0):
    """RBJ biquad (lp hp bp peak lowshelf highshelf notch)."""
    w0 = 2 * np.pi * f / SR
    A = 10 ** (gain_db / 40.0)
    al = np.sin(w0) / (2 * q)
    c = np.cos(w0)
    if kind == 'lp':
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]; a = [1 + al, -2 * c, 1 - al]
    elif kind == 'hp':
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]; a = [1 + al, -2 * c, 1 - al]
    elif kind == 'bp':
        b = [al, 0, -al]; a = [1 + al, -2 * c, 1 - al]
    elif kind == 'notch':
        b = [1, -2 * c, 1]; a = [1 + al, -2 * c, 1 - al]
    elif kind == 'peak':
        b = [1 + al * A, -2 * c, 1 - al * A]; a = [1 + al / A, -2 * c, 1 - al / A]
    elif kind == 'highshelf':
        sq = 2 * np.sqrt(A) * al
        b = [A * ((A + 1) + (A - 1) * c + sq), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sq)]
        a = [(A + 1) - (A - 1) * c + sq, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sq]
    elif kind == 'lowshelf':
        sq = 2 * np.sqrt(A) * al
        b = [A * ((A + 1) - (A - 1) * c + sq), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sq)]
        a = [(A + 1) + (A - 1) * c + sq, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sq]
    else:
        raise ValueError(kind)
    return signal.lfilter(np.array(b) / a[0], np.array(a) / a[0], x)


def butter(x, kind, f, order=2):
    sos = signal.butter(order, f / (SR / 2), btype='low' if kind == 'lp' else 'high', output='sos')
    return signal.sosfilt(sos, x)


def bandpass(x, lo, hi, order=2):
    sos = signal.butter(order, [lo / (SR / 2), hi / (SR / 2)], btype='band', output='sos')
    return signal.sosfilt(sos, x)


def save_json(path, obj):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=1)
