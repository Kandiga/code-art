#!/usr/bin/env python3
"""
audio/vo/synth.py - deterministic, seeded Piper TTS (offline).

Piper's VITS graph contains two RandomNormalLike nodes (duration noise, latent
noise) that onnxruntime seeds from the clock, so stock Piper is NOT repeatable.
Here the graph is patched in memory (onnx) so every RandomNormalLike gets a fixed
`seed` attribute; a fresh session per (voice, seed) makes every take bit-exact
repeatable on the same machine (1 intra-op thread, no non-deterministic reductions).

Extra direction tools added on top of stock Piper (all optional):
  * per-PHONEME duration control: the ONNX graph is patched with a `dur_mult` input that scales the
    predicted duration of every phoneme (exposed in the text as inline markup, see below);
  * word-level alignment (the graph's w_ceil tensor is exposed) -> every take gets exact word timings;
  * inline markup in text:  army{1.35}   (all phonemes of that word x1.35 longer)
                            army{v1.6}   (vowels only)      army{v1.6c1.1}  (vowels 1.6, consonants 1.1)
Usage (JSON in, JSON out; see piper.mjs):
    python synth.py jobs.json            # jobs.json = {"jobs":[ {...}, ... ]}
job = {
  "id": "vo1",                    # label only
  "voice": "en_US-ryan-high",     # file stem in audio/vo/models/
  "speaker": 0,                   # multi-speaker voices (libritts) only
  "seed": 1,                      # RNG seed (int)
  "out": "/abs/path/take.wav",    # float32 mono WAV at the voice's native rate
  "segments": [                   # one or more phrases, each with its OWN prosody
      {"text": "Every film", "length_scale": 1.0, "noise_scale": 0.667, "noise_w": 0.8,
       "gap_after": 0.12 }        # seconds of silence after this segment (default 0)
  ]
}
or the short form {"text": "...", "length_scale":..., ...} (one segment).
Result (stdout, last line): JSON list [{id,out,sr,dur}].
"""
import json
import os
import re
import sys
import wave
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, "models")

_proto_cache = {}   # voice -> ModelProto (parsed once)
_cfg_cache = {}
_session_cache = {}  # (voice, seed) -> (PiperVoice)


def _seed_graph(g, seeds):
    """Give every Random* node a seed attribute (recursively, incl. If-subgraphs)."""
    import onnx
    k = 0
    for n in g.node:
        if n.op_type.startswith("Random"):
            for a in list(n.attribute):
                if a.name == "seed":
                    n.attribute.remove(a)
            n.attribute.append(onnx.helper.make_attribute("seed", float(seeds[k % len(seeds)])))
            k += 1
        for a in n.attribute:
            if a.type == 5:
                _seed_graph(a.g, seeds)
            elif a.type == 10:
                for gg in a.graphs:
                    _seed_graph(gg, seeds)


def _patch_model(model):
    """Add `dur_mult` [1,1,phonemes] input (multiplies predicted durations before Ceil) and expose w_ceil."""
    import onnx
    from onnx import TensorProto, helper
    g = model.graph
    if any(i.name == "dur_mult" for i in g.input):
        return
    idx = next(i for i, n in enumerate(g.node) if n.op_type == "Ceil")
    ceil = g.node[idx]
    src = ceil.input[0]
    new = src + "_dm"
    g.node.insert(idx, helper.make_node("Mul", [src, "dur_mult"], [new], name="dur_mult_mul"))
    ceil.input[0] = new
    g.input.append(helper.make_tensor_value_info("dur_mult", TensorProto.FLOAT, [1, 1, "phonemes"]))
    vi = onnx.ValueInfoProto()
    vi.name = ceil.output[0]
    g.output.append(vi)


def load_voice(voice, seed):
    # NOTE: no session reuse on purpose - the seeded generator state advances with every run(),
    # so a take is only repeatable from a freshly built session.
    import onnx
    import onnxruntime
    from pathlib import Path
    from piper.config import PiperConfig
    from piper.voice import PiperVoice

    onnx_path = os.path.join(MODELS, voice + ".onnx")
    cfg_path = onnx_path + ".json"
    if voice not in _proto_cache:
        _proto_cache[voice] = onnx.load(onnx_path)
        _patch_model(_proto_cache[voice])
        with open(cfg_path, "r", encoding="utf-8") as f:
            _cfg_cache[voice] = json.load(f)
    model = _proto_cache[voice]
    rng = np.random.RandomState(int(seed) & 0x7FFFFFFF)
    seeds = [float(rng.randint(1, 2**24)) for _ in range(2)]  # exactly representable as float32
    _seed_graph(model.graph, seeds)
    so = onnxruntime.SessionOptions()
    so.intra_op_num_threads = 1
    so.inter_op_num_threads = 1
    so.log_severity_level = 3
    sess = onnxruntime.InferenceSession(model.SerializeToString(), sess_options=so,
                                        providers=["CPUExecutionProvider"])
    pv = PiperVoice(session=sess, config=PiperConfig.from_dict(_cfg_cache[voice]))
    return pv


