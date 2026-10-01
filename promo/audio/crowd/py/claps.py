"""
audio/crowd/py/claps.py - INDIVIDUAL HAND-CLAPS (physical-ish synthesis, never a noise wash).

One clap = two-hand impact (flam: the hands do not meet at exactly the same instant)
  * 'slap'  : bright broadband transient, 2.5-6 kHz, 3-8 ms decay (palm/finger skin)
  * 'body'  : band-passed noise 0.9-3 kHz with resonances, 12-40 ms decay (flesh/bone)
  * 'cavity': decaying sinusoid 500-1500 Hz, pitch glides down a few % (the air pocket between cupped hands)
  * 'squeeze': short 1-2.5 kHz air puff after the impact
Morphologies: flat / cupped / finger / slap / soft; every person gets one 'hand' (timbre) + per-clap variations.
"""
import numpy as np
from scipy import signal

from common import SR, rng_of, biquad_filter, butter, bandpass


def _env(n, a_ms, tau_ms):
    t = np.arange(n) / SR
    att = 1 - np.exp(-t / (a_ms * 1e-3))
    return att * np.exp(-t / (tau_ms * 1e-3))


def impact(rng, n, h, scale=1.0):
    """one hand-on-hand impact for hand parameters h (dict) -> array length n."""
    t = np.arange(n) / SR
    # 1) slap / skin transient
    x = rng.randn(n)
    x = bandpass(x, h['slap_lo'], h['slap_hi'], 2)
    x = biquad_filter(x, 'peak', h['slap_f'], 2.5, 6.0)
    slap = x * _env(n, 0.25, h['slap_tau'])
    # 2) body: resonant noise
    b = rng.randn(n)
    b = bandpass(b, h['body_lo'], h['body_hi'], 2)
    b = biquad_filter(b, 'peak', h['body_f1'], 3.0, 8.0)
    b = biquad_filter(b, 'peak', h['body_f2'], 4.0, 5.0)
    body = b * _env(n, 0.8, h['body_tau'])
    # 3) cavity (cupped hands): damped sinusoid with downward glide
    fc = h['cav_f'] * (1 - 0.06 * (1 - np.exp(-t / 0.03)))
    ph = 2 * np.pi * np.cumsum(fc) / SR + rng.uniform(0, 6.28)
    cav = np.sin(ph) * _env(n, 0.6, h['cav_tau']) * (1 + 0.15 * np.sin(2 * np.pi * 37 * t))
    # 4) squeeze puff
    sq = bandpass(rng.randn(n), 1000, 2600, 2) * _env(n, 4.0, 9.0) * 0.5
    def rms(z):
        return np.sqrt(np.mean(z ** 2) + 1e-18)
    y = (h['a_slap'] * slap / rms(slap) * 0.5 + h['a_body'] * body / rms(body) * 0.7 + h['a_cav'] * cav / rms(cav) * 0.6 + h['a_sq'] * sq / rms(sq) * 0.3)
    return y * scale


def make_hand(rng, kind=None):
    """timbre of one person's hands."""
    kind = kind or rng.choice(['flat', 'cupped', 'finger', 'slap', 'soft', 'mixed'], p=[0.25, 0.2, 0.1, 0.15, 0.1, 0.2])
    base = dict(
        slap_lo=1500, slap_hi=9000, slap_f=3200, slap_tau=5.0, body_lo=700, body_hi=4200, body_f1=1500, body_f2=2600, body_tau=18.0,
        cav_f=900, cav_tau=22.0, a_slap=1.0, a_body=1.0, a_cav=0.15, a_sq=0.3,
    )
    j = lambda lo, hi: float(rng.uniform(lo, hi))
    if kind == 'flat':
        base.update(slap_f=j(2800, 4200), slap_tau=j(4, 7), body_f1=j(1300, 2000), body_f2=j(2400, 3000), body_tau=j(12, 22), cav_f=j(900, 1200), a_cav=j(0.05, 0.2))
    elif kind == 'cupped':
        base.update(slap_f=j(2200, 3000), slap_tau=j(5, 9), a_slap=j(0.35, 0.6), body_lo=500, body_hi=3000, body_f1=j(800, 1300), body_f2=j(1700, 2300), body_tau=j(22, 38), cav_f=j(520, 950), cav_tau=j(28, 48), a_cav=j(0.8, 1.4))
    elif kind == 'finger':
        base.update(slap_lo=2400, slap_hi=11000, slap_f=j(4200, 6000), slap_tau=j(2.5, 4.5), a_slap=1.2, body_lo=1500, body_hi=5000, body_f1=j(2200, 3200), body_f2=j(3400, 4200), body_tau=j(6, 12), cav_f=j(1200, 1600), a_cav=0.05, a_body=0.6)
    elif kind == 'slap':
        base.update(slap_f=j(2600, 3600), slap_tau=j(7, 11), a_slap=1.4, body_f1=j(1200, 1800), body_f2=j(2200, 2900), body_tau=j(15, 25), a_cav=j(0.1, 0.4), cav_f=j(800, 1100))
    elif kind == 'soft':
        base.update(slap_hi=5000, slap_f=j(2000, 2800), slap_tau=j(4, 6), a_slap=0.35, body_lo=500, body_hi=2800, body_f1=j(1000, 1500), body_f2=j(1800, 2400), body_tau=j(18, 30), a_cav=j(0.3, 0.7), cav_f=j(600, 900))
    else:  # mixed
        base.update(slap_f=j(2400, 4000), slap_tau=j(4, 9), a_slap=j(0.6, 1.2), body_f1=j(1000, 1900), body_f2=j(2000, 3000), body_tau=j(14, 30), cav_f=j(600, 1300), cav_tau=j(18, 36), a_cav=j(0.2, 0.9))
    base['kind'] = kind
    return base


def clap(h, rng, n_ms=170):
    """one clap of hand h: flam of two impacts, small per-clap random variation."""
    n = int(n_ms * 1e-3 * SR)
    # per-clap variation of the hand parameters (no two claps alike)
    v = dict(h)
    for k in ('slap_f', 'body_f1', 'body_f2', 'cav_f'):
        v[k] = h[k] * float(np.exp(0.07 * rng.randn()))
    for k in ('slap_tau', 'body_tau', 'cav_tau'):
        v[k] = h[k] * float(np.exp(0.12 * rng.randn()))
    for k in ('a_slap', 'a_body', 'a_cav'):
        v[k] = h[k] * float(np.exp(0.18 * rng.randn()))
    y = impact(rng, n, v)
    # second hand: flam delay 0.4-6 ms, 35-85% as strong, different noise & slightly different resonances
    d = int(rng.choice([rng.uniform(0.3, 1.5), rng.uniform(1.5, 6.0)], p=[0.5, 0.5]) * 1e-3 * SR)
    v2 = dict(v)
    for k in ('slap_f', 'body_f1', 'body_f2'):
        v2[k] = v[k] * float(np.exp(0.10 * rng.randn()))
    y2 = impact(rng, n, v2, scale=float(rng.uniform(0.35, 0.85)))
    out = y.copy()
    out[d:] += y2[: n - d]
    # remove DC / sub, soft limit -> unit peak
    out = butter(out, 'hp', 220, 2)
    out = np.tanh(out / (np.abs(out).max() + 1e-9) * 1.4) / np.tanh(1.4)
    fade = int(0.012 * SR)
    out[-fade:] *= np.cos(np.linspace(0, np.pi / 2, fade)) ** 2
    out /= np.abs(out).max() + 1e-9
    return out
