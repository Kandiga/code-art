"""
audio/crowd/py/vocal.py - SOURCE-FILTER VOCAL SYNTH for the sounds TTS cannot do:
gasps, laughs, whoops/cheers, 'aww'/sighs, 'ooh', roars and whistles.

  glottal flow (Rosenberg/LF-style pulse, jitter, shimmer, vibrato, breath) -> formant resonators (Klatt, time-varying F1-F5)
  + aspiration noise through the same (parallel) vocal tract for the breathy / ingressive parts.

Everything is seeded (numpy RandomState from common.rng_of) -> bit-exact on the same numpy build.
Vocal-tract size is a parameter (`vt`: male 1.0 / female ~1.17 / child ~1.42 = formant scale), as is f0.
"""
import numpy as np
from scipy import signal

from common import SR, curve, smooth_noise, rng_of, biquad_filter, butter, bandpass

# formants (Hz) of an adult male, Peterson-Barney style averages
VOWELS = {
    'a': (730, 1090, 2440), 'ae': (660, 1720, 2410), 'e': (530, 1840, 2480), 'i': (270, 2290, 3010),
    'I': (390, 1990, 2550), 'o': (570, 840, 2410), 'O': (450, 880, 2400), 'u': (300, 870, 2240),
    'U': (440, 1020, 2240), 'A': (640, 1190, 2390), 'x': (500, 1500, 2500), 'w': (290, 700, 2200),
    'j': (260, 2200, 3000), 'h_a': (780, 1250, 2500),
}
BW = (75.0, 90.0, 130.0, 200.0, 260.0)


def make_person(rng, sex):
    """vocal-tract identity for the synth voices."""
    if sex == 'm':
        vt, f0 = rng.uniform(0.93, 1.07), rng.uniform(98, 150)
    elif sex == 'f':
        vt, f0 = rng.uniform(1.11, 1.25), rng.uniform(182, 250)
    else:  # child / teen
        vt, f0 = rng.uniform(1.30, 1.50), rng.uniform(260, 390)
    tweak = np.clip(1 + 0.045 * rng.randn(5), 0.9, 1.1)
    return dict(sex=sex, vt=float(vt), f0=float(f0), tweak=tweak, breath=float(rng.uniform(0.6, 1.4)), rough=float(rng.uniform(0.5, 1.5)))


def formants(person, v):
    F = np.array(VOWELS[v] if isinstance(v, str) else v, float)
    vt, tw = person['vt'], person['tweak']
    f = list(F * vt * tw[:3])
    f += [3300 * vt * tw[3] ** 1.0, 3750 * vt * tw[4]]
    return np.array(f)


def form_tracks(person, n, keys, smooth_ms=18.0):
    """keys = [(t_sec, vowel | (F1,F2,F3)), ...] -> (5, n) formant tracks (Hz), eased between keys."""
    pts = [(t, formants(person, v)) for t, v in keys]
    out = np.zeros((5, n))
    for k in range(5):
        out[k] = curve(n, [(t, f[k]) for t, f in pts], log=True, smooth_ms=smooth_ms)
    return out


def _res_coefs(F, B, mode):
    th = 2 * np.pi * F / SR
    r = np.exp(-np.pi * B / SR)
    a1 = -2 * r * np.cos(th)
    a2 = r * r
    if mode == 'cascade':  # unity DC gain (Klatt)
        g = 1 + a1 + a2
    else:  # parallel/band-pass: ~unity gain at the resonance
        g = (1 - r) * np.sqrt(1 - 2 * r * np.cos(2 * th) + r * r)
    return g, a1, a2


def resonate(x, F, B, mode='cascade', block=32):
    """time-varying 2-pole resonator, coefficients updated every `block` samples (state carried)."""
    n = len(x)
    y = np.empty(n)
    zi = np.zeros(2)
    for s in range(0, n, block):
        e = min(n, s + block)
        m = (s + e) // 2
        g, a1, a2 = _res_coefs(F[m], B[m], mode)
        y[s:e], zi = signal.lfilter([g], [1.0, a1, a2], x[s:e], zi=zi)
    return y


