"""audio/crowd/py/people.py - the audience: who is in the room (Piper identities + synth vocal tracts) and what they say."""

# --- Piper identities --------------------------------------------------------------------------------------------
# (id, model, speaker id, sex, class, formant_ratio, pitch_shift_semitones)
# libritts-high speaker ids were picked from audio/vo/work/speakers.json by median F0 (m: 94-142 Hz, f: 153-249 Hz).
LT = 'en_US-libritts-high'
PEOPLE = [
    # adult men
    ('m01', LT, 399, 'm', 'adult', 1.00, 0.0), ('m02', LT, 495, 'm', 'adult', 1.02, 0.5), ('m03', LT, 514, 'm', 'adult', 0.97, 0.0),
    ('m04', LT, 480, 'm', 'adult', 1.03, 1.0), ('m05', LT, 286, 'm', 'adult', 1.00, -0.5), ('m06', LT, 678, 'm', 'adult', 1.05, 0.0),
    ('m07', LT, 464, 'm', 'adult', 0.98, 0.5), ('m08', LT, 852, 'm', 'adult', 1.00, 1.0), ('m09', LT, 885, 'm', 'adult', 1.04, -1.0),
    ('m10', LT, 28, 'm', 'adult', 1.00, 0.0),
    ('m11', 'en_US-ryan-high', 0, 'm', 'adult', 1.00, 0.5), ('m12', 'en_GB-alan-medium', 0, 'm', 'adult', 1.02, 0.0),
    ('m13', 'en_GB-northern_english_male-medium', 0, 'm', 'adult', 1.00, 1.0), ('m14', 'en_US-hfc_male-medium', 0, 'm', 'adult', 0.98, 0.0),
    ('m15', 'en_US-john-medium', 0, 'm', 'adult', 1.05, 1.5), ('m16', 'en_US-norman-medium', 0, 'm', 'adult', 1.00, 0.0),
    ('m17', 'en_US-joe-medium', 0, 'm', 'adult', 1.03, 0.0), ('m18', 'en_US-sam-medium', 0, 'm', 'adult', 1.00, 0.5),
    ('m19', 'en_US-mike-medium', 0, 'm', 'adult', 1.00, 0.0), ('m20', 'en_US-bryce-medium', 0, 'm', 'adult', 1.02, 0.0),
    # adult women
    ('f01', LT, 683, 'f', 'adult', 1.00, 0.0), ('f02', LT, 434, 'f', 'adult', 1.02, 0.0), ('f03', LT, 717, 'f', 'adult', 1.00, 0.5),
    ('f04', LT, 121, 'f', 'adult', 1.00, 0.0), ('f05', LT, 312, 'f', 'adult', 1.03, 0.0), ('f06', LT, 133, 'f', 'adult', 1.00, 1.0),
    ('f07', LT, 281, 'f', 'adult', 1.00, 0.0), ('f08', LT, 151, 'f', 'adult', 0.98, 0.0), ('f09', LT, 693, 'f', 'adult', 1.00, -0.5),
    ('f10', LT, 59, 'f', 'adult', 1.02, 0.0),
    ('f11', 'en_US-kristin-medium', 0, 'f', 'adult', 1.00, 1.0), ('f12', 'en_GB-cori-high', 0, 'f', 'adult', 1.00, 0.0),
    ('f13', 'en_GB-jenny_dioco-medium', 0, 'f', 'adult', 1.00, 0.0), ('f14', 'en_GB-alba-medium', 0, 'f', 'adult', 1.02, 0.5),
    ('f15', 'en_US-hfc_female-medium', 0, 'f', 'adult', 1.00, 0.0), ('f16', 'en_US-lessac-high', 0, 'f', 'adult', 1.00, 0.0),
    ('f17', 'en_US-lessac-medium', 0, 'f', 'adult', 1.04, 1.0),
    # kids / teens (formant ratio and pitch pushed up)
    ('k01', 'en_GB-cori-high', 0, 'k', 'child', 1.28, 5.0), ('k02', 'en_GB-jenny_dioco-medium', 0, 'k', 'child', 1.32, 5.5),
    ('k03', 'en_US-hfc_female-medium', 0, 'k', 'child', 1.25, 4.5), ('k04', 'en_US-sam-medium', 0, 'k', 'child', 1.35, 9.0),
    ('k05', LT, 434, 'k', 'teen', 1.18, 3.5), ('k06', 'en_US-hfc_male-medium', 0, 'k', 'teen', 1.22, 6.5),
]

