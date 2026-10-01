#!/usr/bin/env python3
"""
audio/crowd/py/build_lib.py - builds the human-voice / hand-clap library into audio/crowd/lib (seeded, cached).

  python build_lib.py [--only words,synth,walla,claps,whistles,asr] [--force] [--quick]

 words    Piper TTS (many voices incl. libritts-high speakers) -> Praat formant shift + PSOLA pitch contour -> 'whoa' 'oh' 'no way' ...
 synth    source-filter vocal synth: gasps, laughs, whoops/cheers, aww/ooh (vocal.py)
 walla    quiet band-limited chatter fragments (Piper, random sentences) for the murmur layers
 claps    individual hand-claps (claps.py), packed into lib/claps.wav (+ index in manifest)
 whistles finger/lip whistles (vocal.py)
 asr      Whisper transcripts of the 'whoa' / 'no way' / ... clips (stored in the manifest)
Output: lib/<group>/<id>.wav (mono, 48 kHz, 16-bit PCM cache) + lib/manifest.json.
Praat's 'Change gender' is not repeatable run-to-run (see audio/vo/NOTES.md), so the cache IS the deterministic artefact: commit lib/.
"""
import argparse
import json
import os
import sys
import time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
VO = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(HERE))), 'audio', 'vo') if False else os.path.join(os.path.dirname(os.path.dirname(HERE)), 'vo')
sys.path.insert(0, VO)

import numpy as np
import soundfile as sf

from common import SR, LIB, rng_of, resample_to, trim, fade_edges, set_active_rms, active_rms_db, biquad_filter, butter, db, lin, save_json
import people
import vocal
import claps as claplib

MANIFEST = os.path.join(LIB, 'manifest.json')


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def save_clip(group, cid, y, meta):
    y = np.asarray(y, np.float64)
    path = os.path.join(LIB, group, cid + '.wav')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sf.write(path, y.astype(np.float32), SR, subtype='PCM_16')
    yq = sf.read(path, dtype='float64')[0]  # what the renderer will read
    pk = float(np.abs(yq).max())
    thr = pk * lin(-32)
    idx = np.nonzero(np.abs(yq) > thr)[0]
    meta = dict(meta)
    meta.update(id=cid, file=f'{group}/{cid}.wav', group=group, dur=round(len(yq) / SR, 4), peakDb=round(float(db(pk)), 2),
                rmsDb=round(active_rms_db(yq), 2), onset=round(float(idx[0] / SR), 4) if len(idx) else 0.0, lead=lead_time(yq))
    return meta


def lead_time(yq):
    """seconds between the -45 dB and the -32 dB (re peak) crossing = how soft the lead-in of the clip is."""
    pk = float(np.abs(yq).max())
    a = np.nonzero(np.abs(yq) > pk * lin(-45))[0]
    b = np.nonzero(np.abs(yq) > pk * lin(-32))[0]
    return round(float((b[0] - a[0]) / SR), 4) if len(a) and len(b) else 0.0


def load_manifest():
    if os.path.exists(MANIFEST):
        return json.load(open(MANIFEST))
    return dict(version=1, sr=SR, clips=[], claps=[])


def commit(man, group, clips):
    man['clips'] = [c for c in man['clips'] if c['group'] != group] + clips
    save_json(MANIFEST, man)


# ------------------------------------------------------------------------------------------------------------------
class Pool:
    """one patched Piper session per voice, reused for a fixed sequence of takes (deterministic given the order)."""

    def __init__(self):
        import synth
        self.synth = synth
        self.pv = {}

    def take(self, voice, speaker, text, ls=1.0, ns=0.667, nw=0.8):
        if voice not in self.pv:
            self.pv[voice] = self.synth.load_voice(voice, (zlib.crc32(voice.encode()) & 0xFFFF) + 1)
        pv = self.pv[voice]
        a, _ = self.synth.synth_segment(pv, text, int(speaker), float(ls), float(ns), float(nw))
        return a.astype(np.float64), pv.config.sample_rate

    def drop(self, voice):
        self.pv.pop(voice, None)