def vocal_tract(x, Ft, bw_scale=1.0, mode='cascade', amps=None, nform=5):
    n = len(x)
    if mode == 'cascade':
        y = x
        for k in range(nform):
            B = np.full(n, BW[k] * bw_scale)
            y = resonate(y, Ft[k], B, 'cascade')
        return y
    y = np.zeros(n)
    amps = amps or (1.0, 1.0, 0.8, 0.6, 0.4)
    for k in range(nform):
        B = np.full(n, BW[k] * bw_scale)
        y += amps[k] * resonate(x, Ft[k], B, 'parallel')
    return y


def glottal_source(f0, oq, skew, rng, jitter=0.008, shimmer=0.05, vib_hz=0.0, vib_cents=0.0, tilt_hz=5000.0, breath=0.06):
    """glottal-flow-derivative with jitter / shimmer / vibrato; returns (voiced_source, aspiration_noise, flow)."""
    n = len(f0)
    t = np.arange(n) / SR
    f = f0 * (1 + jitter * smooth_noise(n, rng, 90.0) + 0.5 * jitter * rng.randn(n) * 0.2)
    if vib_hz > 0:
        f = f * 2 ** (vib_cents / 1200.0 * np.sin(2 * np.pi * vib_hz * t + rng.uniform(0, 6.28)) * (1 + 0.15 * smooth_noise(n, rng, 2.0)))
    ph = np.cumsum(f) / SR
    p = ph - np.floor(ph)
    oq = np.broadcast_to(oq, (n,)).astype(float)
    Tp = oq * skew / (1 + skew)
    Tn = np.maximum(oq - Tp, 0.05)
    U = np.zeros(n)
    m1 = p < Tp
    U[m1] = 0.5 * (1 - np.cos(np.pi * p[m1] / Tp[m1]))
    m2 = (p >= Tp) & (p < Tp + Tn)
    U[m2] = np.cos(0.5 * np.pi * (p[m2] - Tp[m2]) / Tn[m2])
    d = np.diff(U, prepend=U[0]) * (SR / f)
    d *= 1 + shimmer * smooth_noise(n, rng, 55.0)
    d = d / 6.0
    if tilt_hz < 0.45 * SR:
        d = signal.lfilter([1 - np.exp(-2 * np.pi * tilt_hz / SR)], [1, -np.exp(-2 * np.pi * tilt_hz / SR)], d)
    asp = rng.randn(n) * breath * (1.0 - 0.55 * U)
    return d, asp, U


def env_ad(n, pts):
    """amplitude envelope from (t, linear) keys, smoothed ~4 ms."""
    return curve(n, pts, smooth_ms=4.0)


def _post(y, hp=70.0):
    y = butter(y, 'hp', hp, 2)
    return y


# --------------------------------------------------------------------------------------------------------------------
# GASP  (sharp inhale: aspirated, formant-shaped, rising voiced squeak optionally)
# --------------------------------------------------------------------------------------------------------------------
def gasp(person, rng, style=None):
    sex = person['sex']
    style = style or rng.choice(['breath', 'ah', 'oh', 'squeak'], p=[0.08, 0.32, 0.30, 0.30])
    dur = rng.uniform(0.22, 0.42) * (0.9 if sex == 'k' else 1.0)
    n = int((dur + 0.08) * SR)
    vowel_a, vowel_b = {'breath': ('x', 'a'), 'ah': ('A', 'a'), 'oh': ('o', 'O'), 'squeak': ('I', 'ae')}[style]
    keys = [(0, vowel_a), (dur * 0.5, vowel_b), (dur, vowel_b)]
    Ft = form_tracks(person, n, keys)
    # inhale: turbulent airflow through the (ingressive) vocal tract: formant-shaped, tilted (-9 dB/oct above ~2.5 kHz)
    noise = butter(rng.randn(n), 'hp', 320, 2)
    y_n = vocal_tract(noise, Ft, bw_scale=1.5, mode='parallel', amps=(0.9, 1.0, 0.65, 0.3, 0.12))
    y_n = butter(y_n, 'lp', 4200 if style == 'breath' else 3500, 3)
    a_att = rng.uniform(0.012, 0.028)
    a_pk = dur * rng.uniform(0.35, 0.6)
    env_n = env_ad(n, [(0, 0), (a_att, 0.5), (a_pk, 1.0), (dur * 0.88, 0.7), (dur, 0.12), (dur + 0.012, 0.0)])
    env_n *= 1 + 0.12 * smooth_noise(n, rng, 40)
    y = y_n * env_n
    v_mix = {'breath': 0.7, 'ah': 2.0, 'oh': 2.0, 'squeak': 2.6}[style]
    f0a = person['f0'] * (1.6 if style == 'squeak' else 1.25)
    f0 = curve(n, [(0, f0a * 0.88), (dur * 0.7, f0a * (1.6 if style == 'squeak' else 1.4)), (dur, f0a * 1.5)], log=True, smooth_ms=10)
    src, asp, U = glottal_source(f0, 0.52, 1.7, rng, jitter=0.02, shimmer=0.1, tilt_hz=10000, breath=0.05)
    v = vocal_tract(src + asp * 0.4, Ft, bw_scale=1.1, mode='cascade')
    v = butter(v, 'hp', 260, 2)
    v = biquad_filter(v, 'highshelf', 1600.0, 0.7, 6.0)  # strained / pressed ingressive phonation: strong upper harmonics
    env_v = env_ad(n, [(0, 0), (a_att + 0.01, 0.55), (a_pk + 0.02, 1.0), (dur * 0.85, 0.8), (dur, 0.1), (dur + 0.01, 0)])
    sc = np.sqrt(np.mean(y ** 2) + 1e-12) / (np.sqrt(np.mean((v * env_v) ** 2)) + 1e-12)
    y = y * (0.13 if style != 'breath' else 0.8) + v * env_v * sc * v_mix
    return _post(y, 150)


