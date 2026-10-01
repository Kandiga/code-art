# BRAND.md — Amrita Cinema Studio (promo film)

## What the project contained

**Nothing.** The repository `kandiga/code-art` was completely empty when this work started (no commits on any branch,
no README, no `/public`, `/assets`, design tokens, logo, fonts, landing page or copy), and a filesystem search for
brand material found only unrelated tooling files. Therefore **no brand asset was found, and none was invented as
fact.** Everything below is either (a) canon taken verbatim from the production brief, or (b) a clearly flagged
**PROPOSAL / PLACEHOLDER** that must be replaced when real assets exist.

> The `anthropic-skills:brand-guidelines` skill on this machine is *Anthropic's* brand, not Amrita's. It was deliberately **not** used.

## (a) Canon — from the brief

| Item | Value |
|---|---|
| Product name & casing | **Amrita Cinema Studio** (wordmark set in caps: `AMRITA CINEMA STUDIO`) |
| Persona | **Amrita** — an AI agent who directs films end to end. Pronoun: *she*. |
| What she does | script, storyboard, camera, lighting, cast, edit, color, soundtrack (the eight jobs: SCRIPT · STORYBOARD · CAMERA · LIGHT · CAST · SCORE · EDIT · COLOR) |
| Credit line | `Directed by Amrita` |
| VO / copy | the eleven VO lines in `shared/cues.js` (`VO`) — all from the brief; tagline in VO 6b is the placeholder below |

## (b) PROPOSALS and PLACEHOLDERS (all flagged, all listed in README + final report)

| Item | Status | Value used | Where to change |
|---|---|---|---|
| **Tagline** | PLACEHOLDER (the brief's own stated fallback) | `Your story. Directed.` | `BRAND.tagline` in `shared/cues.js` (drives on-screen text **and** VO 6b) |
| **Website / CTA** | PLACEHOLDER — no URL exists | `[ YOUR URL HERE ]` (drawn inside a dashed placeholder chip so it reads as a placeholder) | `BRAND.cta` |
| **Logo / mark** | PROPOSAL — no mark exists | "Aperture-iris + play-triangle" mark (spec below), drawn procedurally; also exported to `brand/amrita-mark.svg` | `web/engine/amrita2d.js`, `web/engine/amrita3d.js`, `brand/` |
| **Brand colors** | PROPOSAL | see palette below | `BRAND.palette` |
| **Fonts** | PROPOSAL (all SIL OFL via `@fontsource`) | Bebas Neue (titles/wordmark), Inter (labels), Caveat (Act I hand lettering), Special Elite (typewriter/intertitle), Oswald (alt condensed) | `BRAND.fonts` |
| Era / future captions | creative copy, *not* brand claims | `THE TRAIN ARRIVES`, `STAGE MAGIC`, `THE FIRST WORDS`, `FULL COLOR`, `THE WIDESCREEN EPIC`, `SPACE OPERA`, `DIGITAL CREATURES`, `THE 3D BOOM`, `VERTICAL VIDEO`, `HOLOGRAM CINEMA`, `NEURAL CINEMA`, `DREAM CINEMA` | `ERAS[].caption`, `FUTURES[].caption` |

No features, numbers, awards, prices, customers or partners are claimed anywhere in the film. The only claim is the
brief's logline: *130 years of cinema → one director* ("For a hundred and thirty years…" = 1895 → 2025).

## Proposed palette (placeholder — swap when a real palette exists)

| Token | Hex | Role |
|---|---|---|
| ink | `#0E0D12` | black, letterbox, stage |
| graphite | `#2A2833` | secondary dark, ink lines on paper |
| paper | `#F2EBDC` | Act I paper |
| paperShade | `#E6DCC6` | paper shading |
| amber | `#FFB62E` | light, marquee, highlights |
| vermilion | `#F2542D` | Amrita's blades, accent |
| cream | `#FFF3D6` | Amrita's face plate (the play triangle) |
| teal | `#1FB5A6` | digital / future |
| violet | `#6B5BFF` | neural |
| sky | `#7CC4FF` | secondary light |

## Proposed mark — "Amrita Aperture" (PROPOSAL)

Amrita **is** the mark. She is an icon character, never a human: no limbs, no torso.

```
 R = 1 (disc radius, in "Amrita units")
 body      : disc, radius 1.00, extruded in 3D (thickness 0.28 + bevel 0.04)
 blades    : 6 pinwheel aperture blades, each rotated 60° (blade i at i*60°), vermilion→amber gradient,
             leaving a central opening of circumradius 0.62
 face      : cream rounded PLAY-TRIANGLE filling that opening — vertices at circumradius 0.60,
             angles 0°, 120°, 240° (tip points RIGHT = "play"), corner radius 0.10, raised 0.06 in 3D
 eyes      : two glossy black OVALS inside the triangle, each 0.15 wide × 0.25 tall,
             centers at (-0.08, ±0.17); white specular dot upper-left
 expression: eye shapes only — neutral, blink (scaleY→0.08), squint, happy arcs (^ ^),
             determined (flat upper lid slanted inward), surprised (round, bigger), sleepy
 motion    : squash & stretch on the whole disc; in flat renderings she yaws partly toward camera
             (~25–35°) so the mark always reads; she hovers (no feet); props float at her right
```

Why this works as both logo and character: the aperture ring is a recognisable cinema symbol; the play-triangle is the
"person" inside it; two black ovals make the triangle a face without any human anatomy.

**Era re-rendering (same character, different process):** B&W (1895) · sepia (1902) · B&W talkie (1927) ·
three-strip color (1939) · 70 mm warm (1960) · 70s grain (1977) · clean digital (1993) · teal-orange (2009) · phone (2025) ·
then glossy PBR 3D (Act II) and hologram / particle variants (futures).

**Prop evolution** (floats beside her, always the same hand-off): hand-crank camera (1895–1902) → megaphone (1927–1939) →
viewfinder (1960–1977) → clapperboard (1993–2009) → glowing "neural slate" (2025 → forever).

## Rules

* Every on-screen word comes from `shared/cues.js` (`BRAND`, `ERAS`, `FUTURES`, `JOBS`, `TITLES`).
* **No real film IP**: no copyrighted characters, studio logos, real actors, literal recreations of famous shots, or
  recognizable music. Homage through genre, era and technique only. (No rocket-in-the-moon's-eye, no famous
  staircases/roads/trench runs, no real film titles, no trademarked process names on screen.)
* Cast in the CAST job and every audience on screen are **stylized icon characters / abstract silhouettes** — no real people.
* All music is original (one motif, one chord loop). All voices are synthesized (Piper neural TTS + code), listed in README.
