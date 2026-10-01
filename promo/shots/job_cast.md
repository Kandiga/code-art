# job_cast — CAST (34.0 – 36.0) · "She casts."

Look: dark soundstage, indigo/violet cyc wash with a warm pool, glossy floor that mirrors the cast, five colour spotlight shafts from the rig
(one per icon), distant bokeh practicals on the cyc, haze + dust lit inside the beams. Warm cream key from the left, cool blue top-back rim
(hung high so its floor reflection stays out of frame), a second warm rim only on Amrita. Lens 28 mm (vfov 29.9 deg, 2.39:1). Camera 2.9 m ->
2.4 m high, dollying in from z 9.0 -> 7.6 with a slow truck to the right; every landing puts a 1.5 cm "weight" dip on the camera and cast_ready
adds a 3 % FOV punch. DOF: focus on the cast / Amrita band (about 8.7 m), strength 0.45, max 8 px, so the bokeh lights and beams go soft.

Cast = five stylized ICON characters from `crowd3d.createIconCast` (glossy extruded star / heart / crown / bolt / moon with Amrita-style black
oval eyes; no limbs, no people) on five glowing spike MARKS laid in an arc that opens toward Amrita. Amrita sits at the right third (face
turned toward the cast, eyes snapping to each landing) with her clapperboard floating at her left and the director's chair behind her.
The label zone (bottom-left, x 110-870 / y 760-950) is empty floor + reflections.

| time (s) | lt | camera | action | SFX (cues.js + cues_extra) |
|---|---|---|---|---|
| 34.000 | 0.00 | wide, 28 mm, high-ish, start x 0 | HIT (S): cut in on the five dim marks (dashed target ring + gaffer cross) and five standby beams; icon 1 (star) is already free-falling in from the top-left, stretched and tumbling | label_tick |
| 34.25 | 0.25 | | **foot_tap 1 (pan -0.60)**: STAR lands on mark 1 — landing squash (-0.32, 3 Hz spring), tiny secondary hop, happy eyes for 0.4 s, camera-facing shock "dome" ring + second ring, floor shock ring + mark flash, 26 sparks, its amber beam ignites (0.07 s ramp, overshoot, settles). Amrita snaps her gaze to it, squashes -7 % and ticks the clapper | foot_tap |
| 34.50 | 0.50 | | **foot_tap 2 (-0.30)**: HEART lands on mark 2 (same grammar, vermilion) | foot_tap |
| 34.75 | 0.75 | | **foot_tap 3 (0.00)**: CROWN on mark 3 (violet) | foot_tap |
| 35.00 | 1.00 | slow dolly in continues | **foot_tap 4 (+0.30)**: BOLT on mark 4 (teal) | foot_tap |
| 35.25 | 1.25 | | **foot_tap 5 (+0.60)**: MOON on mark 5 (sky blue); all five beams are now up | foot_tap |
| 35.36 - 35.50 | 1.36 | | anticipation: all five crouch (-0.28), Amrita lifts the clapper stick | |
| 35.500 | 1.50 | 3 % FOV punch, camera dip, bloom kick | **cast_ready**: all five jump (0.30 m, stretch -> squash) and strike a pose (yaw + roll, happy eyes, emissive flash); every mark flashes white-hot with a second shock ring, rim + key + beams flare, 34 sparks per mark, Amrita SNAPS the clapperboard exactly on the downbeat (squash -22 % spring, eyes: surprised -> happy) | cast_ready |
| 35.625 | 1.625 | | glitter on the pose burst | sparkle_up (cues_extra, -13 dB) |
| 35.55 - 36.00 | 1.55-2.0 | dolly to z 7.6 | held pose: beams breathe, icons groove on the beat, blink; Amrita happy. Poster frame = five icons posing on glowing marks under their colour shafts, Amrita + clapper + chair at the right third | label_tick 36.0 (next scene) |

Notes: titles are engine-drawn ("CAST", zone `label`). All motion is a pure function of `T.t` (4 sub-frames = motion blur). Landing times,
tap pans and the ready time are read from `cues.SFX` at setup (no hard-coded cue times). Mirrored reflections of Amrita and the icons come from
`stage.reflect`. Shared kit (marks decal, sparks, rings, env, beam brightness helper) is exported from the scene file and re-used by job_score.
