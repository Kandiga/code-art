#!/usr/bin/env python3
"""audio/crowd/tools/spec.py - spectrogram PNG (own STFT, linear or log frequency axis, labelled).
   spec.py in.wav out.png [--t0 0] [--dur 0] [--fmax 8000] [--fmin 0] [--log] [--w 1600] [--h 560] [--win 1024] [--hop 0] [--range 80]
Several wavs: spec.py a.wav b.wav ... --out out.png  (stacked)."""
import argparse, sys, os
import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFont
from scipy import signal

CM = np.array([[0, 0, 4], [31, 12, 72], [85, 15, 109], [136, 34, 106], [186, 54, 85], [227, 89, 51], [249, 140, 10], [249, 201, 50], [252, 255, 164]], float)


def cmap(u):
    u = np.clip(u, 0, 1) * (len(CM) - 1)
    i = np.minimum(u.astype(int), len(CM) - 2)
    f = (u - i)[..., None]
    return (CM[i] * (1 - f) + CM[i + 1] * f).astype(np.uint8)


def render(x, sr, t0=0.0, dur=0.0, fmax=8000.0, fmin=0.0, log=False, w=1600, h=560, win=1024, hop=0, rng=80.0, title=''):
    if x.ndim > 1:
        x = x.mean(axis=1)
    a = int(t0 * sr)
    b = len(x) if dur <= 0 else min(len(x), int((t0 + dur) * sr))
    x = x[a:b].astype(np.float64)
    dur = len(x) / sr
    hop = hop or max(1, int(len(x) / w))
    hop = max(16, hop)
    f, t, S = signal.stft(x, sr, window='hann', nperseg=win, noverlap=win - hop, boundary=None, padded=False)
    P = 20 * np.log10(np.abs(S) + 1e-9)
    ref = P.max()
    P = np.clip((P - (ref - rng)) / rng, 0, 1)
    fmax = min(fmax, sr / 2)
    ys = np.linspace(fmax, max(fmin, 20.0 if log else 0.0), h)
    if log:
        ys = np.exp(np.linspace(np.log(fmax), np.log(max(fmin, 40.0)), h))
    img = np.zeros((h, w), float)
    ti = np.clip(np.round(np.linspace(0, P.shape[1] - 1, w)).astype(int), 0, P.shape[1] - 1)
    fi = np.clip(np.round(ys / (sr / win)).astype(int), 0, P.shape[0] - 1)
    img = P[fi][:, ti]
    rgb = cmap(img)
    L, B, T = 64, 26, 22
    canvas = Image.new('RGB', (w + L + 8, h + B + T), (0, 0, 0))
    canvas.paste(Image.fromarray(rgb), (L, T))
    d = ImageDraw.Draw(canvas)
    fnt = ImageFont.load_default()
    d.text((4, 4), f'{title}  ref {ref:.0f} dB  range {rng:.0f} dB  hop {hop / sr * 1000:.1f} ms', fill=(255, 255, 255), font=fnt)
    # time ticks
    step = 0.1
    for s in (0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10):
        if dur / s <= 14:
            step = s
            break
    tt = 0.0
    while tt <= dur + 1e-9:
        xx = L + int(tt / dur * (w - 1))
        d.line([(xx, T + h), (xx, T + h + 4)], fill=(255, 255, 255))
        d.text((xx - 12, T + h + 8), f'{t0 + tt:.2f}', fill=(255, 255, 255), font=fnt)
        tt += step
    ticks = [100, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 16000, 20000] if log else list(range(0, int(fmax) + 1, 500 if fmax <= 6000 else 1000))
    for fr in ticks:
        if fr < ys.min() or fr > fmax:
            continue
        yy = T + int(np.argmin(np.abs(ys - fr)))
        d.line([(L - 4, yy), (L, yy)], fill=(255, 255, 255))
        d.line([(L, yy), (L + w, yy)], fill=(70, 70, 70))
        d.text((6, yy - 5), f'{fr}', fill=(255, 255, 255), font=fnt)
    return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('inputs', nargs='+')
    ap.add_argument('--out')
    ap.add_argument('--t0', type=float, default=0)
    ap.add_argument('--dur', type=float, default=0)
    ap.add_argument('--fmax', type=float, default=8000)
    ap.add_argument('--fmin', type=float, default=0)
    ap.add_argument('--log', action='store_true')
    ap.add_argument('--w', type=int, default=1600)
    ap.add_argument('--h', type=int, default=500)
    ap.add_argument('--win', type=int, default=1024)
    ap.add_argument('--hop', type=int, default=0)
    ap.add_argument('--range', type=float, default=80)
    a = ap.parse_args()
    ins = a.inputs
    out = a.out
    if out is None:
        out = ins.pop()
    imgs = []
    for p in ins:
        x, sr = sf.read(p, dtype='float32')
        imgs.append(render(x, sr, a.t0, a.dur, a.fmax, a.fmin, a.log, a.w, a.h, a.win, a.hop, a.range, os.path.basename(p)))
    H = sum(i.height for i in imgs)
    c = Image.new('RGB', (imgs[0].width, H))
    y = 0
    for i in imgs:
        c.paste(i, (0, y))
        y += i.height
    c.save(out)
    print(out, c.size)


if __name__ == '__main__':
    main()
