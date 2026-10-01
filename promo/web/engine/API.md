# Engine API — read this before writing any scene

Everything the film shows is `frame(t)`: a **pure function of time**. No `Math.random`, no `Date.now`, no state carried between
frames (frames render out of order, in parallel workers). Use `S.rng` / `rng.js` seeded hashing. Caches of geometry/textures
built from seeds are fine. Timing comes ONLY from `shared/cues.js` (never hard-code a time that is listed there).

Logical space for ALL 2D drawing is **1920×1080** (the engine pre-scales the context; output may be 1080p, 4K or a 0.5× preview).
90 % safe area: x∈[96,1824], y∈[54,1026].

## Files & ownership
```
shared/cues.js            timeline contract (DO NOT EDIT; add SFX/crowd events in shared/cues_extra/<yourSceneId>.js)
web/engine/main.js        orchestrator (DO NOT EDIT)      post.js grade.js overlay.js titles.js ease.js rng.js fonts.js pencil.js (engine, DO NOT EDIT)
web/engine/amrita2d.js    Amrita drawn (owner: amrita2d agent)     web/engine/hud.js (owner: hud agent)
web/engine/amrita3d.js    Amrita 3D (owner: amrita3d agent)         web/engine/stage3d.js, fx3d.js (owner: stage agent)
web/engine/crowd3d.js     icon cast + audience (owner: crowd3d agent)
web/engine/scenes/<id>.js one file per scene — YOU own yours, nothing else
shots/<id>.md             your shot list (time · lens · camera · action · text · SFX) for your scenes
```
Library APIs below are FROZEN: owners may add features and improve internals, never rename/remove/re-sign existing functions.
If you need something from a library that does not exist, build it locally inside your own scene file and mention it in your report.