def pitch_range(sex):
    return {'m': (60.0, 300.0), 'f': (100.0, 520.0), 'k': (150.0, 760.0)}[sex]


def contour_events(spec, dur):
    ev = []
    for e in spec['ev']:
        if e[0] == 'hump':
            ev.append(dict(shape='hump', t0=e[1] * dur, t1=e[2] * dur, st=e[3]))
        else:
            ev.append(dict(shape='ramp', t0=e[1] * dur, t1=e[2] * dur, st0=e[3], st1=e[4]))
    return ev


def effort(y, g_db=0.0):
    """raised vocal effort: brighter, slightly driven (shouted/excited speech has stronger upper harmonics)."""
    y = biquad_filter(y, 'highshelf', 2300.0, 0.7, 3.0 + 0.5 * g_db)
    y = biquad_filter(y, 'peak', 3400.0, 1.0, 2.0)
    k = 1.0 + 0.25 * max(g_db, 0)
    return np.tanh(y * k / (np.abs(y).max() + 1e-9) * 1.2) / np.tanh(1.2) * np.abs(y).max()


def plan_words():
    """deterministic (person, word, variant) list: every person says 'whoa' + a seeded selection of the other words."""
    rng = rng_of('plan_words')
    plan = []
    for p in people.PEOPLE:
        for w, vs in people.WORDS.items():
            wt = people.WORD_WEIGHT[w]
            if w == 'whoa':
                wt = 0.8
            if w == 'no_way' and p[3] == 'k':
                wt = 0.15
            if rng.rand() < wt:
                vi = rng.randint(len(vs))
                plan.append((p[0], w, vi))
                if w in ('whoa', 'no_way', 'wow') and rng.rand() < 0.28 and len(vs) > 1:
                    plan.append((p[0], w, (vi + 1) % len(vs)))
    return plan


def stage_words(force=False, quick=False):
    import prosody
    man = load_manifest()
    have = {c['id'] for c in man['clips'] if c['group'] == 'words'}
    plan = plan_words()
    P = {p[0]: p for p in people.PEOPLE}
    if quick:
        plan = plan[:24]
    # group by voice so each session loads once; skip a voice only when ALL its takes exist (sequence determinism)
    byv = {}
    for pid, w, vi in plan:
        byv.setdefault(P[pid][1], []).append((pid, w, vi))
    pool = Pool()
    clips = [c for c in man['clips'] if c['group'] == 'words']
    t0 = time.time()
    for voice in sorted(byv):
        items = sorted(byv[voice])
        ids = [f'{w}_{pid}_{people.WORDS[w][vi]["v"]}' for pid, w, vi in items]
        if not force and all(i in have for i in ids):
            continue
        clips = [c for c in clips if c['id'] not in ids]
        for (pid, w, vi), cid in zip(items, ids):
            p = P[pid]
            spec = people.WORDS[w][vi]
            rng = rng_of('word', cid)
            y, sr = pool.take(p[1], p[2], spec['text'], spec['ls'] * rng.uniform(0.94, 1.08), spec['ns'], spec['nw'])
            if len(y) < 200:
                log('empty take', cid)
                continue
            fmin, fmax = pitch_range(p[3])
            if abs(p[5] - 1.0) > 0.004:
                y = prosody.change_voice(y, sr, p[5] * rng.uniform(0.985, 1.015), 0.0, 1.0, fmin, fmax)
            dur = len(y) / sr
            gst = p[6] + rng.uniform(-0.8, 1.2)
            y = prosody.pitch_edit(y, sr, contour_events(spec, dur), global_st=gst, fmin=fmin, fmax=fmax)
            y = resample_to(y, sr, SR)
            y = trim(y, -46, 3, 25)
            y = effort(y, spec['g'])
            y = fade_edges(y, 2.5, 18)
            y = set_active_rms(y, -24.0)
            m = save_clip('words', cid, y, dict(kind='word', tag=w, variant=spec['v'], person=pid, sex=p[3], voice=p[1], speaker=p[2], text=spec['text'], gainHintDb=spec['g']))
            clips.append(m)
        commit(man, 'words', clips)
        log(f'  words: {voice} done ({len(clips)} clips, {time.time() - t0:.0f}s)')
        pool.drop(voice)
    commit(man, 'words', clips)
    log('words:', len(clips))


