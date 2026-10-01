# TREATMENT & SHOT LIST — "130 years of cinema → one director"

60.0 s · 120 BPM · beat 0.5 s · bar 2 s · 30 fps · `shared/cues.js` is the clock for everything.
Logline: the history of filmmaking flashes by in one minute — 1895 → 2150 — and at **NOW** a single AI director
takes the chair: **Amrita**.

## Look bible (read before touching a scene)

### Act I — the past is DRAWN (0:00–0:22)
* World = **paper & pencil**. Off-white paper texture, **flat offset color fill** (slightly mis-registered from the
  outline), **colored-pencil hatching**, **doubled wobbly ink outline** (two passes, different jitter), hand-lettered
  captions. Everything animates at **12 fps "boil"** (`T.boil`): jitter seeds change 12×/s, never every frame.
* Each era also changes the **frame**: aspect-ratio matte (`ERAS[i].ratio`, bars animate in over 0.25 s), color
  process (grade preset), grain, flicker, scratches. The engine draws the matte + grade; the scene composes inside
  `T.frame`.
* Transitions are **dive-throughs**: the era's focal object (the `portal`) is drawn at `(cx,cy,r)` and the engine zooms
  into it while the next era appears inside. So the focal object must be a strong, centered, readable circle/shape.
* Palette: `BRAND.palette`. Ink lines are `graphite`/`ink`, never pure black outlines at full opacity in color eras.

### Act II — the future is DIRECTED (0:22–0:54)
* A real **3D cinematic soundstage**: dark cyc, glossy floor, truss and lights, haze, volumetric beams.
* three.js, **ACES** tone mapping, physically based lights, **volumetric beams**, bloom ≈ 0.4, **depth of field on
  every shot (focus on what the shot is about)**, 4-subframe motion blur, **2.39:1** letterbox, light grain + vignette.
* Camera language: crane-downs, dolly-ins, low-angle hero shots, over-the-shoulder, slow orbits, whip-pans on beats,
  push-ins on reveals, **small impact shakes on hits** (`T.impact`). Camera always in clear space — never inside
  props/walls/crowds; subject's eyes on screen thirds.
* Units: meters, +Y up, camera looks toward −Z by default. Stage floor y=0. Amrita = disc Ø 1.0 m (R=0.5) hovering
  0.55 m above the floor with a soft contact shadow; her face (play-triangle) faces +Z, yawed 25–35° to camera.
* Rim light on Amrita in every shot.

### Typography
Titles are drawn by `web/engine/titles.js` from `TITLES` (zones in a fixed 1920×1080 space, 90 % safe area). One idea
per title, readable in 1.5 s. Overlays never collide with each other or with Amrita's face — scenes must keep their
own faces out of title zones (`lower`, `label`, `endTitle`…; see titles.js).

## Shot list

Format: **time · lens · camera · action · on-screen text · SFX cue**

### COLD OPEN `coldopen` (0.0–4.0)
* 0.0 black. Projector motor (SFX `projector_motor`) spins up; a film-gate flicker begins in total darkness.
* 1.0 lamp ignites (`lamp_ignite`): ONE beam (dust motes, drawn) hits a blank sheet of paper. Beam is a drawn cone with
  hatched dust. Locked-off, 50 mm, slow 3 % push-in.
* 1.5 **VO 1** + hand-lettered title writes itself (zone `lower`): "Every film starts with a blank page."
* 3.0 `eyes_open`: two black ovals appear on the page — Amrita sketches into existence, eyes OPEN in the light (soft
  blink, looks up-right toward the beam). Piano note E4.
* 3.5–4.0 beam widens; frame irises to the 1895 aspect (hand-off to `e1895`).

