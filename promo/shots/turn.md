# shots/turn.md — THE TURN (22.0–26.0, 3D, render 16:9 -> letterbox animates to 2.39 between 23.0 and 24.0)

Format: **time · lens · camera · action · text · SFX**. Camera/lens are `CAM` in `web/engine/scenes/turn.js`; everything is a pure function of `T.t`.
Stage metres, +Y up, chair at the origin. The paper is a 1.34 x 0.75 m sheet, 1.3 m in front of the lens at the freeze (so the
fibres, curls and light seams are physically sized). The sheet is torn into 5 pieces by 5 seeded jagged cracks radiating from the centre.

| time | lens | camera | action | text | SFX |
|---|---|---|---|---|---|
| 22.0–22.4 | 35 mm | LOCKED (8.4 m from the chair, 1.55 m high), focus = paper, no jitter, no bloom. Paper plane fills the 16:9 view exactly; shader inverts ACES so the first 3D frame == the last 2D frame (mean abs diff 0.1/255) | the frozen Act-I frame `S.act1Frame(21.9999)` as a real textured paper plane; nothing moves | — | digital silence (22.0–22.5) |
| 22.4–22.5 | 35 mm | locked | hairline crack of light grows out of the centre (anticipation) | — | silence |
| 22.5 | 35 mm | locked, +4.5 cm punch-in kick (T.impact) | HIT L: 5 jagged cracks burst from the centre (fronts ~15 m/s), white-hot seam through the torn white fibres, burst light + rays behind the sheet, scraps thrown out | VO "Now it takes one director." | sub_drop, paper_tear |
| 22.5–23.2 | 35 mm | slow dolly (0.2 m in 1 s) | each piece PEELS back like a petal / aperture blade: a fold line sweeps outward (page-curl bend about the line, cream back with the print ghosting through, white fibre rim, cut outer edge), flaps twist + flutter; the burst light decays to a dark hazy stage seen through the 5-petal hole (chair far away, blurred) | — | paper_tear (to 24.0) |
| 23.0–24.0 | 35 -> 37 mm | dolly + crane-down; letterbox 16:9 -> 2.39 (engine); DOF racks from the paper (1.3 m) to the chair (23.2–23.95) | petals hold + flutter, then release, tilt up and fly out past the lens (never closer than 0.5 m to the camera); the stage is dark for 0.3 s | — | paper_flutter (23.0–24.5) |
| 24.0 | 37 mm | HIT M kick | the SPOT ignites on the director's chair: flicker-on flash, analytic volumetric cone, 340 dust motes, floor pool; the LED tubes / cyc wash of the stage start to breathe | — | spot_clunk, beam_hum (extra) |
| 24.0–24.5 | 37 -> 40 mm | push-in | empty chair in the cone; light swells at 24.35–24.5 (anticipation: the beam brightens, motes lift) | — | — |
| 24.5–25.0 | 40 -> 44 mm | push-in | Amrita DROPS from above the frame (stretch, accelerating; her shadow only appears near the floor) | — | whoosh_down |
| 25.0 | 44 mm | HIT L kick; hero: Amrita right third (eyes on the upper-third line), chair left third | LANDS exactly at 25.0 (squash on the floor, shock ring + dust puff, rim light pops on, the chair swivels); eyes: blink -> determined (25.1–25.45) -> happy ^^ (25.5) | **Meet Amrita.** (engine, zone `lower`; faces + chair stay above y=800) | land_thud, title_hit, eyes_open (25.125, extra) |
| 25.5–26.0 | 44 -> 50 mm | slow hero push-in (5.9 m) | hover + settle, slate floats at her right | — | sparkle_up (25.5, extra); piano C5 25.5 |

Cue notes: no extra SFX before 22.5 (digital silence). `shared/cues_extra/turn.js` adds beam_hum 24.0, eyes_open 25.125, sparkle_up 25.5
(all existing recipes). Motion on the grid: 22.5 tear, 24.0 spot, 24.5 drop, 25.0 land, 25.5 expression change = the piano motif E G A C.