# ------------------------------------------------------------------------------------------------------------------
def stage_synth(force=False, quick=False):
    man = load_manifest()
    clips = [c for c in man['clips'] if c['group'] == 'synth']
    have = {c['id'] for c in clips}
    counts = {'gasp': 32, 'laugh': 32, 'whoop': 40, 'aww': 14}
    if quick:
        counts = {k: 4 for k in counts}
    fns = {'gasp': vocal.gasp, 'laugh': vocal.laugh, 'whoop': vocal.whoop, 'aww': vocal.aww}
    gain_hint = {'gasp': -1.0, 'laugh': 0.0, 'whoop': 3.0, 'aww': -2.0}
    for kind, cnt in counts.items():
        for i in range(cnt):
            cid = f'{kind}_{i:02d}'
            if cid in have and not force:
                continue
            rng = rng_of('synth', kind, i)
            sex = rng.choice(['m', 'f', 'k'], p=[0.40, 0.40, 0.20])
            person = vocal.make_person(rng, sex)
            y = fns[kind](person, rng)
            y = trim(y, -50, 3, 30)
            y = fade_edges(y, 2.0, 15)
            y = set_active_rms(y, -24.0 if kind != 'gasp' else -22.0)
            style = getattr(y, 'style', None)
            m = save_clip('synth', cid, y, dict(kind='synth', tag=kind, person=f'{kind}{i:02d}', sex=str(sex), f0=round(person['f0'], 1), vt=round(person['vt'], 3), gainHintDb=gain_hint[kind]))
            clips = [c for c in clips if c['id'] != cid] + [m]
    commit(man, 'synth', clips)
    log('synth:', len(clips))


def stage_whistles(force=False, quick=False):
    man = load_manifest()
    clips = []
    for i in range(6 if quick else 12):
        rng = rng_of('whistle', i)
        y = vocal.whistle(rng)
        y = trim(y, -50, 3, 20)
        y = fade_edges(y, 2.0, 20)
        y = set_active_rms(y, -26.0)
        clips.append(save_clip('whistles', f'whistle_{i:02d}', y, dict(kind='synth', tag='whistle', person=f'whistle{i:02d}', gainHintDb=-2.0)))
    commit(man, 'whistles', clips)
    log('whistles:', len(clips))


# ------------------------------------------------------------------------------------------------------------------
def stage_walla(force=False, quick=False):
    man = load_manifest()
    clips = []
    pool = Pool()
    people_by_voice = {}
    rng = rng_of('walla_plan')
    sentences = people.WALLA[: 8 if quick else None]
    order = rng.permutation(len(people.PEOPLE))
    jobs = []
    for i, s in enumerate(sentences):
        p = people.PEOPLE[order[i % len(order)]]
        jobs.append((i, s, p))
    for voice in sorted({j[2][1] for j in jobs}):
        for i, s, p in [j for j in jobs if j[2][1] == voice]:
            r = rng_of('walla', i)
            y, sr = pool.take(p[1], p[2], s + '.', r.uniform(0.9, 1.1), 0.8, 1.0)
            if p[3] == 'k':
                import prosody
                y = prosody.change_voice(y, sr, p[5], 0.0, 1.0, *pitch_range('k'))
            y = resample_to(y, sr, SR)
            y = trim(y, -46, 5, 30)
            # distant, band-limited chatter: 180-3400 Hz, tilted
            y = butter(y, 'hp', 180, 2)
            y = butter(y, 'lp', 3400, 3)
            y = fade_edges(y, 12, 40)
            y = set_active_rms(y, -26.0)
            clips.append(save_clip('walla', f'walla_{i:02d}', y, dict(kind='walla', tag='walla', person=p[0], sex=p[3], text=s, gainHintDb=0.0)))
        pool.drop(voice)
    commit(man, 'walla', clips)
    log('walla:', len(clips))