### THE PAST — 9 eras × 1 bar (each: matte slides in at t0; focal-object dive in the last beat)
| # | t0 | era | picture (generic homage, no IP) | ratio / grade | prop | portal | events |
|---|---|---|---|---|---|---|---|
| 1 | 4 | 1895 `e1895` | a train arriving at a station platform, coming head-on, lamp growing; platform folk as simple pencil shapes; Amrita on the platform cranking her little camera | 1.33 · B&W flicker, scratches, iris-in | hand-crank | lens = locomotive headlamp | 4.0 iris_click · 4.25 chuff · 4.75 whistle |
| 2 | 6 | 1902 `e1902` | stage magic: painted crescent moon with a sleepy face, stars on strings, curtains swing open, Amrita pops in with a puff of smoke, confetti | 1.33 · sepia tint | hand-crank | eye = the moon's eye opens | 6.0 curtain · 6.5 poof · 6.75 sparkle |
| 3 | 8 | 1927 `e1927` | silent-film **intertitle card** (hand-lettered, ornate border) → cut → Amrita faces the screen and a speech balloon appears: the **first spoken word** ("Hello!") | 1.37 · B&W, cleaner; slight warm after the word | megaphone | screen (rounded rect, r = half-width) | 8.0 card_thunk · 9.0 `vo_hello` |
| 4 | 10 | 1939 `e1939` | the world floods with color: a winding road through candy-saturated hills toward a crystal castle with a round window (original design — not any known film) | 1.37 · three-strip saturation | megaphone | porthole = castle's round window | 10.0 color_bloom · 10.5 chime_run |
| 5 | 12 | 1960 `e1960` | widescreen **desert epic**: huge sun, dune ridges, a caravan of tiny silhouettes, wind; bars open to 2.20 | 2.20 · 70 mm warmth | viewfinder | lens = the sun disc with flare | 12.5 horn · 13.0 wind |
| 6 | 14 | 1977 `e1977` | **space opera with practical models**: a cardboard-and-glue starship on visible strings crossing a star-drawn sky, laser bolts, a pencil-scribble explosion (nothing resembling any known ship) | 2.39 · 70s grain, warm | viewfinder | porthole = ship's viewport | 14.5/14.75/15.0 laser_zap · 15.0 explosion |
| 7 | 16 | 1993 `e1993` | the **first CGI creatures**: a wireframe four-legged creature (original) walks across a clean grid floor, wireframe → flat-shaded → shaded (scan sweep); crisp, digital, no grain | 1.85 · clean digital | clapperboard | eye = the creature's eye | 16.5 scan · 17.0 roar · **VO 2 begins 16.0** |
| 8 | 18 | 2009 `e2009` | **3D glasses & IMAX dome**: audience POV in a dome; objects pop out of the screen toward camera; red/cyan fringe; Amrita wears giant 3D glasses | 1.43 · teal-orange | clapperboard | lens = glasses' right lens | 18.5 pop_out · 19.0 imax_boom |
| 9 | 20 | 2025 `e2025` | **vertical phone video**: the frame physically **squeezes to 9:16** (0.25 s); phone UI (record dot, hearts flying, comment bubbles, a swipe); Amrita holds a glowing slate | 9:16 · phone | neural slate | phone (no dive) — HUD slams **NOW** at 21.5, **freezes at 22.0** | 20.0 squeeze · 20.5 tap · 20.75 ping · 21.0 swipe · 21.25/21.375 heart_pop |

Bottom **HUD** (hud.js): film-strip timeline with sprocket holes, era frames, playhead; big running **year counter**
(`yearAt`); era caption top-left (`ERAS[i].caption`), hand-lettered in Act I. HUD is part of the Act I frame (it tears
away with the paper at the turn). In the future (42–50) the HUD returns in digital form (teal) and the counter *jumps*.

### THE TURN `turn` (22.0–26.0, 3D, render 16:9, bars fold 16:9 → 2.39 by 24.0)
* 22.0 **freeze** (everything stops mid-frame). 22.0–22.5 **total silence**.
* 22.5 `sub_drop` + HIT: the frozen Act-I frame is a **real textured paper plane in 3D**; it **tears** (jagged seeded
  tear line, torn white fibre edge) and the pieces **fold/curl away** (22.5–24.0), revealing a **dark soundstage** and a
  **director's chair** in a spotlight ignites at 24.0 (`spot_clunk`). VO 3a "Now it takes one director." (22.5)
* 24.5 Amrita **drops in** from above (stretch), lands at 25.0 on a beat with squash, chair swivels, rim light pops.
  **Title "Meet Amrita."** (zone `lower`) + VO 3b at 25.0. Solo piano motif: E 24.0 · G 24.5 · A 25.0 · C 25.5.
* Lens 35→50 mm, dolly-in; whip-free; HIT shake at 22.5, 24.0, 25.0.