_MARK = re.compile(r"\{([^}]*)\}")
_VOWELS = set("aeiouɑɐɒæɔəɘɚɛɜɝɞɨɪɯɵɶʉʊʌɤøœyᵻ")


def _parse_markup(text):
    """'an army{v1.5} to' -> ('an army to', {1: (v, c)})  (word index -> (vowel mult, consonant mult))."""
    plain, marks, widx = "", {}, 0
    for tok in text.split():
        m = _MARK.search(tok)
        base = _MARK.sub("", tok)
        if m:
            spec = m.group(1).strip()
            v = c = None
            mm = re.fullmatch(r"([0-9.]+)", spec)
            if mm:
                v = c = float(mm.group(1))
            else:
                mv = re.search(r"v([0-9.]+)", spec)
                mc = re.search(r"c([0-9.]+)", spec)
                v = float(mv.group(1)) if mv else 1.0
                c = float(mc.group(1)) if mc else 1.0
            marks[widx] = (v, c)
        plain += (" " if plain else "") + base
        widx += 1
    return plain, marks


_PUNCT = set(",.;:!?-\"()")


def _word_spans(pv, words_txt):
    """Map text words -> (sentence index, [phoneme indices k]) using prefix phonemization.
    (espeak merges function words, e.g. 'for a' -> 'fɚɹə', so splitting on spaces is not reliable.)"""
    full = pv.phonemize(" ".join(words_txt))
    flat = []  # (sentence, k) of every non-space token
    for si, s in enumerate(full):
        for k, p in enumerate(s):
            if p != " ":
                flat.append((si, k))
    ends = []
    for i in range(len(words_txt)):
        pre = pv.phonemize(" ".join(words_txt[: i + 1]))
        ends.append(sum(1 for s in pre for p in s if p != " "))
    spans, prev = [], 0
    for e in ends:
        e = max(prev, min(e, len(flat)))
        spans.append(flat[prev:e])
        prev = e
    return full, spans


def synth_segment(pv, text, speaker, length_scale, noise_scale, noise_w, sentence_silence=0.0, space_mult=1.0):
    """Synthesize one phrase -> (float32 mono array, [word dicts with t0/t1 seconds])."""
    plain, marks = _parse_markup(text)
    words_txt = plain.split()
    sr = pv.config.sample_rate
    hop = pv.config.hop_length
    sents, spans = _word_spans(pv, words_txt)
    # per-sentence duration multipliers
    dms = [np.ones(len(pv.phonemes_to_ids(s)) if s else 0, np.float32) for s in sents]
    if space_mult != 1.0:  # pace control without squeezing vowels: scale only the inter-word gaps
        for si, ph in enumerate(sents):
            for k, p in enumerate(ph):
                if p == " ":
                    for ii in (2 + 2 * k, 3 + 2 * k):
                        if ii < len(dms[si]):
                            dms[si][ii] = space_mult
    for wi, sp in enumerate(spans):
        if wi in marks:
            v, c = marks[wi]
            for si, k in sp:
                ph = sents[si][k]
                if ph in _PUNCT:
                    continue
                mult = v if (ph[0] in _VOWELS or ph == "ː") else c
                for ii in (2 + 2 * k, 3 + 2 * k):
                    dms[si][ii] = mult
    out, words, cursor = [], [], 0
    sent_audio = []
    for si, ph in enumerate(sents):
        if not ph:
            sent_audio.append((np.zeros(0, np.float32), np.zeros(1, np.int64)))
            continue
        ids = pv.phonemes_to_ids(ph)
        args = {
            "input": np.expand_dims(np.array(ids, dtype=np.int64), 0),
            "input_lengths": np.array([len(ids)], dtype=np.int64),
            "scales": np.array([noise_scale, length_scale, noise_w], dtype=np.float32),
            "dur_mult": dms[si].reshape(1, 1, -1),
        }
        if pv.config.num_speakers > 1:
            args["sid"] = np.array([speaker], dtype=np.int64)
        res = pv.session.run(None, args)
        audio = res[0].squeeze().astype(np.float32)
        samples = (res[1].squeeze() * hop).astype(np.int64)
        csum = np.concatenate([[0], np.cumsum(samples)])
        sent_audio.append((audio, csum))
    # sentence start offsets in the concatenated output
    offs, cur = [], 0
    gapn = int(round(sentence_silence * sr))
    for si, (a, _) in enumerate(sent_audio):
        offs.append(cur)
        cur += len(a) + (gapn if si < len(sent_audio) - 1 else 0)
    for wi, sp in enumerate(spans):
        sp2 = [(si, k) for si, k in sp if sents[si][k] not in _PUNCT] or sp
        if not sp2:
            continue
        si = sp2[0][0]
        audio, csum = sent_audio[si]
        scale = len(audio) / max(1, csum[-1])
        ks = [k for s_, k in sp2 if s_ == si]
        a = csum[2 + 2 * ks[0]] * scale
        b = csum[min(len(csum) - 1, 3 + 2 * ks[-1])] * scale
        words.append({"w": words_txt[wi], "t0": (offs[si] + a) / sr, "t1": (offs[si] + b) / sr})
    for si, (a, _) in enumerate(sent_audio):
        out.append(a)
        if gapn and si < len(sent_audio) - 1:
            out.append(np.zeros(gapn, np.float32))
    return (np.concatenate(out) if out else np.zeros(0, np.float32)), words