# --------------------------------------------------------------------------------------------------------------------
# LAUGH  (series of breathy 'ha' syllables with decaying pitch/amplitude and irregular timing)
# --------------------------------------------------------------------------------------------------------------------
def laugh(person, rng, style=None):
    sex = person['sex']
    style = style or rng.choice(['ha', 'ha', 'heh', 'hee', 'ahaha'], p=[0.3, 0.2, 0.2, 0.15, 0.15])
    cfg = {
        'ha': dict(nsyl=(4, 8), gap=(0.13, 0.19), v=('a', 'A'), oq=0.72, br=0.07, up=1.28, fall=0.955, dec=(0.82, 0.9)),
        'heh': dict(nsyl=(2, 5), gap=(0.14, 0.22), v=('e', 'x'), oq=0.68, br=0.06, up=1.12, fall=0.965, dec=(0.78, 0.88)),
        'hee': dict(nsyl=(4, 9), gap=(0.10, 0.14), v=('I', 'e'), oq=0.78, br=0.07, up=1.42, fall=0.965, dec=(0.86, 0.93)),
        'ahaha': dict(nsyl=(5, 9), gap=(0.12, 0.17), v=('a', 'a'), oq=0.7, br=0.09, up=1.38, fall=0.94, dec=(0.84, 0.91)),
    }[style]
    ns = int(rng.randint(cfg['nsyl'][0], cfg['nsyl'][1] + 1))
    f0pk = person['f0'] * cfg['up'] * rng.uniform(0.95, 1.15)
    t = 0.0
    out = np.zeros(int((ns * 0.28 + 0.6) * SR))
    dec = rng.uniform(*cfg['dec'])
    amps = []
    starts = []
    for k in range(ns):
        dur = rng.uniform(0.08, 0.15) * (1.0 - 0.02 * k)
        n = int((dur + 0.08) * SR)
        f0s = f0pk * cfg['fall'] ** k * (1 + 0.08 * rng.randn())
        intra = rng.uniform(0.86, 1.0)  # how far this 'ha' falls in pitch
        f0 = curve(n, [(0, f0s * (1.0 + 0.1 * rng.rand())), (dur * 0.35, f0s * 1.0), (dur + 0.05, f0s * intra)], log=True, smooth_ms=6)
        keys = [(0, cfg['v'][0]), (dur * 0.5, cfg['v'][1]), (dur + 0.08, cfg['v'][1])]
        Ft = form_tracks(person, n, keys)
        Ft[0] *= curve(n, [(0, 0.82), (0.025, 1.0), (dur + 0.08, 0.95)], smooth_ms=8)
        src, asp, U = glottal_source(f0, cfg['oq'] - 0.06, 1.7, rng, jitter=0.014, shimmer=0.09, tilt_hz=5000 + 900 * rng.rand(), breath=cfg['br'] * person['breath'])
        voiced = vocal_tract(src + asp, Ft, bw_scale=1.2, mode='cascade')
        h_noise = vocal_tract(rng.randn(n), Ft, bw_scale=2.0, mode='parallel', amps=(0.9, 1.0, 0.7, 0.35, 0.15))
        h_noise = butter(h_noise, 'lp', 4200, 2)
        att = 0.010
        hold = rng.uniform(0.012, 0.035)
        env_v = env_ad(n, [(0, 0), (0.016, 0), (0.028, 1.0), (0.028 + hold, 0.85), (dur, 0.18), (dur + 0.05, 0)])
        env_h = env_ad(n, [(0, 0), (att, 0.9), (0.03, 0.55), (dur * 0.9, 0.25), (dur + 0.07, 0)])
        sc = np.sqrt(np.mean(voiced ** 2) + 1e-12)
        sh = np.sqrt(np.mean(h_noise ** 2) + 1e-12)
        y = voiced / sc * env_v + h_noise / sh * env_h * (0.07 + 0.04 * person['breath'])
        amp = (dec ** k) * (1.0 if k else 1.25) * rng.uniform(0.8, 1.2)
        amps.append(amp)
        starts.append(t)
        a = int(t * SR)
        if a + n > len(out):
            out = np.pad(out, (0, a + n - len(out)))
        out[a:a + n] += y * amp
        gap = rng.uniform(*cfg['gap']) * (1 + 0.06 * k) * (1 + 0.18 * np.clip(rng.randn(), -1.5, 1.5))
        if rng.rand() < 0.12:  # a quick doublet
            gap *= 0.7
        t += max(0.075, gap)
    # exhalation riding under the whole laugh: breath noise swelling between the voiced bursts (the 'h' of 'ha ha ha')
    nb = len(out)
    swell = np.zeros(nb)
    for a_, am in zip(starts, amps):
        i0 = int(a_ * SR)
        j = np.arange(min(nb - i0, int(0.2 * SR)))
        swell[i0:i0 + len(j)] = np.maximum(swell[i0:i0 + len(j)], am * np.exp(-j / (0.07 * SR)))
    swell = np.convolve(swell, np.hanning(int(0.03 * SR)) / np.hanning(int(0.03 * SR)).sum(), mode='same')
    Fb = form_tracks(person, nb, [(0, cfg['v'][0]), (nb / SR, cfg['v'][1])])
    breath = vocal_tract(butter(rng.randn(nb), 'hp', 350, 2), Fb, 2.2, 'parallel', amps=(0.9, 1.0, 0.6, 0.25, 0.1))
    breath = butter(breath, 'lp', 4000, 2)
    breath *= swell / (np.sqrt(np.mean(breath ** 2)) + 1e-9)
    out = out + breath * 0.5 * np.sqrt(np.mean(out ** 2) + 1e-12) * 0.35
    # trailing exhale 'hhh' / inhale
    if rng.rand() < 0.55:
        nT = int(0.22 * SR)
        Ft = form_tracks(person, nT, [(0, 'a'), (0.2, 'x')])
        z = vocal_tract(butter(rng.randn(nT), 'hp', 380, 2), Ft, 2.2, 'parallel') * env_ad(nT, [(0, 0), (0.03, 0.4), (0.12, 0.3), (0.22, 0)])
        z *= 0.22 * np.sqrt(np.mean(out ** 2) + 1e-12) / (np.sqrt(np.mean(z ** 2)) + 1e-12)
        a = int((t + 0.02) * SR)
        if a + nT > len(out):
            out = np.pad(out, (0, a + nT - len(out)))
        out[a:a + nT] += z
    return _post(out, 90)


