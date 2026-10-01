#!/usr/bin/env python3
"""
audio/crowd/py/verify_asr.py - do the voices sound like PEOPLE? (numbers; there is no audio playback here)

  1. ASR (faster-whisper) of the library words 'whoa' / 'no way' that the film actually uses + of the solo event renders
  2. murmur: ASR of the layered walla must NOT recover the phrases (3-gram hits against the source sentences)
  3. harmonicity (Praat): voiced fraction / median F0 / HNR per library group, vs a white-noise and a filtered-noise reference
Run after `node audio/crowd/render.mjs` and `node audio/crowd/tools/solo.mjs`.   Writes audio/crowd/asr_report.json
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), 'vo'))
import numpy as np
import soundfile as sf
from common import LIB, SR, CROWD, save_json
import asr

BUILD = os.path.join(os.path.dirname(CROWD), 'build')
TMP = os.path.join(BUILD, 'tmp', 'crowd')
man = json.load(open(os.path.join(LIB, 'manifest.json')))
byid = {c['id']: c for c in man['clips']}
rep = json.load(open(os.path.join(BUILD, 'crowd_report.json')))
plan = rep['plan']
out = {}
model = sys.argv[1] if len(sys.argv) > 1 else 'small.en'


def ev_file(ev, dry=False):
    for f in os.listdir(TMP):
        if f.startswith(f'ev_{ev:02d}_') and f.endswith('_dry.wav') == dry:
            return os.path.join(TMP, f)


def read_win(path, t0, t1):
    y, sr = sf.read(path, dtype='float32')
    if y.ndim > 1:
        y = y.mean(axis=1)
    return y[int(t0 * sr):int(t1 * sr)], sr


# ---- 1. the words used in the film (placed clips), small.en ----------------------------------------------------------
placed = {}
for p in plan:
    if p['k'] == 'v':
        placed.setdefault(p['tag'], []).append(p['id'])
res = {}
for tag in ('whoa', 'no_way'):
    ids = placed.get(tag, [])
    rows = []
    for cid in ids:
        c = byid[cid]
        y, sr = sf.read(os.path.join(LIB, c['file']), dtype='float32')
        txt, conf = asr.transcribe(y, sr, model)
        rows.append(dict(id=cid, person=c['person'], hyp=txt, conf=round(conf, 2), baseEn=c.get('asr')))
    n = lambda s: asr.norm(s)
    ref = {'whoa': ('whoa', 'woah', 'whoo'), 'no_way': ('no way',)}[tag]
    good = sum(1 for r in rows if any(x in n(r['hyp']) for x in ref))
    res[tag] = dict(placed=len(rows), recognised=good, rows=rows)
    print(f'[{model}] placed {tag} clips: {good}/{len(rows)} transcribed as {ref}')
out['words'] = res

# ---- 1b. solo events (dry and with the hall) ------------------------------------------------------------------------------
ctx = {}
for e in rep['events']:
    if e['kind'] in ('no_way', 'whoa', 'oh'):
        for dry in (True, False):
            f = ev_file(e['index'], dry)
            if not f:
                continue
            y, sr = read_win(f, e['t'] - 0.2, e['t'] + 2.8)
            txt, conf = asr.transcribe(y, sr, model)
            ctx[f"ev{e['index']}_{e['kind']}@{e['t']}{'_dry' if dry else '_hall'}"] = dict(hyp=txt, conf=round(conf, 2))
            print(f"  event {e['index']} {e['kind']}@{e['t']} {'dry ' if dry else 'hall'}: {txt!r} ({conf:.2f})")
out['events'] = ctx

# ---- 2. murmur: must stay unintelligible -----------------------------------------------------------------------------------
mm = {}
for e in rep['events']:
    if e['kind'] != 'murmur':
        continue
    frs = [p for p in plan if p['ev'] == e['index'] and p['k'] == 'w']
    srcs = [asr.norm(byid[p['id']]['text']) for p in frs]
    grams = set()
    for s in srcs:
        w = s.split()
        grams |= {' '.join(w[i:i + 3]) for i in range(max(0, len(w) - 2))}
    for dry in (True, False):
        f = ev_file(e['index'], dry)
        y, sr = read_win(f, e['t'] - 0.2, e['t'] + (e.get('dur') or 1.5) + 1.8) if False else read_win(f, e['t'] - 0.2, e['t'] + 4)
        txt, conf = asr.transcribe(y, sr, model)
        w = asr.norm(txt).split()
        hyp_grams = {' '.join(w[i:i + 3]) for i in range(max(0, len(w) - 2))}
        hits = sorted(hyp_grams & grams)
        key = f"ev{e['index']}_murmur@{e['t']}{'_dry' if dry else '_hall'}"
        mm[key] = dict(hyp=txt, conf=round(conf, 2), sources=srcs, threeGramHits=hits)
        print(f"  {key}: hyp={txt!r}  3-gram hits: {hits}")
out['murmur'] = mm

# ---- 3. harmonicity ----------------------------------------------------------------------------------------------------------
import parselmouth
from parselmouth.praat import call


def harm(y, sr):
    snd = parselmouth.Sound(np.asarray(y, np.float64), sampling_frequency=sr)
    pit = snd.to_pitch(time_step=0.01, pitch_floor=70, pitch_ceiling=900)
    f0 = pit.selected_array['frequency']
    v = f0[f0 > 0]
    hnr = call(snd.to_harmonicity_cc(time_step=0.01, minimum_pitch=70), 'Get mean', 0, 0) if len(v) else float('nan')
    return dict(voiced=float(len(v) / max(1, len(f0))), f0=float(np.median(v)) if len(v) else 0.0, hnr=float(hnr))


groups = {}
for c in man['clips']:
    key = f"{c['group']}:{c['tag']}"
    y, sr = sf.read(os.path.join(LIB, c['file']), dtype='float32')
    h = harm(y, sr)
    groups.setdefault(key, []).append(h)
rng = np.random.RandomState(1)
noise = rng.randn(SR)
from scipy import signal as ss
fn = ss.sosfilt(ss.butter(2, [300 / 24000, 3500 / 24000], 'band', output='sos'), noise)
ref = {'white noise': harm(noise, SR), 'band-passed noise 300-3500': harm(fn, SR)}
tab = {}
for k, v in sorted(groups.items()):
    tab[k] = dict(n=len(v), voiced=round(float(np.mean([x['voiced'] for x in v])), 2), f0_median=round(float(np.median([x['f0'] for x in v if x['f0'] > 0] or [0])), 0),
                  hnr_db=round(float(np.nanmedian([x['hnr'] for x in v])), 1))
out['harmonicity'] = dict(groups=tab, reference={k: {a: round(b, 2) for a, b in v.items()} for k, v in ref.items()})
for k, v in tab.items():
    print(f'  {k:22s} n={v["n"]:3d} voiced={v["voiced"]:.2f} f0={v["f0_median"]:5.0f} Hz  HNR={v["hnr_db"]:5.1f} dB')
print('  reference', out['harmonicity']['reference'])
save_json(os.path.join(CROWD, 'asr_report.json'), out)
