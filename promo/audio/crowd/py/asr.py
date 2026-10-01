"""audio/crowd/py/asr.py - faster-whisper helper (models live in audio/vo/models/hf)."""
import os
import re
import numpy as np
from scipy import signal

VO = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'vo')
os.environ.setdefault('HF_HOME', os.path.join(VO, 'models', 'hf'))
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
_m = {}


def model(name='base.en'):
    if name not in _m:
        from faster_whisper import WhisperModel
        _m[name] = WhisperModel(name, device='cpu', compute_type='int8', cpu_threads=2)
    return _m[name]


def transcribe(y, sr, name='base.en', prompt=None):
    """-> (text, mean word probability). y mono float; padded with silence (Whisper hallucinates on abrupt clips)."""
    y = np.asarray(y, np.float32)
    if sr != 16000:
        from math import gcd
        g = gcd(int(sr), 16000)
        y = signal.resample_poly(y, 16000 // g, int(sr) // g).astype(np.float32)
    y = np.concatenate([np.zeros(int(0.4 * 16000), np.float32), y, np.zeros(int(0.8 * 16000), np.float32)])
    segs, _ = model(name).transcribe(y, language='en', beam_size=5, temperature=0.0, condition_on_previous_text=False,
                                     word_timestamps=True, initial_prompt=prompt, vad_filter=False)
    ws = []
    txt = []
    for s in segs:
        txt.append(s.text)
        for w in (s.words or []):
            ws.append(w.probability)
    return ' '.join(t.strip() for t in txt).strip(), float(np.mean(ws)) if ws else 0.0


def norm(t):
    return re.sub(r'\s+', ' ', re.sub(r"[^a-z0-9' ]+", ' ', t.lower().replace('’', "'"))).strip()