# --------------------------------------------------------------------------------------------------------------------
# WHOOP / CHEER ('woo!', 'whoo-hoo!', 'yeah!', 'ahh!' roar)
# --------------------------------------------------------------------------------------------------------------------
def whoop(person, rng, style=None):
    sex = person['sex']
    style = style or rng.choice(['woo', 'woo', 'whoohoo', 'yeah', 'roar'], p=[0.35, 0.2, 0.15, 0.15, 0.15])
    f0b = person['f0'] * rng.uniform(1.15, 1.45)  # excited register
    parts = []
    if style in ('woo', 'whoohoo'):
        reps = 1 if style == 'woo' else 2
        for r in range(reps):
            dur = rng.uniform(0.45, 0.85) if reps == 1 else rng.uniform(0.28, 0.42)
            n = int((dur + 0.12) * SR)
            top = rng.uniform(1.55, 2.15) if reps == 1 else rng.uniform(1.25, 1.5)
            if r == 1:
                top *= 1.12
            f0 = curve(n, [(0, f0b * 0.95), (dur * 0.12, f0b), (dur * 0.62, f0b * top), (dur * 0.85, f0b * top * 0.95), (dur + 0.12, f0b * top * 0.8)], log=True, smooth_ms=25)
            keys = [(0, 'w'), (dur * 0.18, 'U'), (dur * 0.5, 'u'), (dur * 0.8, 'O'), (dur + 0.12, 'O')]
            Ft = form_tracks(person, n, keys, smooth_ms=30)
            src, asp, U = glottal_source(f0, 0.52, 2.0, rng, jitter=0.012, shimmer=0.06, vib_hz=rng.uniform(5.3, 6.6), vib_cents=rng.uniform(15, 45), tilt_hz=7500, breath=0.04 * person['breath'])
            y = vocal_tract(src + asp, Ft, bw_scale=1.0, mode='cascade')
            y = np.tanh(y / (np.sqrt(np.mean(y ** 2)) + 1e-9) * 1.1) * 1.0  # shouted push
            env = env_ad(n, [(0, 0), (0.025, 0.7), (0.07, 1.0), (dur * 0.8, 0.95), (dur, 0.45), (dur + 0.12, 0)])
            if style == 'whoohoo' and r == 0:
                env = env_ad(n, [(0, 0), (0.025, 0.7), (0.06, 1.0), (dur * 0.7, 0.9), (dur, 0.0)])
            parts.append((y * env, 0.0 if r == 0 else dur * 0.95 + 0.02))
    elif style == 'yeah':
        dur = rng.uniform(0.38, 0.6)
        n = int((dur + 0.15) * SR)
        f0 = curve(n, [(0, f0b * 1.25), (dur * 0.2, f0b * 1.4), (dur, f0b * 0.95), (dur + 0.15, f0b * 0.85)], log=True, smooth_ms=25)
        keys = [(0, 'j'), (dur * 0.2, 'e'), (dur * 0.5, 'ae'), (dur + 0.15, 'x')]
        Ft = form_tracks(person, n, keys, smooth_ms=30)
        src, asp, U = glottal_source(f0, 0.5, 2.0, rng, jitter=0.015, shimmer=0.07, tilt_hz=7000, breath=0.04)
        y = vocal_tract(src + asp, Ft, bw_scale=1.0)
        y = np.tanh(y / (np.sqrt(np.mean(y ** 2)) + 1e-9) * 1.1)
        env = env_ad(n, [(0, 0), (0.02, 0.8), (0.06, 1.0), (dur * 0.75, 0.9), (dur, 0.35), (dur + 0.15, 0)])
        parts.append((y * env, 0.0))
    else:  # roar 'aaah'
        dur = rng.uniform(0.7, 1.2)
        n = int((dur + 0.2) * SR)
        f0 = curve(n, [(0, f0b), (dur * 0.3, f0b * 1.25), (dur * 0.7, f0b * 1.15), (dur + 0.2, f0b * 0.8)], log=True, smooth_ms=40)
        Ft = form_tracks(person, n, [(0, 'A'), (dur * 0.4, 'a'), (dur + 0.2, 'o')], smooth_ms=60)
        src, asp, U = glottal_source(f0, 0.45, 2.0, rng, jitter=0.03, shimmer=0.12, vib_hz=5.5, vib_cents=20, tilt_hz=8500, breath=0.06)
        # rough: subharmonic-ish AM
        t = np.arange(n) / SR
        src = src * (1 + 0.35 * person['rough'] * np.sin(2 * np.pi * f0 * 0.5 * t * 0 + 2 * np.pi * np.cumsum(f0) / SR * 0.5) * 0.5)
        y = vocal_tract(src + asp, Ft, bw_scale=1.1)
        y = np.tanh(y / (np.sqrt(np.mean(y ** 2)) + 1e-9) * 1.4)
        env = env_ad(n, [(0, 0), (0.04, 0.9), (0.1, 1.0), (dur * 0.7, 0.9), (dur, 0.3), (dur + 0.2, 0)])
        parts.append((y * env, 0.0))
    total = max(int((s + len(y) / SR) * SR) for y, s in parts) + 10
    out = np.zeros(total)
    for y, s in parts:
        a = int(s * SR)
        out[a:a + len(y)] += y
    return _post(out, 110)


