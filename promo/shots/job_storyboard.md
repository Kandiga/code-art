# job_storyboard — STORYBOARD (28.0 – 30.0)

Look: a different set-up from SCRIPT — cool "drafting room": cool-white key from the front-left (visible cone + dust), amber rim from
behind-right, teal/violet/white practical bokeh, distant chair, glossy floor with a cool light pool under the grid. Lens 35 mm
(vfov 24°), constant-speed dolly-in (z 6.5 → 5.2, y 1.0 → 1.25) with a 0.5 m lateral swoop on the pop so the diorama layers parallax.
Amrita on the left third facing the grid (eyes on the left third line), stylus in hand, slate hidden (it would sit in the grid).
The 3x2 grid floats in front of her (centre x +1.0, z +0.3, 0.94 x 0.53 m panels, 0.13 m gaps) and never covers her face; the
label zone (bottom-left) holds only floor + haze. DOF: focus on the Amrita/grid mid-plane (strength 0.6) so the thumbnails stay crisp.

Panel art (S.pencil, 4 layers each = parallax cards): 1 the night train (headlamp, smoke) · 2 sleepy crescent moon over rooftops · 3 a winding
road to a sunset with signpost · 4 a ringed planet + saucer ship · 5 a friendly horned creature in a forest · 6 a big heart framed by red curtains.

| time (s) | lt | action | SFX (cues.js + cues_extra) |
|---|---|---|---|
| 28.000 | 0.00 | HIT (S) cut-in: Amrita watches six amber corner-bracket "ghost cells" already glowing; stylus ready | label_tick · swipe (extra) |
| 28.0 → 28.25 | 0–0.25 | panel 1 is dealt from the stylus tip: accelerating bezier throw (spin + scale 0.2 → 1), motion-blurred | |
| 28.25 + 0.125k (k = 0…5) | 0.25 + 0.125k | **snap** k: panel lands exactly on the beat (row-major: train, moon, road / planet-ship, creature, heart); z-bump + 6 % scale overshoot (36 Hz decay 55 ms), cool-white frame flash, amber light-lip flash, bracket flash, ring + 16 sparks; Amrita nods, stylus flicks | panel_snap x6 |
| 28.875 → 29.5 | 0.875–1.5 | grid complete, gentle float; ghost brackets consumed; Amrita smiles; dolly keeps pushing in | |
| 29.500 | 1.50 | **POP** (stagger 25 ms per panel): frame extrudes to a 0.5 m deep shadow box (outBack overshoot), thumbnail splits into 4 parallax cards (z −0.26 … +0.20 m, far cards dimmed), cards flash, 26 sparks per panel, big shock ring, radial whoosh speed-lines (masked away from the label zone), bloom + 40 % kick, 3.5 % FOV punch; panels fan inward (yaw ±0.2) and sway; Amrita startles then smiles | panel_pop_3d |
| 29.5 → 30.0 | 1.5–2.0 | lateral camera swoop reveals parallax between cards; sparkle glints; poster frame: Amrita (happy) + six glowing shadow-box dioramas | sparkle_up (29.625, extra) |

Notes: titles are engine-drawn (STORYBOARD, zone `label`, x 110–870 / y 760–950): nothing but floor/haze there. All motion is a pure function
of `T.t`; thumbnails are drawn once at setup from seeded pencil calls. The scene imports the light/FX kit exported by `job_script.js`.
