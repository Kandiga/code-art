# job_score — SCORE (36.0 – 38.0) · "She scores."

Look: warm gold / cream brass light against cool blue strings light, volumetric shafts from above, glossy stage floor mirroring the light-orchestra,
haze + dust motes. Lens 40 mm (vfov 21.4 deg, 2.39:1), ORBIT around the podium (azimuth +36 deg -> -6 deg, radius 9.6 -> 8.2 m, crane-down 4.3 -> 3.0 m),
look-at offset along camera-right so Amrita holds the right third. Pull-back of 0.3 m during the baton hang, then a SLAM push of 1.15 m on the hit
(+ 5 % FOV punch, positional shake from `T.impact`, 0.7 deg roll jolt). DOF: focus on Amrita (about 9 m), strength 0.5, max 9 px: the orchestra rows go
soft behind her. Bloom 0.38 base, kicked +0.36 for 70 ms on the hit.

The orchestra is `crowd3d.createOrchestraOfLight`: 30 light-person musicians (strings, cellos, flutes, brass, timpani, a harp) on three curved rows
(radius 2.8 / 4.05 / 5.3 m, arc 200 deg, risers) with music stands, made of light points that fly in from random positions; the conductor stands at the
group origin. A mirrored copy of the point cloud under the floor (shared uniforms, 3.2x brighter) gives the light reflections.
The label zone (bottom-left) only has floor, reflections and a few dim front-row sparks.

| time (s) | lt | camera | action | SFX / HIT |
|---|---|---|---|---|
| 36.000 | 0.00 | orbit start (right side, high) | HIT (S) + VO "She scores.": cut in on Amrita over her glowing podium ring in ONE gold shaft; the baton is lowered at her right; first sparks drift in the dark. She is **determined** | label_tick, orch_tune (swell begins) |
| 36.00 - 36.40 | 0.0-0.4 | | the baton RISES (pattern phase 2.2 -> 3.0 of Amrita's 4-beat conducting path, light trail follows); orchestra points start flocking in (stands + instrument silhouettes first, then bodies) | orch_tune |
| 36.40 - 36.84 | 0.4-0.84 | slow pull-back 0.3 m | the baton hangs at the top with a tiny tremor (anticipation); blue string-light shafts rise with the tuning swell; the orchestra is almost whole, bows begin to shiver (play 0.2 -> 0.5); Amrita squats (-20 %) | orch_tune |
| 36.84 - 37.00 | 0.84-1.0 | FOV 2 % tighter | the STROKE: pattern phase 3 -> 4 in 0.16 s with an accelerating curve (the trail stretches 2.3x), landing on the ictus exactly at 37.0; tip glow builds | |
| 37.000 | 1.00 | **push 1.15 m + FOV punch + shake + bloom kick** | **BAT ON DOWN = HIT (L)**: orchestra BURSTS (library hit: radial push, brightness, point shock ring), floor shock wave (additive decal, r -> 13 m), 3 camera-facing shock rings around Amrita (gold / white / blue), radial god-rays, flash at the baton tip + halo behind her, 250 sparks (tip, podium dust wave, blue strings burst), light ribbons surge (spiral around her, arch over the orchestra, swirl through the rows), the vertical column beam and all gold / blue shafts ignite. Amrita stretches (+30 % spring), eyes WIDE then radiant joy | baton_whoosh, HIT L |
| 37.04 | 1.04 | | peak white-hot frame (1-2 frames), structure still visible through the bloom | |
| 37.10 - 37.30 | 1.1-1.3 | push settles | rays + rings expand (r up to 8.5 m), orchestra plays (bows saw, bodies sway on `T.beat`), ribbons flow | |
| 37.500 | 1.50 | | beat 2 of the pattern: the baton swings LEFT, soft gold light-wave through the orchestra (floor decal + camera ring + orchestra intensity pulse + ribbons surge), Amrita bounces, eyes glance left | |
| 37.75 - 38.00 | 1.75-2.0 | | beat 3: baton swings RIGHT, blue pulse ring at 37.98; Amrita glances right; poster frame = glittering orchestra horseshoe, gold podium ring, Amrita radiant at the right third with her baton trail | label_tick 38.0 (EDIT) |

Notes: the baton hit time, the tune-up window and the L hit are read from `cues.HITS` / `cues.SFX` at setup. Baton motion uses Amrita's built-in
conductPath with a warped phase (`batonPhase`), so the ictus is the lowest point of the stroke at exactly 37.0 and beats 2 / 3 fall on 37.5 / 38.0.
The library burst can saturate the frame, so the orchestra's intensity is ducked to 36 % at the hit and recovers over 0.55 s. All motion is a
pure function of `T.t` (4 sub-frames = motion blur). Reuses the CAST kit (decals, sparks, rings) from job_cast.js.