# --------------------------------------------------------------------------------------------------------------------
# AWW / OOH / SIGH
# --------------------------------------------------------------------------------------------------------------------
def aww(person, rng, style=None):
    style = style or rng.choice(['aww', 'ooh', 'sigh'], p=[0.45, 0.35, 0.2])
    f0b = person['f0'] * rng.uniform(1.0, 1.25)
    if style == 'aww':
        dur = rng.uniform(0.7, 1.15)
        pts = [(0, f0b * 1.2), (dur * 0.25, f0b * 1.3), (dur * 0.7, f0b * 1.0), (dur + 0.2, f0b * 0.8)]
        keys = [(0, 'A'), (dur * 0.2, 'o'), (dur + 0.2, 'o')]
        oq, br = 0.7, 0.12
    elif style == 'ooh':
        dur = rng.uniform(0.6, 1.0)
        pts = [(0, f0b * 0.95), (dur * 0.4, f0b * 1.3), (dur * 0.8, f0b * 1.1), (dur + 0.2, f0b * 0.9)]
        keys = [(0, 'U'), (dur * 0.3, 'u'), (dur * 0.7, 'O'), (dur + 0.2, 'O')]
        oq, br = 0.65, 0.08
    else:
        dur = rng.uniform(0.5, 0.9)
        pts = [(0, f0b * 1.05), (dur, f0b * 0.8), (dur + 0.2, f0b * 0.75)]
        keys = [(0, 'a'), (dur + 0.2, 'x')]
        oq, br = 0.85, 0.35
    n = int((dur + 0.2) * SR)
    f0 = curve(n, pts, log=True, smooth_ms=40)
    Ft = form_tracks(person, n, keys, smooth_ms=60)
    src, asp, U = glottal_source(f0, oq, 1.8, rng, jitter=0.012, shimmer=0.07, vib_hz=rng.uniform(4.8, 6.0), vib_cents=rng.uniform(10, 30), tilt_hz=4800, breath=br * person['breath'])
    y = vocal_tract(src + asp, Ft, bw_scale=1.25)
    env = env_ad(n, [(0, 0), (0.08, 0.85), (0.16, 1.0), (dur * 0.7, 0.8), (dur, 0.3), (dur + 0.2, 0)])
    return _post(y * env, 90)


