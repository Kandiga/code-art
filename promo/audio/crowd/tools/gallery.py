#!/usr/bin/env python3
"""audio/crowd/tools/gallery.py - spectrogram gallery for NOTES.md -> audio/crowd/img/*.png
   (run after render.mjs + tools/solo.mjs).  Linear frequency, 70-80 dB range: look for harmonic ladders and formant bands (voices)
   and for sharp vertical transients (hand-claps)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'py'))
import numpy as np
import soundfile as sf
from PIL import Image
import spec
from common import LIB, CROWD, SR

IMG = os.path.join(CROWD, 'img')
os.makedirs(IMG, exist_ok=True)
BUILD = os.path.join(os.path.dirname(CROWD), 'build')
TMP = os.path.join(BUILD, 'tmp', 'crowd')
man = json.load(open(os.path.join(LIB, 'manifest.json')))
rep = json.load(open(os.path.join(BUILD, 'crowd_report.json')))


def clips(group, tag, ids=None, n=6, pick=None):
    cs = [c for c in man['clips'] if c['group'] == group and c['tag'] == tag and (pick is None or pick(c))]
    return cs[:n] if ids is None else [c for c in cs if c['id'] in ids]


def cat(cs, gap=0.12):
    segs = []
    for c in cs:
        y, sr = sf.read(os.path.join(LIB, c['file']), dtype='float32')
        segs.append(np.pad(y / (np.abs(y).max() + 1e-9) * 0.5, (0, int(gap * SR))))
    return np.concatenate(segs)


def save(name, y, **kw):
    img = spec.render(y, SR, **kw)
    img.save(os.path.join(IMG, name))
    print(name, img.size)


# --- library: individual people -------------------------------------------------------------------------------------------------
def spread(cs, n):  # evenly over the list (different people)
    step = max(1, len(cs) // n)
    return cs[::step][:n]


save('lib_whoa.png', cat(spread(clips('words', 'whoa', n=999, pick=lambda c: 'whoa' in (c.get('asr') or '').lower()), 6)), fmax=6000, h=300, w=1500, win=1024, hop=90, rng=70, title='"whoa" - 6 different people (Piper + Praat)')
save('lib_noway.png', cat(spread(clips('words', 'no_way', n=999, pick=lambda c: 'no way' in (c.get('asr') or '').lower()), 4)), fmax=6000, h=300, w=1500, win=1024, hop=110, rng=70, title='"no way" - 4 different people')
save('lib_gasp.png', cat(spread(clips('synth', 'gasp', n=999), 6)), fmax=6000, h=300, w=1500, win=1024, hop=80, rng=70, title='gasps - source-filter synth, 6 different vocal tracts')
save('lib_laugh.png', cat(spread(clips('synth', 'laugh', n=999), 4), 0.25), fmax=6000, h=300, w=1500, win=1024, hop=150, rng=70, title='laughs - voiced "ha" bursts, decaying pitch/amplitude')
save('lib_whoop.png', cat(spread(clips('synth', 'whoop', n=999), 6)), fmax=6000, h=300, w=1500, win=1024, hop=150, rng=70, title='whoops / cheers - rising pitch, vibrato, vowel glide')
save('lib_aww.png', cat(spread(clips('synth', 'aww', n=999), 4)), fmax=6000, h=300, w=1500, win=1024, hop=150, rng=70, title='aww / ooh / sigh')
save('lib_whistle.png', cat(spread(clips('whistles', 'whistle', n=999), 4)), fmax=6000, h=300, w=1500, win=1024, hop=100, rng=70, title='whistles')
save('lib_walla.png', cat(spread(clips('walla', 'walla', n=999), 5), 0.1), fmax=6000, h=300, w=1500, win=1024, hop=200, rng=70, title='walla fragments (band-limited chatter, before layering)')

# claps: one per hand type, 12 different hands
allc = sf.read(os.path.join(LIB, 'claps.wav'), dtype='float32')[0]
cl = man['claps']
seen, pick = set(), []
for c in cl:
    if c['hand'] not in seen and c['morph'] not in [x['morph'] for x in pick] + ['']:
        pick.append(c)
    seen.add(c['hand'])
for c in cl:
    if len(pick) >= 12:
        break
    if c not in pick and c['hand'] % 4 == 0 and c['id'].endswith('_0'):
        pick.append(c)
y = np.concatenate([np.pad(allc[c['start']:c['start'] + c['len']] * 0.6, (0, int(0.05 * SR))) for c in pick[:12]])
save('lib_claps.png', y, fmax=12000, h=300, w=1500, win=512, hop=30, rng=75, title='individual hand-claps: ' + ' '.join(c['morph'] for c in pick[:12]))

# --- events (solo renders; dry bus shows the people, hall shows the room) -------------------------------------------------------
def evfile(i, dry):
    for f in os.listdir(TMP):
        if f.startswith(f'ev_{i:02d}_') and f.endswith('_dry.wav') == dry:
            return os.path.join(TMP, f)


def evshot(name, i, dt0, dur, dry=True, **kw):
    e = [e for e in rep['events'] if e['index'] == i][0]
    y, sr = sf.read(evfile(i, dry), dtype='float32')
    t0 = e['t'] + dt0
    seg = y.mean(axis=1) if y.ndim > 1 else y
    save(name, seg[int(t0 * sr):int((t0 + dur) * sr)], title=f"event {i} {e['kind']} n={e.get('n')} @ {e['t']} s ({'dry' if dry else 'hall'}) t0={t0:.2f}", **kw)


kinds = {e['index']: e for e in rep['events']}
for i, e in kinds.items():
    k = e['kind']
    if i < 2:
        continue
    if k == 'gasp' and e['n'] >= 8:
        evshot('ev_gasp8_dry.png', i, -0.05, 0.9, True, fmax=6000, h=300, w=1500, win=1024, hop=70, rng=70)
        evshot('ev_gasp8_hall.png', i, -0.05, 1.8, False, fmax=6000, h=300, w=1500, win=1024, hop=130, rng=70)
    if k == 'laugh' and e['n'] >= 6:
        evshot('ev_laugh6_dry.png', i, -0.05, 2.4, True, fmax=6000, h=300, w=1500, win=1024, hop=150, rng=70)
    if k == 'whoa' and e['n'] == 10:
        evshot('ev_whoa10_dry.png', i, -0.05, 1.5, True, fmax=6000, h=300, w=1500, win=1024, hop=100, rng=70)
        evshot('ev_whoa10_hall.png', i, -0.05, 2.5, False, fmax=6000, h=300, w=1500, win=1024, hop=150, rng=70)
    if k == 'no_way':
        evshot('ev_noway2_dry.png', i, -0.05, 1.2, True, fmax=6000, h=300, w=1500, win=1024, hop=90, rng=70)
    if k == 'murmur' and e['n'] == 6:
        evshot('ev_murmur6_hall.png', i, -0.05, 2.6, False, fmax=6000, h=300, w=1500, win=1024, hop=180, rng=70)
    if k == 'cheer' and e['n'] == 20:
        evshot('ev_cheer20_dry.png', i, -0.05, 1.6, True, fmax=8000, h=300, w=1500, win=1024, hop=100, rng=70)
    if k == 'applause':
        evshot('ev_applause_start_dry.png', i, -0.02, 1.4, True, fmax=12000, h=300, w=1500, win=512, hop=30, rng=75)
        evshot('ev_applause_sync_dry.png', i, 2.2, 1.6, True, fmax=12000, h=300, w=1500, win=512, hop=40, rng=75)
        evshot('ev_applause_climax_dry.png', i, 5.2, 1.4, True, fmax=12000, h=300, w=1500, win=512, hop=30, rng=75)
        evshot('ev_applause_full_hall.png', i, -0.1, 9.9, False, fmax=12000, h=360, w=1500, win=2048, hop=300, rng=80)

# the whole stem 42-60 s
y, sr = sf.read(os.path.join(BUILD, 'stems', 'crowd.wav'), dtype='float32')
save('stem_42_60.png', y.mean(axis=1)[int(42 * sr):int(60 * sr)], fmax=10000, h=360, w=1500, win=2048, hop=480, rng=85, title='crowd.wav 42-60 s (the tick labels start at 0 = 42 s)')
