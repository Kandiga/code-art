# coldopen — 0.0-4.0 s · 16:9 · grade `projector` · kind 2d (Canvas, drawn: paper / pencil / hatch / 12 fps boil)

Idea: *Every film starts with a blank page.* A lamp strikes in the dark, a single hatched beam finds a big sheet of paper on a dark table,
and Amrita sketches herself onto it — then opens her eyes. The light floods white; hard cut to 1895 (white-out -> iris-in).

| time | lens / camera | action | text | SFX / beat |
|---|---|---|---|---|
| 0.0-1.0 | locked, 50 mm | near-total darkness. Only the film gate lives: a faint pencil-drawn gate frame with corner ticks, a ghost leader circle + cross-hair, two columns of sprocket holes glowing and scrolling up (speed ramps with the motor spin-up 0-2 s); grade flicker. 0.55-1.0 a dull orange filament glow warms the upper-left corner | — | 0.0 `projector_motor` (spins up) |
| 1.0 | | **lamp strikes**: first frame is a blown-out flash (1.55x), then 10 stuttering arc-flicker frames (30 fps table: dips to 0.22-0.3 at 1.033 / 1.1) and a steady beam with a 0.01 hum shimmer | — | 1.0 `lamp_ignite` + `beam_hum` |
| 1.0-1.5 | slow 3 % push-in (whole 4 s) | ONE beam from the upper-left: soft haze wedge (28 thin slices, bell profile) + 54 pencil rays fanning from the lamp + hot bloom in the corner; ~120 dust motes (seeded pencil specks with a faint graphite ring so they read on the paper too) drift/twinkle in the cone. It lands on a large tilted sheet (bowed edges, fold crease, doubled ink outline) on a dark wood table; the pool of light has hatched graphite fall-off, corners/edges drop into darkness | — | |
| 1.5-3.0 | | the sheet is blank (VO). Title is written by the engine on the sheet's lower part (zone `lower`, y 800-930): the sheet extends under it so the graphite lettering reads on lit paper | `Every film starts with a blank page.` (engine) | 1.5 VO 1 |
| 2.0-3.0 | | **Amrita sketches herself**: 2.0 compass circle swings round, 2.1 six spokes + inner circle + cross-hair (faint construction), 2.25-2.8 the six aperture blades trace on one by one, 2.68-3.0 the play-triangle traces on. Everything is partial-path ink (writes on) | | 2.0 `pencil_scratch` (extra cue) |
| 3.0 | | **`eyes_open`**: two glossy black ovals pop open (slit -> wide, overshoot), a starburst of 14 pencil "ding" ticks pops out round the disc; 3.34 blink; 3.5 she looks up toward the light (up, a touch right); eyes widen for wonder | | 3.0 `eyes_open` (+ piano E4) |
| 3.05-3.6 | | colour blooms into the sketch: flat offset fill + coloured-pencil hatch in the blades (vermilion / amber), cream plate, outline inks in | | |
| 3.5-4.0 | | the beam widens (half-angle 24 -> 64 deg), the pool of light grows x2.9, the lamp overexposes: paper floods white-warm (grade vignette and exposure follow). Her eyes are the last thing visible: two black ovals on white (fade 3.8-3.97). 3.97 = pure white-warm. **Hard cut** to 1895 on 4.0 (black frame + glowing iris dot) | title still on screen until 4.0 | 3.5 `riser_short` |

Safe zones: nothing but the sheet's blank paper under y 790 except the engine title; no HUD in the cold open.
Perf: ~15-40 ms per frame at scale 0.5 (2D canvas), no per-frame allocation beyond small arrays.