# --- words: Piper text + prosody + pitch contour.  ev: (shape, a, b, st | st0, st1) in FRACTIONS of the clip length -------------------------
# length scale > 1 = slower, ns = noise_scale (expressiveness), nw = noise_w (rhythm variation)
H = lambda a, b, st: ('hump', a, b, st)
R = lambda a, b, s0, s1: ('ramp', a, b, s0, s1)
WORDS = {
    'whoa': [
        dict(v='A', text='Whoa{v1.6}!', ls=1.15, ns=0.85, nw=0.95, ev=[H(0, 1, 6.5)], g=1.5),
        dict(v='B', text='Whoa{v2.0}!', ls=1.2, ns=0.8, nw=0.9, ev=[R(0, 0.45, 0, 6.5), R(0.65, 1.0, 0, -5)], g=0.5),
        dict(v='C', text='Whoa{v1.9}.', ls=1.25, ns=0.7, nw=0.8, ev=[H(0, 0.5, 3.5), R(0.35, 1.0, 0, -6)], g=-1.0),
    ],
    'oh': [
        dict(v='A', text='Oh{v1.5}!', ls=1.1, ns=0.8, nw=0.9, ev=[H(0, 1, 5)], g=1.0),
        dict(v='B', text='Ohh{v1.9}.', ls=1.2, ns=0.7, nw=0.8, ev=[R(0, 0.3, 0, 2), R(0.3, 1, 0, -5)], g=0.0),
        dict(v='C', text='Oh{v1.5}?', ls=1.1, ns=0.8, nw=0.9, ev=[R(0.2, 1, 0, 4)], g=0.5),
    ],
    'no_way': [
        dict(v='A', text='No way!', ls=1.1, ns=0.7, nw=0.8, ev=[H(0.45, 1.0, 5.5)], g=1.0),
        dict(v='B', text='No way?', ls=1.12, ns=0.7, nw=0.8, ev=[R(0.4, 1.0, 0, 5)], g=0.5),
        dict(v='C', text='No{s1.1} way{v1.4}!', ls=1.2, ns=0.65, nw=0.7, ev=[H(0, 0.5, 2.5), H(0.5, 1.0, 5.5)], g=1.0),
    ],
    'wow': [
        dict(v='A', text='Wow{v1.5}!', ls=1.1, ns=0.8, nw=0.9, ev=[H(0, 1, 6)], g=1.0),
        dict(v='B', text='Wow{v1.9}...', ls=1.25, ns=0.7, nw=0.8, ev=[H(0, 0.6, 3), R(0.45, 1, 0, -5)], g=0.0),
    ],
    'yeah': [
        dict(v='A', text='Yeah{v1.4}!', ls=1.1, ns=0.8, nw=0.9, ev=[H(0, 1, 4.5)], g=1.5),
        dict(v='B', text='Yeah!', ls=1.0, ns=0.8, nw=0.9, ev=[R(0, 0.3, 0, 3), R(0.4, 1, 0, -3)], g=1.5),
    ],
    'woo': [
        dict(v='A', text='Woo{v2.2}!', ls=1.1, ns=0.85, nw=0.9, ev=[R(0, 0.55, 0, 8.5), R(0.75, 1.0, 0, -2)], g=2.0),
        dict(v='B', text='Whoo{v2.0}!', ls=1.1, ns=0.85, nw=0.9, ev=[R(0, 0.5, 0, 10)], g=2.0),
    ],
    'ah': [
        dict(v='A', text='Ah{v1.6}!', ls=1.1, ns=0.8, nw=0.9, ev=[H(0, 1, 4)], g=0.5),
        dict(v='B', text='Ahh{v1.9}.', ls=1.2, ns=0.7, nw=0.8, ev=[R(0, 1, 1, -4)], g=-1.0),
    ],
    'ooh': [
        dict(v='A', text='Ooh{v1.8}!', ls=1.2, ns=0.8, nw=0.9, ev=[H(0, 1, 5)], g=0.0),
        dict(v='B', text='Ooooh{v2.0}.', ls=1.3, ns=0.7, nw=0.8, ev=[R(0, 0.45, 0, 4), R(0.5, 1, 0, -4)], g=-0.5),
    ],
    'aww': [
        dict(v='A', text='Aww{v2.0}...', ls=1.3, ns=0.7, nw=0.8, ev=[H(0, 0.4, 3), R(0.3, 1, 0, -5)], g=-1.0),
    ],
    'mm': [
        dict(v='A', text='Mmm{v1.7}.', ls=1.2, ns=0.7, nw=0.8, ev=[H(0, 1, 3)], g=-3.0),
    ],
    'haha': [
        dict(v='A', text='Ha ha ha ha!', ls=0.9, ns=0.85, nw=1.0, ev=[R(0, 1, 3, -3)], g=0.5),
        dict(v='B', text='Haha{v1.2}!', ls=0.95, ns=0.85, nw=1.0, ev=[H(0, 1, 3)], g=0.5),
    ],
}
# how many persons say each word (everyone says 'whoa' variant A; the rest by rotation) - see build_lib.plan_words
WORD_WEIGHT = {'whoa': 1.0, 'oh': 0.5, 'no_way': 0.45, 'wow': 0.6, 'yeah': 0.55, 'woo': 0.4, 'ah': 0.3, 'ooh': 0.3, 'aww': 0.2, 'mm': 0.15, 'haha': 0.2}

# --- walla: the chatter that gets buried under layers --------------------------------------------------------------
WALLA = [
    'did you see that', 'that was amazing', 'how did she do that', 'oh my gosh', "I can't believe it", 'look at that',
    'this is incredible', 'it is so beautiful', 'is that real', 'wait what', 'she did it all herself', 'how is this possible',
    "that's the future", 'did that just happen', 'I love this', "that's wild", 'look look look', 'are you seeing this', 'just wow',
    'unbelievable', 'it feels like a dream', "I'm speechless", "that's really something", 'watch this part', 'here it comes',
    "shh it's starting", 'can you believe this', 'a whole film by herself', "it's like we're inside it", 'that is so cool', 'I want one',
    'show me again', 'oh that is lovely', 'magical', 'what is happening', 'this is the best part', 'oh wow oh wow', 'no I mean it',
    'you have to see this', 'it keeps getting better', 'I got chills', 'are those real people', 'unreal', 'so good', 'look at the light',
    'mm that was great', 'tell me that is not amazing', 'I have never seen anything like it', 'wait for it', 'oh here we go',
]