def run_job(job):
    segs = job.get("segments")
    if segs is None:
        segs = [{k: job[k] for k in ("text", "length_scale", "noise_scale", "noise_w", "gap_after", "sentence_silence", "space_mult") if k in job}]
    voice = job["voice"]
    seed = int(job.get("seed", 1))
    pv = load_voice(voice, seed)
    sr = pv.config.sample_rate
    spk = int(job.get("speaker", 0))
    out, words, pos = [], [], 0
    for i, s in enumerate(segs):
        a, w = synth_segment(pv, s["text"], int(s.get("speaker", spk)), float(s.get("length_scale", 1.0)),
                             float(s.get("noise_scale", 0.667)), float(s.get("noise_w", 0.8)),
                             float(s.get("sentence_silence", 0.0)), float(s.get("space_mult", 1.0)))
        for x in w:
            words.append({"w": x["w"], "t0": pos / sr + x["t0"], "t1": pos / sr + x["t1"], "seg": i})
        out.append(a)
        pos += len(a)
        gap = float(s.get("gap_after", 0.0))
        if gap > 0 and i < len(segs) - 1:
            out.append(np.zeros(int(round(gap * sr)), np.float32))
            pos += len(out[-1])
    y = np.concatenate(out) if out else np.zeros(0, np.float32)
    write_wav_f32(job["out"], y, sr)
    with open(os.path.splitext(job["out"])[0] + ".words.json", "w") as f:
        json.dump(words, f)
    return {"id": job.get("id"), "out": job["out"], "sr": sr, "dur": len(y) / sr, "words": words}


def write_wav_f32(path, y, sr):
    """Minimal IEEE-float32 mono WAV writer (format 3)."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    data = np.asarray(y, dtype="<f4").tobytes()
    with open(path, "wb") as f:
        f.write(b"RIFF" + (36 + len(data)).to_bytes(4, "little") + b"WAVE")
        f.write(b"fmt " + (16).to_bytes(4, "little") + (3).to_bytes(2, "little") + (1).to_bytes(2, "little")
                + sr.to_bytes(4, "little") + (sr * 4).to_bytes(4, "little") + (4).to_bytes(2, "little")
                + (32).to_bytes(2, "little"))
        f.write(b"data" + len(data).to_bytes(4, "little") + data)


def main():
    jobs = json.load(open(sys.argv[1]))["jobs"]
    # group by (voice, seed) so each patched session is loaded once
    order = sorted(range(len(jobs)), key=lambda i: (jobs[i]["voice"], int(jobs[i].get("seed", 1))))
    res = [None] * len(jobs)
    for i in order:
        res[i] = run_job(jobs[i])
        print("done", jobs[i].get("id"), file=sys.stderr, flush=True)
    print(json.dumps(res))


if __name__ == "__main__":
    main()
