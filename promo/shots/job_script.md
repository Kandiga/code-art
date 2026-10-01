# job_script — SCRIPT (26.0 – 28.0) · "She writes."

Look: warm amber / cream key, cool steel-blue rim, string-light bokeh, ghost light, haze + two volumetric cones. Lens 45 mm
(vfov 19°), camera very low (y 0.2–0.4 m), slow drift in (z 6.7 → 5.9) + 3.5 % FOV punch on the snap. Amrita on the right
third, face turned toward the words (lead room), glowing stylus floats at her left, slate at her right. Label zone
(bottom-left) is floor + haze only. DOF: focus = Amrita, racks to the page stack 27.0–27.1, back to Amrita + booklet 27.5–27.85.

Logline typed (8 words = 8 keys): **THE · LAST · NIGHT · TRAIN · LEAVES · FOR · THE · MOON** (Special Elite outlines, extruded; hero
words bigger/hotter, small words smaller). Two lines on a gentle concave arc (R = 5 m), each word yawed to face the arc centre.

| time (s) | lt | lens / camera | action | SFX (cues.js + cues_extra) |
|---|---|---|---|---|
| 26.000 | 0.000 | 45 mm, low, start x −0.3 | HIT (M): cut in on Amrita, stylus tip flashing. Word 1 "THE" punches in | label_tick · typewriter_key #1 |
| 26.125 → 26.875 | 0.125k | slow dolly in | one word per key: ghost typebar swings up from below and strikes (−0.075 s → 0), word slams from z +0.34 with 5.5 Hz / 0.5-damped overshoot, hot emissive flash 3.4× decaying in 70 ms, 18-spark burst, ring, halo; Amrita nods (squash −0.075) and her eyes track the word | typewriter_key #2…#8 |
| 27.000 | 1.000 | focus rack → stack | **bell**: all words flash white-hot, lift 0.15 m, ring (r 1.9 m), 14-spark burst each; Amrita startles (surprised eyes, stretch) | typewriter_bell |
| 27.03 → 27.3 | 1.03+ | | words flatten into thin strips (same width as the word) that grow into small glowing pages (page rectangles form), fly on swirling bezier paths (spin, tumble) and land staggered (12 ms) as an 8-sheet stack at the assembly point; each sheet's top-left corner creases (origami dog-ear) in flight | paper_flutter (27.125, extra) |
| 27.25 → 27.5 | 1.25–1.5 | | **fold**: the left half of every sheet swings up and over the right half (book-closing ripple, top sheet first, 9 ms stagger, 0.11 s each); front/back cover boards clamp in (accelerating) | page_fold (27.25) |
| 27.500 | 1.500 | 3.5 % FOV punch, bloom kick | **snap**: boards slam, booklet squashes, flash + two rings + 90 sparks; spine, 3 brass brads (30 ms apart) and 5 colour tabs (45 ms apart) spring on; Amrita bounces and smiles | page_snap |
| 27.52 → 27.9 | 1.52–1.9 | focus on booklet + Amrita | booklet floats beside her on a spring (1.5 Hz, ζ 0.5): arc lift 0.16 m, yaw −0.46 to show spine + tabs, grows to 1.35×; sparkle trail | sparkle_up (27.625, extra) |
| 27.9 → 28.0 | 1.9–2.0 | | idle hover + glints, poster frame: Amrita (happy) · SCRIPT booklet · stylus · slate | |

Perf notes: the 16 half-pages + flaps + cover are unlit MeshBasicMaterial (tinted per frame: warm glow, fold shading) because overlapping PBR pages cost ~4 CPU-s/frame; baked backdrop instead of the PBR cyc; light cones are front-face-only; no shadow maps (Amrita's contact shadow is a decal); stage.reflect() mirrors Amrita in the glossy floor.

Notes: titles are engine-drawn ("SCRIPT", zone `label`, x 110–870 / y 760–950): nothing but floor/haze sits there. All motion is a pure
function of `T.t` (4 sub-frames = motion blur). Kit (beams, dust, sparks, rings, glyph extrusion, env) is exported from the scene file
and re-used by `job_storyboard`.
