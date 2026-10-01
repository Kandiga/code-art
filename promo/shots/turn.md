# shots/turn.md — THE TURN (22.0–26.0, 3D, render 16:9 -> letterbox animates to 2.39 between 23.0 and 24.0)

Format: **time · lens · camera · action · text · SFX**. Camera/lens are in `web/engine/scenes/turn.js` (`CAM` keys); everything is a pure function of `T.t`.
Stage metres, +Y up, chair at the origin facing +Z. The paper is a 1.34 x 0.75 m sheet 1.3 m in front of the lens at the freeze.

| time | lens | camera | action | text | SFX |
|---|---|---|---|---|---|
| 22.0–22.4 | 35 mm | LOCKED on the paper, paper plane fills the 16:9 view exactly (shader inverts ACES: first 3D frame == last 2D frame). Focus = paper. No jitter, no bloom, nothing moves. | the frozen Act-I frame (S.act1Frame(21.9999)) as a REAL textured paper plane: paper tooth + soft light on the print fade in | — | silence (22.0–22.5) |
| 22.4–22.5 | 35 mm | locked | hairline crack of light grows from the centre (anticipation) | — | silence |
| 22.5 | 35 mm | locked, +4.5 cm punch-in kick on the L hit | HIT L: five seeded jagged cracks burst out of the centre (front speed ~15 m/s), white-hot seam through the torn fibres, light burst + rays behind the sheet | VO "Now it takes one director." (22.5) | sub_drop, paper_tear |
| 22.5–23.2 | 35 mm, slow dolly | dolly 0.3 m in | the five pieces PEEL like petals/aperture blades: a fold line sweeps outward along each piece (page-curl bend about the line, cream back with ghosted print, white fibre rim, thin outer edge), flaps twist and flutter; the burst light dies down to dark stage + haze | — | paper_tear (to 24.0) |
| 23.0–24.2 | 35 -> 37 mm | dolly + crane-down toward the chair; letterbox 16:9 -> 2.39 (engine) | pieces release, tilt up toward the lens and fly away past the camera (never closer than 0.9 m to the lens), DOF racks focus from the paper to the chair (23.2–23.95) | — | paper_flutter (23.0–24.5) |
| 24.0 | 37 mm | HIT M kick | the SPOT ignites on the director's chair: flicker-on, analytic volumetric cone + 340 dust motes, floor pool | — | spot_clunk, beam_hum (extra) |
| 24.1–24.5 | 37 -> 40 mm | push-in | empty chair in the cone; Amrita peeks in from the top of the frame, eyes closed, pulls UP (anticipation, squash) | — | — |
| 24.5–25.0 | 40 -> 44 mm | push-in | Amrita DROPS (stretch on the fall, motes pulled down) | — | whoosh_down |
| 25.0 | 44 mm | HIT L kick; hero: Amrita right third (eyes on the upper third line), chair left third | LANDS (squash on the floor, shock ring + dust puff, rim light pops on, chair swivels); eyes: blink -> determined (25.1–25.45) -> happy ^^ (25.5) | **Meet Amrita.** (engine, zone `lower`; face + chair stay above y=800) | land_thud, title_hit, eyes_open (25.125, extra) |
| 25.5–26.0 | 44 -> 50 mm | slow push-in | hover + settle, slate floats at her right | — | sparkle_up (25.5, extra); piano C5 25.5 |

Cue notes: no extra SFX before 22.5 (digital silence). cues_extra/turn.js adds beam_hum 24.0, eyes_open 25.125, sparkle_up 25.5 (existing recipes).
