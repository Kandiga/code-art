// =============================================================================
// presets.mjs - DATA ONLY (no imports): per-era arrangement kits.  instruments.mjs turns these into ERA_STYLES objects
// with callable helpers (render / process / send / finish).  Edit here to re-orchestrate an era.
//
// Layer object: {id: instrument id, opts: render options, role?}.  `mixDb` are the suggested relative levels of the three
// layers (dB, applied by kit.finish) -- the instruments are level-calibrated so 0 dB each is a sensible starting balance.
// `hint` strings describe what the composer is expected to write for that layer (not executed).
// One motif (E4 G4 A4 C5), one chord loop (Am F C G), one tempo for every era: only the ORCHESTRATION changes.
// =============================================================================
export const ERA_DATA = {
  silent_piano: {
    era: 'e1895', year: 1895, title: 'Silent-film upright piano',
    motif: { id: 'piano', opts: { variant: 'upright', tuneScale: 1.25 } },
    pad: null,
    rhythm: { id: 'piano', opts: { variant: 'upright' }, hint: 'ragtime vamp: root/fifth on beats 1+3 (A2/E3 region), closed chord on 2+4 (A3 C4 E4); left hand only' },
    extras: [],
    processors: [{ id: 'tapeWobble', opts: { wow: 0.0045, flutter: 0.0011, drift: 0.002 } }, { id: 'reelHiss', opts: { levelDb: -44 } }, { id: 'vinylCrackle', opts: { levelDb: -42, rate: 14, big: 0.3 } }],
    reverb: { preset: 'room', wet: 0.14 },
    mixDb: { motif: 0, pad: -99, rhythm: -4.5, master: 1.5 },
  },
  piano_musicbox: {
    era: 'e1902', year: 1902, title: 'Piano + music-box / celesta twinkle (stage magic)',
    motif: { id: 'piano', opts: { variant: 'honky', tuneScale: 0.9 } },
    pad: { id: 'celesta', opts: {}, hint: 'sparkling chord tones an octave+ above (C6-E6 region), one note per beat; or glissed arpeggios' },
    rhythm: { id: 'piano', opts: { variant: 'honky' }, hint: 'same oom-pah vamp as 1895, a little busier (8th-note chord stabs)' },
    extras: [{ role: 'twinkle', id: 'musicbox', opts: {}, hint: 'the motif again, 2 octaves up, offset by a beat (echo), plus the magic sparkle_up at 6.75' }],
    processors: [{ id: 'tapeWobble', opts: { wow: 0.0038, flutter: 0.0009 } }, { id: 'reelHiss', opts: { levelDb: -46 } }, { id: 'vinylCrackle', opts: { levelDb: -44, rate: 12, big: 0.25 } }],
    reverb: { preset: 'chamber', wet: 0.18 },
    mixDb: { motif: 0, pad: -6, rhythm: -5, master: 2.5 },
  },
  lush_strings: {
    era: 'e1927', year: 1927, title: 'Lush legato strings (first sound era)',
    motif: { id: 'strings_high', opts: { vibScale: 1.1 }, hint: 'the motif as a singing violin line (E5 G5 A5 C6 or the E4.. octave in strings)' },
    pad: { id: 'strings', opts: { art: 'legato' }, hint: 'whole-bar chord pad (mid/low register), cellos hold the root' },
    rhythm: { id: 'strings_pizz', opts: {}, hint: 'light pizzicato on beats 2 and 4 (chord tones)' },
    extras: [{ role: 'low', id: 'strings_low', opts: {}, hint: 'root + fifth sustained' }],
    processors: [{ id: 'opticalSoundtrack', opts: { lo: 130, hi: 5800, mono: 0.6, sat: 1.15, hissDb: -48 } }],
    reverb: { preset: 'chamber', wet: 0.22 },
    mixDb: { motif: 0, pad: -4, rhythm: -9, master: 1.5 },
  },
  strings_harp: {
    era: 'e1939', year: 1939, title: 'Golden-age strings + harp + woodwinds (full colour)',
    motif: { id: 'strings_high', opts: { vibScale: 1.2, brightScale: 1.05 }, hint: 'warm singing violins on the motif' },
    pad: { id: 'strings', opts: { art: 'legato' }, hint: 'chord pad, wide voicing' },
    rhythm: { id: 'harp', opts: { ring: 2.8 }, hint: 'arpeggiated 8ths over the chord (use harpGliss at the bar line for glissandi)' },
    extras: [{ role: 'winds', id: 'flute', opts: {}, hint: 'windRun() scale runs into the bar line (10.5 chime_run)' }, { role: 'clar', id: 'clarinet', opts: {}, hint: 'doubling the lower motif octave' }],
    processors: [{ id: 'goldenAge', opts: { hi: 11500 } }],
    reverb: { preset: 'hall', wet: 0.26 },
    mixDb: { motif: 0, pad: -4, rhythm: -3, master: 1 },
  },
  brass_choir: {
    era: 'e1960', year: 1960, title: 'Epic brass + wordless choir + timpani (widescreen)',
    motif: { id: 'horns', opts: {}, hint: 'noble horns state the motif (E3 G3 A3 C4 or an octave up)' },
    pad: { id: 'choir', opts: { vowel: 'o>a', singers: 6 }, hint: 'ooh-to-aah chord swells, whole-bar' },
    rhythm: { id: 'timpani', opts: {}, hint: 'timpani on the chord roots (A2 F2 C3 G2): beat 1 + 3 hits, a roll into the dive beat' },
    extras: [{ role: 'low', id: 'brass_low', opts: {}, hint: 'trombone/tuba pedal on the root' }, { role: 'strings', id: 'strings_low', opts: {} }],
    processors: [{ id: 'warmTape', opts: { drive: 1.25, hfHz: 13000, lowDb: 1.5 } }],
    reverb: { preset: 'bigHall', wet: 0.3 },
    mixDb: { motif: 0, pad: -4, rhythm: -3, master: -1 },
  },
  heroic_fanfare: {
    era: 'e1977', year: 1977, title: 'Heroic brass fanfare + snare rolls',
    motif: { id: 'trumpets', opts: { art: 'sustain' }, hint: 'bright trumpets on the motif (E4 G4 A4 C5), sforzando on beat 1' },
    pad: { id: 'horns', opts: {}, hint: 'horn chords under the trumpets' },
    rhythm: { id: 'snare', opts: { variant: 'crack' }, hint: 'drumRoll() snare rolls into each downbeat + march pattern; timpani on the roots' },
    extras: [{ role: 'timp', id: 'timpani', opts: {} }, { role: 'low', id: 'brass_low', opts: {} }, { role: 'strings', id: 'strings_ostinato', opts: {}, hint: 'driving 8ths/16ths in the bed' }],
    processors: [{ id: 'warmTape', opts: { drive: 1.3, hfHz: 12000 } }, { id: 'tapeWobble', opts: { wow: 0.0015, flutter: 0.0003 } }, { id: 'reelHiss', opts: { levelDb: -50 } }],
    reverb: { preset: 'hall', wet: 0.26 },
    mixDb: { motif: 0, pad: -4, rhythm: -4, master: -1 },
  },
  synth_orch: {
    era: 'e1993', year: 1993, title: 'Synth-orchestra hybrid',
    motif: { id: 'fm_bell', opts: {}, hint: 'FM bell states the motif one octave up (E5 G5 A5 C6)' },
    pad: { id: 'synth_pad', opts: {}, hint: 'analog pad on the chords' },
    rhythm: { id: 'snare_gated', opts: {}, hint: 'gated snare on 2 and 4, kick on 1 and 3; supersaw stab on the chord at beat 1' },
    extras: [{ role: 'stab', id: 'supersaw', opts: {} }, { role: 'kick', id: 'kick', opts: { variant: 'tight' } }, { role: 'bass', id: 'synth_bass', opts: {} }, { role: 'strings', id: 'strings', opts: { art: 'legato' } }],
    processors: [{ id: 'brickwallBright', opts: { airDb: 1.5, driveDb: 0.8 } }],
    reverb: { preset: 'plate', wet: 0.2 },
    mixDb: { motif: 0, pad: -4, rhythm: -2, master: -1.5 },
  },
  braams_taiko: {
    era: 'e2009', year: 2009, title: 'Trailer braams + taiko',
    motif: { id: 'brass_low', opts: { driveScale: 1.3 }, hint: 'low distorted brass states the motif (E2 G2 A2 C3 or an octave up)' },
    pad: { id: 'strings_tremolo', opts: { section: 'low' }, hint: 'dark tremolo bed on the root' },
    rhythm: { id: 'taiko', opts: {}, hint: 'taiko on beats 1, 2.5, 3, 4 (driving), flams into the dive beat' },
    extras: [{ role: 'braam', id: 'braam', opts: {} }, { role: 'riser', id: 'riser', opts: {} }, { role: 'sub', id: 'sub808', opts: {} }, { role: 'impact', id: 'impact', opts: {} }],
    processors: [{ id: 'brickwallBright', opts: { airDb: 2.2, driveDb: 1.8 } }],
    reverb: { preset: 'bigHall', wet: 0.24 },
    mixDb: { motif: 0, pad: -5, rhythm: -2, master: -3.5 },
  },
  lofi_phone: {
    era: 'e2025', year: 2025, title: 'Lo-fi phone beat',
    motif: { id: 'piano', opts: { variant: 'felt', tuneScale: 0.6 }, hint: 'felt-piano motif, laid back (a few ms late)' },
    pad: { id: 'synth_pad', opts: { brightScale: 0.7, attack: 0.5 }, hint: 'soft pad, very low' },
    rhythm: { id: 'snare', opts: { variant: 'dusty' }, hint: 'boom-bap: kick(soft) on 1 and 2.5, dusty snare on 2 and 4, swung hats' },
    extras: [{ role: 'kick', id: 'kick', opts: { variant: 'soft' } }, { role: 'hat', id: 'hat', opts: {} }, { role: 'bass', id: 'sub808', opts: { decay: 0.6, drive: 1.6 } }],
    processors: [{ id: 'lofiPhone', opts: { lo: 400, hi: 4000, bits: 11, rate: 16000, drive: 0.35 } }, { id: 'vinylCrackle', opts: { levelDb: -36, rate: 26 } }],
    reverb: { preset: 'room', wet: 0.1 },
    mixDb: { motif: 0, pad: -7, rhythm: -2, master: 1.5 },
  },
};