# --------------------------------------------------------------------------------------------------------------------
# WHISTLE (lips / finger): near-pure tone with glides, vibrato, breathy edge
# --------------------------------------------------------------------------------------------------------------------
def whistle(rng, style=None):
    style = style or rng.choice(['rise', 'fweet', 'two', 'fall'])
    f_lo = rng.uniform(1400, 2000)
    if style == 'rise':
        dur = rng.uniform(0.5, 0.9)
        pts = [(0, f_lo), (dur * 0.65, f_lo * rng.uniform(1.6, 2.0)), (dur, f_lo * rng.uniform(1.7, 2.1))]
    elif style == 'fweet':
        dur = rng.uniform(0.18, 0.3)
        pts = [(0, f_lo * 1.2), (dur * 0.5, f_lo * 1.9), (dur, f_lo * 1.7)]
    elif style == 'two':
        dur = rng.uniform(0.5, 0.8)
        pts = [(0, f_lo * 1.3), (dur * 0.38, f_lo * 1.32), (dur * 0.42, f_lo * 1.05), (dur, f_lo * 1.07)]
    else:
        dur = rng.uniform(0.5, 0.9)
        pts = [(0, f_lo * 1.9), (dur * 0.3, f_lo * 2.0), (dur, f_lo * 1.1)]
    n = int((dur + 0.06) * SR)
    f = curve(n, pts, log=True, smooth_ms=30)
    t = np.arange(n) / SR
    vib = 1 + 0.012 * np.sin(2 * np.pi * rng.uniform(5.5, 7.5) * t) * np.minimum(1, t / 0.2)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    y = np.sin(ph) + 0.05 * np.sin(2 * ph) + 0.015 * np.sin(3 * ph)
    br = bandpass(rng.randn(n), 1200, 6500, 2) * (0.1 + 0.05 * rng.rand())
    # breath noise follows pitch band: use narrow band via modulation of tone
    y = y + br * (0.4 + 0.6 * np.abs(np.sin(ph * 0.5)))
    env = env_ad(n, [(0, 0), (0.03, 0.9), (0.06, 1.0), (dur * 0.8, 0.9), (dur, 0.3), (dur + 0.06, 0)])
    return y * env