### AMRITA DIRECTS `job_*` (26.0–42.0) — 8 jobs × 1 bar, one-word label at each downbeat (zone `label`)
Each job = one location/camera set-up on the soundstage, a signature action (below), a hit on the downbeat, and 3 action
beats. Camera cuts on every downbeat.
| job | t0 | signature action | beats |
|---|---|---|---|
| SCRIPT | 26 | words **type themselves in the air** (8 words = 8 `typewriter_key` at 26.0+0.125k), glowing letters hover, then **fold into a script** (27.0 bell, 27.25 fold, 27.5 snap: a bound script floats to Amrita). VO "She writes." | low-angle, 50 mm |
| STORYBOARD | 28 | **6 panels snap into a grid** (28.25+0.125k), sketch frames of the film; at 29.5 they **pop into 3D** (extrude + whoosh) | dolly-in, 35 mm |
| CAMERA | 30 | virtual **cranes and drones fly into position** (30.0 servo, 30.25 buzz), 31.0 **viewfinder overlay** (corner brackets, rec dot, focus box), 31.5 focus beep. VO "She shoots." | crane-down, 24 mm |
| LIGHT | 32 | she **paints light** (brush stroke of light 32.0–32.5), then **key (32.5), fill (33.0), rim (33.5) snap on** with clunks; the set pops into shape | low-key → lit, over-the-shoulder |
| CAST | 34 | **5 stylized ICON characters (shapes with eyes — NO people)** step onto their marks at 34.25…35.25 (foot_tap), 35.5 cast_ready | wide, 28 mm |
| SCORE | 36 | an **orchestra made of light** (particles forming stands, instruments, players) assembles (36.0 tune-up swell); **she conducts the very soundtrack** — baton down at **37.0 = orchestra hit**. VO "She scores." | orbit, 40 mm |
| EDIT | 38 | a **timeline slides in** (38.0); **6 shots snap together on the beat** (38.25+0.25k clicks), playhead zips 39.75. VO "She cuts." | push-in, 50 mm |
| COLOR | 40 | a **grade wipe** sweeps the frame (40.0–41.0, shimmer), the set transforms from flat to graded teal-orange/gold at 41.0 flash | whip-pan, 35 mm |

### THE FUTURE SHE DIRECTS (42.0–50.0)
* 42.0 `year_jump` → **2050 `f2050` HOLOGRAM CINEMA** (1 bar): a cozy living room, a hologram film blooming above a
  coffee table; the family are **abstract silhouettes/icon characters**; Amrita as a hologram on the table.
* 44.0 → **2100 `f2100` NEURAL CINEMA** (1 bar): a head-profile silhouette from which light ribbons flow and **paint a
  scene from thought**; Amrita conducts the ribbons.
* 46.0 → **2150 `f2150` DREAM CINEMA** (2 bars): vast dreamscape; the **audience is physically inside the story, made of
  particles of light**; slow orbit; climax at 48.0 (audience stands, cheer). **VO 5** at 46.0.
* HUD (digital, teal) shows 2050 / 2100 / 2150 and the caption.

### RECAP `recap` (50.0–54.0) — Droste
* A large cinema: audience seen from behind (icon silhouettes), a **giant screen** showing **this very ad replaying at
  high speed** (frames of the film itself, read back from the render cache; deeper recursion arrives naturally because
  late frames contain the screen), applause swell, riser. 53.0 **push in through the screen** (`push_whoosh`).

### END CARD `endcard` (54.0–60.0)
* 54.0 logo resolve out of the screen glow (aperture blades close/open to the play-triangle; **Amrita's mark**).
  54.5 `AMRITA CINEMA STUDIO` (wordmark). 56.5 tagline (placeholder). 57.0 `Directed by Amrita` (small).
  57.5 CTA (placeholder chip). **58.0 FINAL HIT** (flash + shake + mark pulse, on the orchestral hit).
  58.0–59.5 hold + 2 s music tail (reverb); 59.5 projector click-off → quick light flicker to black.

## Prop evolution
hand-crank camera (1895, 1902) → megaphone (1927, 1939) → viewfinder (1960, 1977) → clapperboard (1993, 2009) → glowing
neural slate (2025 → forever). In Act II the slate floats beside her in every shot.

## Audio plan (see `shared/cues.js` → `MUSIC`, `SFX`, `VO`, `CROWD`)
One motif (E G A C), one chord loop (Am F C G), one tempo, re-orchestrated by era; stems stack through the jobs; the
future resolves to full major; final C-major hit at 58.0 with a 2 s tail. VO ≥ 6 dB over everything underneath; music
ducks 8–10 dB under VO, crowd 5 dB. Crowd = individual voice clips + individual hand-claps. −14 LUFS, −1.5 dBTP.