# ------------------------------------------------------------------------------------------------------------------
def stage_claps(force=False, quick=False):
    man = load_manifest()
    hands, per = (8, 3) if quick else (48, 4)
    arrs, index, pos = [], [], 0
    for h in range(hands):
        rng = rng_of('hand', h)
        hand = claplib.make_hand(rng)
        for j in range(per):
            c = claplib.clap(hand, rng_of('clap', h, j))
            a = np.asarray(c, np.float32)
            a = np.concatenate([a, np.zeros(int(0.01 * SR), np.float32)])
            index.append(dict(id=f'clap_{h:02d}_{j}', hand=h, morph=hand['kind'], start=pos, len=len(a), cavity=round(hand['cav_f'], 0), slap=round(hand['slap_f'], 0)))
            arrs.append(a)
            pos += len(a)
    allc = np.concatenate(arrs)
    sf.write(os.path.join(LIB, 'claps.wav'), allc, SR, subtype='PCM_16')
    man['claps'] = index
    save_json(MANIFEST, man)
    log('claps:', len(index), 'hands:', hands, f'{pos / SR:.1f}s')


# ------------------------------------------------------------------------------------------------------------------
def stage_asr(force=False, quick=False):
    import asr
    man = load_manifest()
    tags = {'whoa', 'no_way', 'wow', 'yeah', 'oh', 'woo', 'ah', 'ooh', 'aww', 'mm', 'haha'}
    n = 0
    for c in man['clips']:
        if c['group'] == 'words' and c['tag'] in tags and (force or 'asr' not in c):
            y, sr = sf.read(os.path.join(LIB, c['file']), dtype='float32')
            txt, conf = asr.transcribe(y, sr, 'base.en')
            c['asr'] = txt
            c['asrConf'] = round(conf, 3)
            n += 1
            if n % 25 == 0:
                save_json(MANIFEST, man)
                log(f'  asr {n}')
    save_json(MANIFEST, man)
    log('asr:', n)


def stage_reindex(force=False, quick=False):
    """recompute dur / peak / rms / onset (-32 dB re peak) of every cached clip from the WAV files (no re-synthesis)."""
    man = load_manifest()
    for c in man['clips']:
        yq = sf.read(os.path.join(LIB, c['file']), dtype='float64')[0]
        pk = float(np.abs(yq).max())
        idx = np.nonzero(np.abs(yq) > pk * lin(-32))[0]
        c.update(dur=round(len(yq) / SR, 4), peakDb=round(float(db(pk)), 2), rmsDb=round(active_rms_db(yq), 2), onset=round(float(idx[0] / SR), 4) if len(idx) else 0.0, lead=lead_time(yq))
    save_json(MANIFEST, man)
    log('reindex:', len(man['clips']))


STAGES = dict(reindex=stage_reindex, words=stage_words, synth=stage_synth, whistles=stage_whistles, walla=stage_walla, claps=stage_claps, asr=stage_asr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='synth,whistles,claps,words,walla,asr')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--quick', action='store_true')
    a = ap.parse_args()
    for s in a.only.split(','):
        t = time.time()
        log(f'== {s}')
        STAGES[s](force=a.force, quick=a.quick)
        log(f'   {s} {time.time() - t:.1f}s')


if __name__ == '__main__':
    main()
