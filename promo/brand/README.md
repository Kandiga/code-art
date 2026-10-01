# brand/ — Amrita Cinema Studio mark (PROPOSAL)

> **These files are PROPOSALS.** The repository contained no brand assets (see `../BRAND.md`), so the mark below was
> designed for the promo film. Replace it when a real mark exists. Nothing here is an official logo.

| file | what |
|---|---|
| `amrita-mark.svg` | the flat logo: aperture iris + cream play-triangle (no eyes), vermilion / amber blades |
| `amrita-mark-mono.svg` | one colour (default `#0E0D12`): blades are *inset* so the seams are real transparent gaps — no masks, no knock-outs; recolour by editing the group `fill` |
| `amrita-character.svg` | the mark with her two glossy black oval eyes (= Amrita, the character) |
| `amrita-character-mono.svg` | one-colour character: the eyes are holes (even-odd) |
| `build.mjs` | `node brand/build.mjs` regenerates all four from `web/engine/amrita2d.js` (same geometry the film draws) |

## Geometry (unit disc, R = 1, y down, angles clockwise on screen)

* **Hexagonal opening**, circumradius **0.62**, vertices at `k · 60°`.
* **6 pinwheel blades**: from every hexagon vertex `V_k` a ray continues the hexagon edge `V_{k+1} → V_k` until it hits the
  outer circle at `C_k`. Blade `k` = `V_k → C_{k-1}` (straight, passes through `V_{k-1}`), arc `C_{k-1} → C_k` on the unit
  circle (60°), back to `V_k`. Blades alternate **vermilion `#F2542D`** (even) and **amber `#FFB62E`** (odd), each with a
  light gradient from tip to rim. The opening shows near-black `#14121A`.
* **Play-triangle face**: vertices at `0°, 120°, 240°` on circumradius **0.60** (tip points right = "play"), corners filled
  with circular fillets of radius **0.10**, colour cream **`#FFF3D6`**.
* **Eyes** (character only): two glossy black `#0E0D12` ovals at **(−0.08, ±0.17)**. The film uses half-axes 0.075 × 0.125
  (full size 0.15 × 0.25, the same as `amrita3d.js`); BRAND.md rounds this to "0.13 × 0.22". White specular glint upper-left.
* Expressions are eye shapes only (neutral, blink, squint, happy arcs, determined, surprised, sleepy ...): see
  `eyeShape()` in `web/engine/amrita2d.js`.
* She is an icon, never a human: no limbs, no torso. In flat renderings she yaws ~25–35° toward camera.

Palette (also proposals): vermilion `#F2542D`, amber `#FFB62E`, cream `#FFF3D6`, graphite `#2A2833`, ink `#0E0D12`.