## T — the per-frame time struct (2D `draw` and 3D `update` receive it)
`t` global seconds · `f` fractional frame · `scene` (cues.SCENES entry) · `lt` seconds since scene start · `dur` · `u`=lt/dur ·
`beat` (global, float) · `bar` · `bt` beat within bar 0..4 · `boil` (int, 12 fps line-boil index) · `boilT` · `impact` (decaying hit
envelope 0..1.4 from cues.HITS — use for micro shake / flash / bloom kick) · `era` (ERAS entry or null) · `chord` ·
2D only: `frame` {x,y,w,h,ratio} = the CURRENT animated matte picture rect (compose inside it), `ratio`, `embedded` (true while the era is shown
small inside the previous era's portal before its own start).

## S — services
`THREE` · `cues` · `BRAND` (palette, fonts) · `ease` (smooth, outBack, spring(t,freq,damp), squash…) · `rng` (hash, rng(seed), noise1/2, fbm) ·
`pencil` (see below) · `overlay` (matteRect, drawBars, …) · `amrita2d` · `amrita3d` · `hud` · `F` (font strings: F.display(px), F.hand(px), F.type(px), F.label(px), F.condensed(px)) ·
`PRESETS` (grade presets) · `scale` (1 = 1080p) · `W,H` (=1920,1080) · `renderer` (the shared THREE.WebGLRenderer) · `mk(w,h)` (new canvas) ·
`act1Frame(t)` **async** → canvas of the finished Act-I composite at t · `gradeCanvas(srcCanvas, presetId, {t, over})` → graded canvas ·
`cachedFrame(frameIdx)` **async** → ImageBitmap of an earlier frame of THIS film (small 1280×720) · `sceneT(ts, scene)` · `warn(msg)`.

## 2D scene module (Act I: `coldopen`, `e1895` … `e2025`, and `endcard` if you want a 2D card — but endcard is 3D)
```js
export default {
  id: 'e1895', kind: '2d',
  draw(ctx, T, S) { /* paint the WHOLE 1920×1080 frame. First call S.pencil.paper(ctx, S, {seed}) (or your own bg). */ },
  grade: (T) => ({ /* optional partial grade overrides per frame, e.g. {mono:0.6} */ }),   // optional (object or function)
  barColor: '#0b0a0d',                                                                   // optional matte-bar colour
};
```
The engine then: draws the aspect-ratio matte bars (`T.frame` animates between eras over 0.25 s) → applies the era GRADE (B&W flicker, sepia, three-strip, …, see
`grade.js` PRESETS: flicker/grain/scratches/weave/vignette are done for you) → HUD → titles. Do NOT draw HUD/matte/grain yourself.
**Dive transitions:** the era's focal object (`cues.ERAS[i].portal` {type, cx, cy, r}) MUST be drawn at that exact place/size by the end of your bar
(it becomes the portal the engine zooms into). It should be a bold, readable, circle-ish (or rounded-rect for screen/phone) object that FILLS the circle.
Compose so Amrita and the story read inside `T.frame`; keep Amrita's face out of the HUD caption zone (x<1000,y<165), the bottom film strip (y>955),
and the title zones in `titles.js` (`lower`, …). 12 fps boil: pass `T.boil` to every pencil call.
**Look:** paper, FLAT OFFSET color fill + colored-pencil HATCH + DOUBLED wobbly ink outline (`S.pencil.shape`, `ink`, `fill`, `hatch`, `text`…), hand lettering (Caveat).

### pencil toolkit (S.pencil — web/engine/pencil.js, read the file; ~15 functions)
Points are `[[x,y],...]`: `circlePts ellipsePts rectPts(x,y,w,h,rad) bezier smoothPts svgPts(d) xform bounds resample`.
Draw: `shape(ctx, pts, {fill, hatch, ink, boil, seed})` (all-in-one), `ink`, `fill` (offset flat fill, multiply), `hatch` (colored pencil, optional `shade(x,y)` density
function), `line`, `smudge`, `scribbleFill`, `text(ctx,str,x,y,{font,reveal,boil,...})` (write-on lettering), `underline`, `paper(ctx,S,{seed})`. Colors: `mix lighten darken rgba`.

## 3D scene module (Act II)
```js
export default {
  id: 'job_script', kind: '3d', ratio: 2.39,           // render aspect of THIS scene's target (turn uses 16:9). Engine sets camera.aspect.
  setup({THREE, S, renderer}) { /* build everything ONCE (async allowed): return { scene, camera, ...yourState } */ },
  async prepare(st, T, S, subTimes) {},                // optional: async work before the frame (e.g. await S.act1Frame(t), await S.cachedFrame(i))
  update(st, T, S) {                                   // PURE function of T.t: set camera, every object pose, light intensity, material param.
    return { dof:{focus, strength, maxPx, bokeh}, bloom:{strength, radius, threshold}, exposure, shake, jitter };   // all optional
  },
  overlay2d(ctx, T, S, st) { /* optional 2D overlay in 1920×1080 logical px, drawn over the 3D image (viewfinder brackets, timeline UI…) */ },
};
```
`update` is called once at the frame centre (to read DOF/bloom) and then once per sub-frame (4 sub-frames, shutter 0.5) at slightly different `T.t` — so
**everything that moves must be driven from `T.t`/`T.lt` inside `update`** (that is what makes motion blur work). Never use `performance.now`/accumulating state.
Sub-frame `T.lt` can be slightly outside [0,dur]: clamp.
* Units: meters, +Y up. Camera looks toward −Z by default. Stage floor y=0, cyc wall z≈−9. Amrita = disc Ø1.0 m (R=0.5) face toward +Z, hovering ~0.55–0.8 m.
* Look: ACES tone mapping + sRGB output are applied by the engine (OutputPass). Linear HDR scene; physically based lights (SpotLight/PointLight intensities in candela: ~150–400 for a
  spot 6–10 m away). **DOF on every shot: set `dof.focus` = distance to what the shot is about.** Bloom default 0.4. Letterbox 2.39 + vignette + grain are applied by the engine.
* Rim light on Amrita in every shot (PRO: a colored back/edge light).
* Camera: crane-downs, dolly-ins, low-angle hero, over-the-shoulder, orbits, whip-pans on the beat, push-ins, `T.impact` shakes. **Never put the camera inside geometry or behind
  props/posts/crowd; keep every move in clear space; keep the subject's eyes on screen thirds.** Cuts happen on downbeats (scene boundaries); inside your bar you may do ONE whip cut on a beat.
* **Performance (software GL, 4 cores shared!)**: ≤ 2 shadow-casting lights, shadow maps ≤ 1024, ≤ ~60 draw calls of heavy PBR; use InstancedMesh for crowds/particles; avoid
  per-frame geometry allocation (reuse objects; update matrices/attributes). Target ≤ ~1.5 s per 1080p frame (4 sub-frames). Measure with `tools/still.mjs` (prints ms).
* Titles/labels: drawn BY THE ENGINE from `cues.TITLES` (zones `lower`, `label`, `endTitle`, … in `titles.js`). Keep Amrita's face and the key action out of the active title zone.
  Job labels sit bottom-left (`label`: x 110–870, y 760–950): compose the shot so that area is empty-ish.
* HUD in the future scenes (42–50 s) is drawn by the engine (top-left caption, bottom strip, in the letterbox bars).

## Libraries
* `amrita2d.js`: `drawAmrita(ctx,T,S,{x,y,size,yaw,roll,squash,eye|expr,prop,propAnim,style,palette,alpha,seed})` → `{faceBox,eyeY,center}`; `drawProp`, `drawMark`, `EXPR`.
* `amrita3d.js`: `createAmrita(THREE,{style})` → `{root, pose({squash,yaw,roll,bob}), eyes({open,squint,happy,determined,surprised,sleepy,lookX,lookY}), expression(name,amount), setProp(kind|null,{t,clap,crank,glow,scale}), blinkAt(T), setStyle('solid'|'hologram',{hue,alpha}), materials, faceWorldPos(v)}`.
* `stage3d.js`: `createStage(THREE, env, opts)` → `{group, floor, cyc, chair, lights:{key,fill,rim,amb}, …}`; `fx3d.js`: beams/haze/particles/hologram/ribbons (see file header when it lands).
* `crowd3d.js`: icon-character cast + audience silhouettes/particles (see file header when it lands).

## Tools (your eyes — USE THEM after every change)
`node tools/still.mjs --t 4.5,5,5.5 --scale 0.5 --tag mine --cols 3`  → `out/stills/mine_sheet.png` (labelled contact sheet; **Read the PNG** to look at it) + individual PNGs.
`--scene e1895 --n 8` (evenly spaced across a scene), `--range 5.5,6,0.0333` (every frame of a beat), `--scale 1` for full-res detail checks. Prints per-frame ms, page errors, warnings and
overlapping-text collisions. Tools queue automatically (max 3 browsers machine-wide) — be patient, never launch your own Chromium. Always view stills at 0.2–0.5 s spacing around
every motion beat and fix until each frame works as a POSTER. Check: reads in 1.5 s · no text over faces · no overlapping text · camera never inside geometry · no accidental black/empty frames.
Keep stills in your own `--tag` namespace (e.g. `--tag e1895_a`).

## Report
End with a concise report (≤ 25 lines): files, what each shot shows (time ranges), what you verified (which sheets), perf (ms/frame), known issues / what you'd improve, any cues_extra events you added.
