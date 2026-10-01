// =============================================================================
// e1977 — SPACE OPERA, PRACTICAL MODELS (14.0-16.0, 2.39:1, 70s grain, prop: viewfinder, portal PORTHOLE @ (1150,520) r=95)
//   Deep-space night drawn with dense blue/black pencil (heavy hatching on a dark ground: black multiply strokes, light-blue
//   colored-pencil strokes, violet / magenta nebula patches), scribbled star clusters, a ringed planet.
//   A PRACTICAL-MODEL STARSHIP (original: a cardboard "toaster with fins": glowing toast-slot vents, glued panel seams, masking tape,
//   egg-carton + bottle-cap greebles, paint chips, tube pods, a spoon-less radar dish, hanging WIRES) sweeps from far (lower right)
//   to near (perspective dolly) and settles exactly at 15.3 with its round riveted VIEWPORT at (1150,520) r=95.
//   14.25  Amrita (bottom-left, tiny, rim-lit) raises her VIEWFINDER (extra cue viewfinder_on) and frames the shot
//   14.50 14.75 15.00  three LASER bolts (laser_zap x3): muzzle flash, tapered bright streak with halo, impact sparks on the distant
//                      target; each flash relights the ship's hatching.  15.00 the target bursts (model_explosion): white flash,
//                      jagged pencil-scribble star burst, cauliflower fireball, sparks, cardboard debris, smoke curls (miniature pyro)
//   15.3-16.0  the ship rests: the porthole (cockpit glow, tiny toy pilot, riveted brass frame) is the hero circle — pristine,
//              unoccluded from 15.4 on; the engine dives into it at 15.5.
// Pure function of T.t. All randomness = seeded hashing. Every pencil call gets T.boil (12 fps line boil).
// =============================================================================
import * as P from '../pencil.js';
import { hash, noise1, noise2 } from '../rng.js';
import { clamp, lerp, smooth, outCubic, outBack, outQuad, spring } from '../ease.js';
import { ERAS } from '../../../shared/cues.js';

const ERA = ERAS[5], PORT = ERA.portal;            // {type:'porthole', cx:1150, cy:520, r:95}
const T0 = ERA.t0, TAU = Math.PI * 2;
const ZAPS = [14.5, 14.75, 15.0];                  // = SFX laser_zap (arrival of each bolt on the target)
const BOOM = 15.0;                                 // = SFX model_explosion
const FINDER_T = 14.25;                            // = extra cue viewfinder_on
const SETTLE = T0 + 1.3;                           // ship at rest from here
const TG = { x: 560, y: 322 };                     // the distant target
const PLANET = { cx: 262, cy: 512, r: 148, tilt: -0.2 };
const VPT = [1600, 690], FIN = [PORT.cx, PORT.cy]; // dolly vanishing point / rest position of the porthole
const INK = '#16132B', INK2 = '#2B2547';
const AM = { x: 268, y: 808, R: 96 };

// ------------------------------------------------------------------ helpers
const LAYERS = new Map();
function layer(S, key, draw) {
  const k = key + '@' + S.scale; let c = LAYERS.get(k); if (c) return c;
  c = S.mk(Math.round(1920 * S.scale), Math.round(1080 * S.scale));
  const g = c.getContext('2d'); g.setTransform(S.scale, 0, 0, S.scale, 0, 0); draw(g);
  LAYERS.set(k, c); if (LAYERS.size > 4) LAYERS.delete(LAYERS.keys().next().value);
  return c;
}
let TMP = null;
const tmpCanvas = (S, w, h) => { if (!TMP || TMP.s !== S.scale || TMP.w !== w) TMP = { s: S.scale, w, c: S.mk(Math.round(w * S.scale), Math.round(h * S.scale)) }; return TMP.c; };
const trace = (ctx, pts, close = true) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (close) ctx.closePath(); };
const mx = (a, b, t) => P.mix(a, b, t);
function glow(ctx, x, y, r, col, a, comp = 'lighter') {
  ctx.save(); ctx.globalCompositeOperation = comp; const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, P.rgba(col, a)); g.addColorStop(0.4, P.rgba(col, a * 0.4)); g.addColorStop(1, P.rgba(col, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
}
function roundPoly(V, r, n = 5) {                  // rounded convex polygon (circular fillets)
  const out = [], N = V.length;
  for (let i = 0; i < N; i++) {
    const p0 = V[(i + N - 1) % N], p1 = V[i], p2 = V[(i + 1) % N];
    let u1 = [p0[0] - p1[0], p0[1] - p1[1]], u2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l1 = Math.hypot(...u1), l2 = Math.hypot(...u2); u1 = [u1[0] / l1, u1[1] / l1]; u2 = [u2[0] / l2, u2[1] / l2];
    const ang = Math.acos(clamp(u1[0] * u2[0] + u1[1] * u2[1], -1, 1)), sb = r / Math.tan(ang / 2);
    const bis = [u1[0] + u2[0], u1[1] + u2[1]], bl = Math.hypot(...bis), cd = r / Math.sin(ang / 2);
    const c = [p1[0] + (bis[0] / bl) * cd, p1[1] + (bis[1] / bl) * cd];
    const t1 = [p1[0] + u1[0] * sb, p1[1] + u1[1] * sb], t2 = [p1[0] + u2[0] * sb, p1[1] + u2[1] * sb];
    const a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0]); let da = Math.atan2(t2[1] - c[1], t2[0] - c[0]) - a1; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
    for (let k = 0; k <= n; k++) { const a = a1 + (da * k) / n; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
  }
  return out;
}
const star = (cx, cy, rOut, rIn, n, rot = 0) => { const pts = []; for (let i = 0; i < n * 2; i++) { const a = rot + (i * Math.PI) / n, r = i % 2 ? rIn : rOut; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return pts; };

// batched pencil strokes: angled rows of broken, slightly bowed strokes; `dens(x,y)` 0..1 modulates the density
function hatchField(ctx, B, o) {
  const { x0 = 0, y0 = 0, x1 = 1920, y1 = 1080, angle = -0.7, gap = 8, seg = 70, color = '#000', alpha = 0.4, width = 1.3, seed = 1, dens = null, comp = 'source-over', jit = 1.1, bow = 1 } = o;
  const c = Math.cos(angle), s = Math.sin(angle), nx = -s, ny = c, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + 10;
  const bk = [[], [], []], rows = Math.ceil((2 * R) / gap);
  for (let r = 0; r < rows; r++) {
    const off = -R + r * gap + (hash(r, seed, 1) - 0.5) * gap * 0.7 + noise1(r * 0.37, seed + B * 7) * jit;
    let t = -R + hash(r, seed, 2) * seg, guard = 0;
    while (t < R && guard++ < 260) {
      const cell = Math.floor((t + R) / 24), len = seg * (0.45 + hash(r, cell, seed + 3));
      const t1 = Math.min(R, t + len), tm = (t + t1) / 2, mxx = cx + nx * off + c * tm, myy = cy + ny * off + s * tm;
      if (mxx > x0 - 30 && mxx < x1 + 30 && myy > y0 - 30 && myy < y1 + 30) {
        const d = dens ? dens(mxx, myy) : 1;
        if (d > 0 && hash(r, cell, seed + 5) < d) {
          const jb = noise1(r * 0.61 + cell, seed + B * 5) * jit * bow, bi = Math.min(2, Math.floor(hash(r, cell, seed + 9) * 3));
          bk[bi].push(cx + nx * off + c * t, cy + ny * off + s * t, cx + nx * (off + jb) + c * tm, cy + ny * (off + jb) + s * tm, cx + nx * off + c * t1, cy + ny * off + s * t1);
        }
      }
      t = t1 + gap * (0.15 + hash(r, cell, seed + 7) * 0.9);
    }
  }
  ctx.save(); ctx.globalCompositeOperation = comp; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
  bk.forEach((arr, bi) => {
    if (!arr.length) return;
    ctx.globalAlpha = alpha * (0.55 + 0.225 * bi); ctx.beginPath();
    for (let i = 0; i < arr.length; i += 6) { ctx.moveTo(arr[i], arr[i + 1]); ctx.quadraticCurveTo(arr[i + 2], arr[i + 3], arr[i + 4], arr[i + 5]); }
    ctx.stroke();
  });
  ctx.restore();
}

// ================================================================== the night sky layer (re-drawn per boil frame, cached)
const CLUSTERS = [[1470, 232, 24, 78], [880, 214, 16, 56], [150, 318, 14, 50], [1010, 868, 18, 66], [1740, 760, 20, 70], [640, 740, 12, 44], [1790, 330, 12, 40]];
function drawStars(ctx, B) {
  ctx.save();
  // field stars
  for (let i = 0; i < 150; i++) {
    const x = hash(i, 5, 1) * 1920, y = 120 + hash(i, 5, 2) * 840, tw = hash(i, Math.floor(B / (2 + (i % 4))), 9), r = 0.9 + hash(i, 5, 3) * 1.7;
    ctx.globalAlpha = (0.35 + 0.65 * tw) * (0.5 + 0.5 * hash(i, 5, 4)); ctx.fillStyle = hash(i, 5, 5) < 0.2 ? '#FFD9A0' : '#EEF0FF';
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  // scribbled clusters: a tangle of faint loops + a swarm of stars with tiny crosses
  CLUSTERS.forEach(([cx, cy, n, R], ci) => {
    ctx.globalAlpha = 0.22; ctx.strokeStyle = '#9FB2FF'; ctx.lineWidth = 1.3; ctx.beginPath();
    for (let k = 0; k <= 46; k++) { const a = k * 0.62 + hash(ci, 2, 1) * 6, rr = R * (0.25 + 0.7 * Math.abs(Math.sin(k * 0.31 + ci))) * (0.8 + 0.2 * noise1(k * 0.5, 40 + ci + B * 3)); const px = cx + Math.cos(a) * rr * 1.25, py = cy + Math.sin(a) * rr * 0.8; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      const a = hash(ci, i, 3) * TAU, d = Math.pow(hash(ci, i, 4), 0.7) * R, x = cx + Math.cos(a) * d * 1.25, y = cy + Math.sin(a) * d * 0.8, tw = hash(ci * 50 + i, Math.floor(B / (2 + (i % 3))), 8);
      const r = 1.3 + hash(ci, i, 5) * 2.3 * (1 - d / R * 0.5), big = hash(ci, i, 6) < 0.22;
      ctx.globalAlpha = 0.5 + 0.5 * tw; ctx.fillStyle = '#FFF4D2'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      if (big) { const L = r * 4.2 + 3; ctx.strokeStyle = '#FFF4D2'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - L, y); ctx.lineTo(x + L, y); ctx.moveTo(x, y - L); ctx.lineTo(x, y + L); ctx.stroke(); }
    }
  });
  // a few big four-point sparkles
  [[1240, 190, 18], [420, 190, 13], [1630, 560, 15], [760, 905, 12], [1865, 900, 11]].forEach(([x, y, r], i) => {
    const tw = 0.6 + 0.4 * hash(i, Math.floor(B / 2), 12); ctx.globalAlpha = tw; ctx.fillStyle = '#FFF8E0';
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r); ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r); ctx.fill();
  });
  ctx.restore();
}

function ringPts(a0, a1, rx, ry, n = 34) {
  const c = Math.cos(PLANET.tilt), s = Math.sin(PLANET.tilt), out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n, x = Math.cos(a) * rx, y = Math.sin(a) * ry; out.push([PLANET.cx + x * c - y * s, PLANET.cy + x * s + y * c]); }
  return out;
}
function drawRingHalf(ctx, B, back) {
  const [a0, a1] = back ? [Math.PI, TAU] : [0, Math.PI], R1 = [222, 46], R2 = [334, 70];
  const pts = ringPts(a0, a1, R2[0], R2[1]).concat(ringPts(a1, a0, R1[0], R1[1]));
  ctx.save();
  const g = ctx.createLinearGradient(PLANET.cx - 330, 0, PLANET.cx + 330, 0); g.addColorStop(0, '#6D5A66'); g.addColorStop(0.5, '#E3C98C'); g.addColorStop(1, '#F6E3AE');
  ctx.fillStyle = g; trace(ctx, pts); ctx.fill();
  ctx.save(); trace(ctx, pts); ctx.clip();
  [[242, 50, '#B49256', 2.6], [272, 57, '#F4E2B0', 2], [300, 63, '#AE8C52', 3.4], [320, 67, '#F4E2B0', 1.6]].forEach(([rx, ry, c, w], i) => P.ink(ctx, ringPts(a0, a1, rx, ry, 40), { closed: false, color: c, width: w, boil: B, seed: 700 + i, amp: 1.1, passes: 2, step: 12, alpha: 0.8 }));
  ctx.restore();
  P.ink(ctx, pts, { closed: true, color: INK2, width: 2.6, boil: B, seed: 710 + (back ? 0 : 1), amp: 1.3, passes: 2, step: 12, alpha: 0.9 });
  ctx.restore();
}
function drawPlanet(ctx, B) {
  const { cx, cy, r } = PLANET;
  drawRingHalf(ctx, B, true);
  ctx.save();
  // the disc: cool teal-blue, lit from the upper right
  const g = ctx.createRadialGradient(cx + r * 0.42, cy - r * 0.45, r * 0.05, cx + r * 0.1, cy - r * 0.1, r * 1.25);
  g.addColorStop(0, '#9FE0E4'); g.addColorStop(0.3, '#4FA3B8'); g.addColorStop(0.62, '#2A5F96'); g.addColorStop(1, '#0E1B4C');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
  // cloud bands (flat tones along the ring tilt)
  const ct = Math.cos(PLANET.tilt), st = Math.sin(PLANET.tilt);
  [[-0.55, 0.16, '#E7F4E8', 0.20], [-0.22, 0.2, '#16356F', 0.30], [0.12, 0.13, '#BEE9EC', 0.20], [0.40, 0.22, '#142B63', 0.34], [0.68, 0.12, '#7FC2D2', 0.16]].forEach(([o, w, c, a], i) => {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(PLANET.tilt); ctx.fillStyle = P.rgba(c, a);
    ctx.beginPath(); ctx.ellipse(0, o * r, r * 1.2, w * r * 0.9, 0, 0, TAU); ctx.fill(); ctx.restore();
  });
  // pencil hatching following the bands (blue, black on the shadow side)
  hatchField(ctx, B, { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r, angle: PLANET.tilt - 0.05, gap: 5.5, seg: 60, color: '#07163D', alpha: 0.55, width: 1.4, seed: 41, comp: 'multiply', dens: (x, y) => clamp(0.15 + ((cx - x) * 0.55 + (y - cy) * 0.75) / r * 0.7, 0.05, 1) });
  hatchField(ctx, B, { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r, angle: PLANET.tilt + 0.1, gap: 8, seg: 54, color: '#CFF5F2', alpha: 0.4, width: 1.3, seed: 43, dens: (x, y) => clamp(1.0 - Math.hypot(x - (cx + r * 0.42), y - (cy - r * 0.42)) / (r * 0.95), 0, 1) });
  // terminator
  const tg = ctx.createLinearGradient(cx + r * 0.7, cy - r * 0.7, cx - r * 0.9, cy + r * 0.9); tg.addColorStop(0.35, 'rgba(6,10,40,0)'); tg.addColorStop(0.8, 'rgba(6,10,40,0.78)');
  ctx.fillStyle = tg; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  ctx.restore();
  // rim light on the lit limb
  ctx.strokeStyle = 'rgba(214,250,252,0.85)'; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(cx, cy, r - 1.6, -1.25, -0.1); ctx.stroke();
  ctx.restore();
  P.ink(ctx, P.circlePts(cx, cy, r, 64), { closed: true, color: INK2, width: 3.4, boil: B, seed: 52, amp: 1.2, passes: 2, step: 12, alpha: 0.95 });
  drawRingHalf(ctx, B, false);
  // a little moon
  const mxn = 150, myn = 235, mr = 14;
  ctx.fillStyle = '#D9D2C2'; ctx.beginPath(); ctx.arc(mxn, myn, mr, 0, TAU); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(mxn, myn, mr, 0, TAU); ctx.clip(); ctx.fillStyle = 'rgba(20,24,70,0.7)'; ctx.beginPath(); ctx.arc(mxn - 9, myn + 6, mr * 1.1, 0, TAU); ctx.fill(); ctx.restore();
  P.ink(ctx, P.circlePts(mxn, myn, mr, 20), { closed: true, color: INK2, width: 2, boil: B, seed: 55, amp: 0.6, passes: 2, step: 7 });
}

function drawSkyLayer(g, S, B) {
  P.paper(g, S, { seed: 71, base: '#EDE4D0', shade: '#DDD0B4' });
  const gr = g.createLinearGradient(0, 100, 0, 990); gr.addColorStop(0, '#070A24'); gr.addColorStop(0.5, '#10195A'); gr.addColorStop(1, '#1B2678');
  g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = gr; g.fillRect(-10, 70, 1940, 940); g.restore();
  const n2 = (x, y, sd) => 0.5 + 0.5 * noise2(x * 0.0035, y * 0.0045, sd);
  const box = { x0: -20, y0: 90, x1: 1940, y1: 990 };
  hatchField(g, B, { ...box, angle: -0.78, gap: 6, seg: 90, color: '#03041A', alpha: 0.6, width: 1.5, seed: 3, comp: 'multiply', dens: (x, y) => clamp(0.35 + 0.8 * n2(x, y, 5), 0, 1) });
  hatchField(g, B, { ...box, angle: -0.2, gap: 10, seg: 110, color: '#03041A', alpha: 0.5, width: 1.4, seed: 8, comp: 'multiply', dens: (x, y) => clamp(1.15 - (y - 90) / 560, 0, 0.95) * n2(x, y, 9) });
  hatchField(g, B, { ...box, angle: -0.72, gap: 8, seg: 80, color: '#2F43BD', alpha: 0.34, width: 1.4, seed: 13, dens: (x, y) => clamp(0.12 + 1.1 * n2(x, y, 17) - 0.45, 0, 1) * clamp(0.5 + (y - 90) / 900, 0, 1) });
  hatchField(g, B, { ...box, angle: -0.8, gap: 13, seg: 70, color: '#8B9AF5', alpha: 0.2, width: 1.2, seed: 21, dens: (x, y) => clamp(1 - Math.hypot(x - 380, y - 760) / 620, 0, 1) });
  // nebula patches (violet / magenta / teal) in coloured pencil
  hatchField(g, B, { x0: 980, y0: 120, x1: 1920, y1: 520, angle: -0.5, gap: 7, seg: 80, color: '#7C4FD8', alpha: 0.42, width: 1.5, seed: 31, dens: (x, y) => clamp(n2(x * 1.3, y * 1.3, 44) * 1.5 - 0.5, 0, 1) * clamp(1 - Math.hypot(x - 1500, y - 300) / 560, 0, 1) });
  hatchField(g, B, { x0: 980, y0: 120, x1: 1920, y1: 520, angle: -0.95, gap: 9, seg: 70, color: '#D43D90', alpha: 0.36, width: 1.4, seed: 33, dens: (x, y) => clamp(n2(x * 1.5, y * 1.5, 46) * 1.4 - 0.55, 0, 1) * clamp(1 - Math.hypot(x - 1620, y - 250) / 420, 0, 1) });
  hatchField(g, B, { x0: 1100, y0: 600, x1: 1920, y1: 990, angle: -0.6, gap: 9, seg: 70, color: '#1FB5A6', alpha: 0.2, width: 1.4, seed: 35, dens: (x, y) => clamp(n2(x * 1.4, y * 1.4, 48) * 1.3 - 0.45, 0, 1) * clamp(1 - Math.hypot(x - 1700, y - 820) / 460, 0, 1) });
  drawStars(g, B);
  drawPlanet(g, B);
}

// ================================================================== the distant target (a tin-can drone station)
function drawTarget(ctx, B, t, hitT) {
  if (t >= BOOM) return;
  const k = 1.25, sh = hitT * 3;                      // shake on hits
  const jx = (hash(Math.floor(t * 60), 91, 1) - 0.5) * 2 * sh, jy = (hash(Math.floor(t * 60), 91, 2) - 0.5) * 2 * sh;
  ctx.save(); ctx.translate(TG.x + jx, TG.y + jy); ctx.scale(k, k);
  const hits = ZAPS.filter((z) => t >= z).length, flick = Math.floor(t * 12) % 2;
  const body = (pts, c, seed, w = 2.6) => { ctx.fillStyle = c; trace(ctx, pts); ctx.fill(); P.ink(ctx, pts, { closed: true, color: INK, width: w, boil: B, seed, amp: 0.9, passes: 2, step: 8 }); };
  // legs + antenna
  body([[-26, 28], [-50, 58], [-38, 60], [-16, 34]], '#8E93B4', 801); body([[26, 28], [50, 58], [38, 60], [16, 34]], '#8E93B4', 802);
  P.ink(ctx, [[0, -36], [4, -70], [-6, -92]], { closed: false, color: INK, width: 3, boil: B, seed: 803, amp: 0.6, passes: 2, step: 8 });
  body(P.ellipsePts(-6, -96, 24, 8, -0.25, 16), '#C9CDE6', 804, 2.2);
  // the ring band
  ctx.save(); ctx.fillStyle = '#B33A7A'; ctx.beginPath(); ctx.ellipse(0, 4, 78, 15, 0, 0, TAU); ctx.fill(); ctx.restore();
  P.ink(ctx, P.ellipsePts(0, 4, 78, 15, 0, 28), { closed: true, color: INK, width: 2.4, boil: B, seed: 805, amp: 0.9, passes: 2, step: 10 });
  // drum
  const drum = P.rectPts(-44, -34, 88, 70, 5, 3);
  ctx.fillStyle = '#B5BAD8'; trace(ctx, drum); ctx.fill();
  ctx.fillStyle = '#F1E7D0'; ctx.beginPath(); ctx.ellipse(0, -34, 44, 12, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#7C82A8'; ctx.beginPath(); ctx.moveTo(18, -34); ctx.lineTo(44, -34); ctx.lineTo(44, 36); ctx.lineTo(18, 36); ctx.closePath(); ctx.fill();
  P.hatch(ctx, drum, { color: '#3E4370', angle: -0.9, gap: 6, width: 1.2, alpha: 0.5, boil: B, seed: 806, shade: (x, y) => clamp(0.2 + (x + 44) / 100, 0, 1), comp: 'multiply' });
  P.ink(ctx, drum, { closed: true, color: INK, width: 2.6, boil: B, seed: 807, amp: 0.9, passes: 2, step: 8 });
  P.ink(ctx, P.ellipsePts(0, -34, 44, 12, 0, 24), { closed: true, color: INK, width: 2, boil: B, seed: 808, amp: 0.7, passes: 2, step: 8 });
  // the glowing core port (the thing they hit): pulses faster as it takes damage
  const pr = 0.5 + 0.5 * Math.sin(t * (6 + hits * 5));
  glow(ctx, -6, 6, 46 + 10 * pr, '#FF7A2E', 0.7 + 0.2 * pr);
  ctx.fillStyle = '#FF8A32'; ctx.beginPath(); ctx.arc(-6, 6, 14, 0, TAU); ctx.fill(); ctx.fillStyle = '#FFF0B0'; ctx.beginPath(); ctx.arc(-6, 6, 7, 0, TAU); ctx.fill();
  P.ink(ctx, P.circlePts(-6, 6, 15, 16), { closed: true, color: INK, width: 2.6, boil: B, seed: 809, amp: 0.6, passes: 2, step: 6 });
  // damage: cracks + scorch after hits, flames after the 2nd
  if (hits >= 1) { P.ink(ctx, [[-30, -28], [-22, -14], [-28, -4], [-18, 8]], { closed: false, color: '#2A1018', width: 3, boil: B, seed: 811, amp: 0.7, passes: 2, step: 6 }); }
  if (hits >= 2) {
    P.ink(ctx, [[20, -30], [12, -12], [24, 2], [14, 18]], { closed: false, color: '#2A1018', width: 3, boil: B, seed: 812, amp: 0.7, passes: 2, step: 6 });
    [[-20, -44, 14], [24, -42, 11], [-4, -50, 9]].forEach(([fx, fy, fr], i) => { const f = 0.7 + 0.5 * hash(i, Math.floor(t * 12), 3); const pts = [[fx - fr * 0.6, fy], [fx - fr * 0.2, fy - fr * 1.5 * f], [fx + fr * 0.15, fy - fr * 0.7], [fx + fr * 0.4, fy - fr * 1.9 * f], [fx + fr * 0.7, fy]]; ctx.fillStyle = i % 2 ? '#FFB838' : '#FF6A24'; trace(ctx, pts); ctx.fill(); });
  }
  // blinking lamps
  [[-40, 36, '#FF4D5E'], [40, 36, '#7DF2FF']].forEach(([lx, ly, c], i) => { glow(ctx, lx, ly, 14, c, flick === i ? 0.9 : 0.15); });
  ctx.restore();
}

// ================================================================== THE STARSHIP (local coords: origin = porthole centre, nose to the LEFT)
const HULL = P.rectPts(-360, -150, 690, 315, 62, 6);
const NOSE = roundPoly([[-330, -108], [-452, -56], [-452, 74], [-330, 126]], 14);
const FIN_U = roundPoly([[118, -146], [246, -326], [436, -326], [380, -146]], 10);
const FIN_L = roundPoly([[130, 160], [236, 296], [402, 296], [372, 160]], 10);
const ENG = P.rectPts(318, -102, 100, 222, 16, 5);
const NOZ_Y = [-62, 10, 82];
const MUZ = [[-514, 6], [-264, -168], [196, -318]];       // local muzzle points: nose cannon, roof turret, fin gun (left -> right, = pan order)
const WIRE_AT = [[-118, -152], [130, -152], [362, -326]];

function shipPose(t) {
  const u = clamp((t - T0) / (SETTLE - T0)), f = outQuad(u), s = 1 / (1 + 3.55 * (1 - f));
  const x = VPT[0] + (FIN[0] - VPT[0]) * s, y = VPT[1] + (FIN[1] - VPT[1]) * s;
  const k = 1 - f, rot = 0.30 * Math.pow(k, 1.2) + 0.012 * Math.sin((t - T0) * 6.5) * k, bob = Math.sin((t - T0) * 7.3) * 2.2 * k;
  return { x, y: y + bob, s, rot };
}
const mkXF = (P0) => { const c = Math.cos(P0.rot), sn = Math.sin(P0.rot); return (p) => [P0.x + P0.s * (p[0] * c - p[1] * sn), P0.y + P0.s * (p[0] * sn + p[1] * c)]; };

function drawShip(ctx, B, t, pose, S) {
  const XF = mkXF(pose), s = pose.s, lw = Math.max(1.5, 3.4 * Math.pow(s, 0.5)), hs = clamp(Math.pow(s, 0.55), 0.5, 1), amp = Math.max(0.5, 1.6 * Math.pow(s, 0.5));
  const detail = clamp((s - 0.3) / 0.35, 0, 1), sil = [];
  const Q = (pts) => pts.map(XF);
  const part = (pts, o) => {
    const sp = Q(pts); if (o.sil) sil.push(sp);
    ctx.save(); if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.fillStyle = o.c; trace(ctx, sp); ctx.fill();
    if (o.grad) { ctx.save(); trace(ctx, sp); ctx.clip(); const b = P.bounds(sp), g = ctx.createLinearGradient(b.x, b.y, b.x + b.w * 0.25, b.y + b.h); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, P.rgba(o.grad, 0.5)); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = g; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.restore(); }
    if (o.hc) { const b = P.bounds(sp); P.hatch(ctx, sp, { color: o.hc, angle: o.ang ?? -0.8, gap: (o.gap ?? 7) * hs, width: 1.3 * hs, alpha: o.ha ?? 0.6, boil: B, seed: o.seed ?? 1, shade: (x, y) => clamp(((y - b.y) / Math.max(1, b.h)) * 1.15 + ((x - b.x) / Math.max(1, b.w)) * 0.3 - 0.1, 0.06, 1), comp: 'multiply', segLen: 38 * hs }); }
    if (o.ink !== false) P.ink(ctx, sp, { closed: o.closed ?? true, color: o.ic ?? INK, width: (o.lw ?? 1) * lw, boil: B, seed: o.seed ?? 1, amp, passes: o.passes ?? 2, step: Math.max(6, 9 * hs), alpha: 0.95 });
    ctx.restore();
  };
  const line = (pts, o = {}) => P.ink(ctx, Q(pts), { closed: false, color: o.c ?? INK, width: (o.w ?? 1) * lw, boil: B, seed: o.seed ?? 1, amp: amp * 0.8, passes: o.passes ?? 2, step: Math.max(6, 8 * hs), alpha: o.a ?? 0.9, taper: !!o.taper });
  const clipHull = (fn) => { ctx.save(); trace(ctx, Q(HULL)); ctx.clip(); fn(); ctx.restore(); };
  const disc = (cx, cy, r, c, seed, o = {}) => part(P.circlePts(cx, cy, r, o.n ?? 16), { c, seed, ...o });
  const CARD = '#C9A56B', CARDH = '#7A5A30', CREAM = '#F3E8CB', CREAMH = '#B5703A', ORG = '#EC6A2C', ORGH = '#A7361A', MUST = '#F4B63A', MUSTH = '#B5781A', STEEL = '#9AA1B8', STEELH = '#454C6E', TEAL = '#27B3A6';

  // --- engine flames: tapered teardrops (additive, flicker at 12 fps) ---
  {
    const dx = Math.cos(pose.rot), dy = Math.sin(pose.rot), nx = -dy, ny = dx, grow = 0.4 + 0.6 * smooth((s - 0.2) / 0.5);
    NOZ_Y.forEach((y, i) => {
      const a = XF([466, y]), fl = 0.8 + 0.4 * hash(i, B, 4), L = (120 + 60 * fl) * s * grow, jit = (hash(i, B, 5) - 0.5) * 12 * s;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      [[1.0, 34, 'rgba(255,70,30,0.55)', 'rgba(255,70,30,0)'], [0.72, 24, 'rgba(255,160,50,0.8)', 'rgba(255,150,50,0)'], [0.44, 13, 'rgba(255,248,214,1)', 'rgba(255,240,180,0)']].forEach(([lk, wd, c0, c1]) => {
        const len = L * lk, w = wd * s, tx = a[0] + dx * len, ty = a[1] + dy * len + jit * lk, mxp = a[0] + dx * len * 0.38, myp = a[1] + dy * len * 0.38;
        const g = ctx.createLinearGradient(a[0], a[1], tx, ty); g.addColorStop(0, c0); g.addColorStop(1, c1); ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(a[0] + nx * w, a[1] + ny * w); ctx.quadraticCurveTo(mxp + nx * w * 1.25, myp + ny * w * 1.25, tx, ty); ctx.quadraticCurveTo(mxp - nx * w * 1.25, myp - ny * w * 1.25, a[0] - nx * w, a[1] - ny * w); ctx.closePath(); ctx.fill();
      });
      ctx.restore();
      glow(ctx, a[0] + dx * 12 * s, a[1] + dy * 12 * s, 70 * s + 8, '#FF8A3A', 0.5);
    });
  }
  // --- fins (behind the hull) ---
  part(FIN_L, { c: ORG, hc: ORGH, seed: 11, sil: 1, grad: '#6A2A12' });
  part(FIN_U, { c: ORG, hc: ORGH, seed: 12, sil: 1, grad: '#6A2A12', ang: -0.6 });
  // fin stripes (cream chevrons, painted slightly off-register)
  [[FIN_U, [[190, -150], [262, -150], [380, -318], [320, -318]]], [FIN_L, [[200, 160], [262, 160], [330, 262], [290, 262]]]].forEach(([fin, st], i) => {
    ctx.save(); trace(ctx, Q(fin)); ctx.clip();
    ctx.translate(2.6 * s, 2 * s); ctx.fillStyle = CREAM; trace(ctx, Q(st)); ctx.fill(); ctx.restore();
    ctx.save(); trace(ctx, Q(fin)); ctx.clip(); line(st.slice(1, 3).concat([st[2]]), { c: INK2, w: 0.7, a: 0.7, passes: 1 }); ctx.restore();
  });
  // --- tube pods under the hull (bundle of cardboard tubes taped on) ---
  if (detail > 0.01) {
    [[-190, -70], [-46, 74], [102, 218]].forEach(([x0, x1], i) => {
      const y0 = 176, y1 = 222;
      part(P.rectPts(x0, y0, x1 - x0 + 0, y1 - y0, 14, 4), { c: i === 1 ? '#D9B880' : CARD, hc: CARDH, seed: 20 + i, alpha: detail, gap: 6 });
      part(P.ellipsePts(x0 + 4, (y0 + y1) / 2, 9, 23, 0, 12), { c: '#5B3C28', seed: 24 + i, alpha: detail, lw: 0.8 });
    });
  }
  // --- engine block + the three tin-can nozzles ---
  part(ENG, { c: '#6E7490', hc: STEELH, seed: 30, sil: 1, grad: '#1C2040' });
  NOZ_Y.forEach((y, i) => {
    part(P.rectPts(410, y - 31, 56, 62, 6, 3), { c: STEEL, hc: STEELH, seed: 31 + i, sil: 1, gap: 6 });
    part(P.ellipsePts(466, y, 13, 31, 0, 16), { c: '#3A1E18', seed: 35 + i, lw: 0.9 });
    const gp = Q(P.ellipsePts(466, y, 9, 24, 0, 14)); const g = ctx.createRadialGradient(...XF([466, y]), 1, ...XF([466, y]), 26 * s + 2); g.addColorStop(0, '#FFF3C0'); g.addColorStop(0.6, '#FF9A3C'); g.addColorStop(1, 'rgba(255,120,40,0)'); ctx.fillStyle = g; trace(ctx, gp); ctx.fill();
  });
  // --- nose block + cannon ---
  part(P.rectPts(-514, -14, 80, 40, 8, 3), { c: STEEL, hc: STEELH, seed: 40, sil: 1, gap: 5 });
  part(P.ellipsePts(-514, 6, 8, 20, 0, 12), { c: '#25203A', seed: 41, lw: 0.8 });
  part(NOSE, { c: MUST, hc: MUSTH, seed: 42, sil: 1, grad: '#7A4A10' });
  // --- the main hull ---
  part(HULL, { c: CREAM, hc: CREAMH, seed: 50, sil: 1, grad: '#8A5A3A', gap: 7, ha: 0.8 });
  clipHull(() => {
    const b = P.bounds(Q(HULL));
    // a second, crossing coat of pencil on the lower third (shadow side)
    P.hatch(ctx, Q(HULL), { color: '#7C4A2B', angle: 0.55 + pose.rot, gap: 9 * hs, width: 1.2 * hs, alpha: 0.5, boil: B, seed: 51, shade: (x, y) => clamp((y - b.y) / b.h * 1.6 - 0.75, 0, 1), comp: 'multiply', segLen: 30 * hs });
    // tinted plates (a different cardboard / paint per panel, slightly off-register)
    [[-250, -138, 116, 58, '#BFE4DA'], [206, 8, 84, 104, '#F3C59A'], [-352, -64, 100, 72, '#D9D2BC']].forEach(([x, y, w, h, c], i) => {
      ctx.save(); ctx.translate(2.5 * s, 2 * s); ctx.globalAlpha = 0.9; ctx.fillStyle = c; trace(ctx, Q(P.rectPts(x, y, w, h, 4, 2))); ctx.fill(); ctx.restore();
      P.ink(ctx, Q(P.rectPts(x, y, w, h, 4, 2)), { closed: true, color: INK2, width: 0.6 * lw, boil: B, seed: 52 + i, amp: amp * 0.6, passes: 2, step: 8, alpha: 0.8 });
    });
    // soot / scorch from the engines
    const eg = XF([330, 0]), sg = ctx.createRadialGradient(eg[0], eg[1], 0, eg[0], eg[1], 190 * s); sg.addColorStop(0, 'rgba(40,22,18,0.55)'); sg.addColorStop(1, 'rgba(40,22,18,0)');
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = sg; ctx.fillRect(eg[0] - 200 * s, eg[1] - 200 * s, 400 * s, 400 * s); ctx.globalCompositeOperation = 'source-over';
    // grime streaks running down from the seams and rivets
    [[-262, -140, 40], [196, -140, 60], [292, -140, 44], [-135, 130, 30], [135, 140, 24], [-200, -150, 34], [100, -150, 30]].forEach(([gx, gy, gl], i) => {
      const r4 = Q(P.rectPts(gx - 7, gy, 14, gl + 70 * hash(i, 3, 3), 0)); P.hatch(ctx, r4, { color: '#3A2A22', angle: Math.PI / 2 + pose.rot, gap: 4 * hs, width: 1.1 * hs, alpha: 0.4, boil: B, seed: 53 + i, shade: (x, y) => 0.9, comp: 'multiply', segLen: 26 * hs });
    });
  });
  // painted bands (mis-registered flat colour) clipped to the hull
  clipHull(() => {
    ctx.save(); ctx.translate(3 * s, 2.4 * s);
    ctx.fillStyle = MUST; trace(ctx, Q([[-360, 92], [330, 92], [330, 130], [-360, 130]])); ctx.fill();
    ctx.fillStyle = TEAL; trace(ctx, Q([[-360, 76], [330, 76], [330, 86], [-360, 86]])); ctx.fill(); trace(ctx, Q([[-360, 136], [330, 136], [330, 144], [-360, 144]])); ctx.fill();
    ctx.restore();
  });
  // glued panel seams (double lines) + masking tape + glue blobs
  const seams = [[[-262, -150], [-262, 165]], [[196, -150], [196, 165]], [[292, -150], [292, 165]], [[-360, -72], [-135, -72]], [[135, -62], [330, -62]], [[-360, 40], [-135, 40]]];
  clipHull(() => { seams.forEach(([a, b], i) => { line([a, b], { c: INK2, w: 0.55, a: 0.75, seed: 60 + i, passes: 1 }); line([[a[0] + 5, a[1]], [b[0] + 5, b[1] + (a[0] === b[0] ? 0 : 5)]], { c: '#FFFFFF', w: 0.4, a: 0.5, seed: 70 + i, passes: 1 }); }); });
  if (detail > 0.01) {
    ctx.save(); ctx.globalAlpha = detail;
    // greeble: egg-carton patch, louvers, bottle caps, rivets, tape, glue
    const bump = (cx, cy, i) => { const g = ctx.createRadialGradient(...XF([cx - 3, cy - 3]), 1, ...XF([cx, cy]), 13 * s + 1); g.addColorStop(0, '#FBF1D6'); g.addColorStop(1, '#B58A5A'); ctx.fillStyle = g; trace(ctx, Q(P.ellipsePts(cx, cy, 11, 9, 0, 10))); ctx.fill(); P.ink(ctx, Q(P.ellipsePts(cx, cy, 11, 9, 0, 10)), { closed: true, color: INK2, width: 0.45 * lw, boil: B, seed: 90 + i, amp: amp * 0.4, passes: 1, step: 5, alpha: 0.7 }); };
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) bump(222 + c * 23, -118 + r * 22, r * 5 + c);
    for (let i = 0; i < 6; i++) { part(P.rectPts(-330, 52 + i * 12, 134, 6, 2, 2), { c: '#4A3A5C', seed: 100 + i, lw: 0.5, passes: 1 }); }
    // bottle caps
    [[-304, -98, 24, MUST], [262, 76, 20, TEAL]].forEach(([cx, cy, r, c], i) => {
      const rim = []; for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; rim.push([cx + Math.cos(a) * (k % 2 ? r * 0.88 : r), cy + Math.sin(a) * (k % 2 ? r * 0.88 : r)]); }
      part(rim, { c, hc: i ? '#136E66' : MUSTH, seed: 110 + i, gap: 5, lw: 0.8 }); part(P.circlePts(cx, cy, r * 0.55, 14), { c: i ? '#7DE0D4' : '#FFE08A', seed: 112 + i, lw: 0.6 });
    });
    // rivets around seams
    for (let i = 0; i < 18; i++) { const x = [-262, 196, 292][i % 3], y = -130 + Math.floor(i / 3) * 52; disc(x, y, 4.2, '#FFF6D8', 120 + i, { n: 8, lw: 0.45, passes: 1 }); }
    // tape strips (torn ends)
    [[-262, -104, 0.5, 84], [196, 118, -0.4, 76], [292, -96, 0.9, 70]].forEach(([cx, cy, rot, L], i) => {
      const hw = 17, pts = [[-L / 2, -hw], [-L / 2 + 6, -hw * 0.5], [-L / 2 - 2, 0], [-L / 2 + 5, hw * 0.6], [-L / 2, hw], [L / 2, hw], [L / 2 - 6, hw * 0.4], [L / 2 + 3, -hw * 0.2], [L / 2 - 5, -hw * 0.7], [L / 2, -hw]].map(([x, y]) => [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
      part(pts, { c: '#EAD9A4', hc: '#B79A52', ha: 0.35, seed: 130 + i, lw: 0.55, passes: 1, alpha: 0.92, gap: 9 });
    });
    // glue blobs along seams
    for (let i = 0; i < 14; i++) { const x = [-262, 196, 292, -262, 196][i % 5] + (i % 2 ? 9 : -4), y = -138 + hash(i, 7, 1) * 290; disc(x, y, 3 + 3 * hash(i, 7, 2), '#F7EDBE', 140 + i, { n: 8, lw: 0.4, passes: 1 }); }
    // paint chips showing cardboard
    [[-352, -122, 1], [318, -140, 2], [-420, 100, 3], [-345, 150, 4], [296, 150, 5], [90, -148, 6]].forEach(([cx, cy, sd]) => {
      const pts = []; for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU, r = (k % 2 ? 6 : 15) * (0.7 + 0.6 * hash(sd, k, 3)); pts.push([cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r]); }
      part(pts, { c: CARD, hc: CARDH, ha: 0.5, seed: 150 + sd, lw: 0.5, passes: 1, gap: 4 });
    });
    ctx.restore();
  }
  // the stencilled "77" on the nose block
  if (detail > 0.2) { ctx.save(); ctx.globalAlpha = detail; const p = XF([-392, 52]); ctx.translate(p[0], p[1]); ctx.rotate(pose.rot); ctx.font = `${Math.round(66 * s)}px "Bebas Neue", sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = INK; ctx.fillText('77', 0, 0); ctx.restore(); }
  // --- toast-slot vents on the roof: raised boxes with a glowing slot (the toaster joke) ---
  [[-82, -6], [14, 90]].forEach(([x0, x1], i) => {
    part(P.rectPts(x0, -178, x1 - x0, 32, 5, 3), { c: STEEL, hc: STEELH, seed: 160 + i, sil: 1, gap: 5 });
    const slot = P.rectPts(x0 + 10, -168, x1 - x0 - 20, 11, 4, 2), sp = Q(slot);
    const gl = 0.7 + 0.3 * Math.sin(t * 9 + i * 2);
    ctx.fillStyle = '#2A1214'; trace(ctx, sp); ctx.fill();
    ctx.save(); ctx.globalAlpha = 0.4 + 0.5 * gl; ctx.fillStyle = '#FF9A3C'; trace(ctx, Q(P.rectPts(x0 + 13, -166, x1 - x0 - 26, 6, 3, 2))); ctx.fill(); ctx.restore();
    glow(ctx, ...XF([(x0 + x1) / 2, -170]), 56 * s + 4, '#FF9A3C', 0.4 * gl);
    P.ink(ctx, sp, { closed: true, color: INK, width: 0.5 * lw, boil: B, seed: 165 + i, amp: amp * 0.4, passes: 1, step: 5 });
  });
  // --- roof turret + barrel ---
  part(P.rectPts(-266, -178, 90, 14, 5, 3), { c: STEEL, hc: STEELH, seed: 170, sil: 1, gap: 5, lw: 0.8 });
  part(P.ellipsePts(-264, -171, 5, 8, 0, 10), { c: '#25203A', seed: 171, lw: 0.6 });
  const dome = []; for (let k = 0; k <= 14; k++) { const a = Math.PI + (k / 14) * Math.PI; dome.push([-190 + Math.cos(a) * 44, -150 + Math.sin(a) * 44]); }
  part(dome, { c: ORG, hc: ORGH, seed: 172, sil: 1, gap: 6 });
  // --- fin gun ---
  part(P.rectPts(196, -327, 66, 18, 5, 3), { c: STEEL, hc: STEELH, seed: 175, sil: 1, gap: 5, lw: 0.8 });
  part(P.ellipsePts(198, -318, 5, 9, 0, 10), { c: '#25203A', seed: 176, lw: 0.6 });
  // --- antenna: bent paper-clip + a bottle-cap dish that slowly turns ---
  if (detail > 0.01) {
    ctx.save(); ctx.globalAlpha = detail;
    line([[-330, -146], [-330, -196], [-318, -214], [-318, -232]], { c: '#D8DCEE', w: 0.7, a: 0.95, passes: 1 });
    const turn = Math.cos(t * 1.7), rx = 40 * Math.abs(turn) + 8;
    part(P.ellipsePts(-318, -240, rx, 14, -0.25, 16), { c: '#D8DCEE', hc: STEELH, ha: 0.4, seed: 180, lw: 0.7, gap: 5 });
    part(P.ellipsePts(-318, -240, rx * 0.45, 6, -0.25, 12), { c: '#7B7FA3', seed: 181, lw: 0.5, passes: 1 });
    ctx.restore();
  }
  // --- red beacon on the fin tip (blinks) ---
  { const on = Math.floor(t * 2) % 2 === 0, bp = XF([408, -326]); glow(ctx, bp[0], bp[1], 40 * s + 6, '#FF3E4E', on ? 0.85 : 0.2); ctx.fillStyle = on ? '#FFD0D4' : '#8A2A36'; ctx.beginPath(); ctx.arc(bp[0], bp[1], Math.max(2.4, 7 * s), 0, TAU); ctx.fill(); }
  // --- the porthole frame (brass ring, 12 rivets): glass interior is the portal r = 95 ---
  portalFrame(ctx, B, XF, s, lw);
  return { sil, XF };
}

// ------------------------------------------------------------------ the porthole (frame + cockpit glass)
function portalFrame(ctx, B, XF, s, lw) {
  const c0 = XF([0, 0]), r1 = 95 * s, r2 = 129 * s;
  ctx.save();
  const g = ctx.createLinearGradient(c0[0] - r2, c0[1] - r2, c0[0] + r2, c0[1] + r2); g.addColorStop(0, '#FFE9A2'); g.addColorStop(0.5, '#D9A43C'); g.addColorStop(1, '#8D5A1E');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c0[0], c0[1], r2, 0, TAU); ctx.arc(c0[0], c0[1], r1, 0, TAU, true); ctx.fill('evenodd');
  ctx.beginPath(); ctx.arc(c0[0], c0[1], r2, 0, TAU); ctx.arc(c0[0], c0[1], r1, 0, TAU, true); ctx.clip('evenodd');
  P.hatch(ctx, P.circlePts(c0[0], c0[1], r2, 24), { color: '#6A3E12', angle: -0.9, gap: Math.max(4, 7 * s), width: Math.max(1, 1.3 * s), alpha: 0.5, boil: B, seed: 201, shade: (x, y) => clamp(((y - c0[1]) / r2) * 0.8 + 0.55, 0, 1), comp: 'multiply' });
  ctx.restore();
  // dark inner lip (outside r1 so the glass stays pristine) + outer outline
  ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 6 * s + 0.5; ctx.beginPath(); ctx.arc(c0[0], c0[1], r1 + 3 * s, 0, TAU); ctx.stroke(); ctx.restore();
  P.ink(ctx, P.circlePts(c0[0], c0[1], r2, 56), { closed: true, color: INK, width: 1.15 * lw, boil: B, seed: 202, amp: 0.9 * Math.pow(s, 0.5), passes: 2, step: Math.max(7, 12 * s), alpha: 0.95 });
  // rivets
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + 0.26, rr = 112 * s, x = c0[0] + Math.cos(a) * rr, y = c0[1] + Math.sin(a) * rr;
    ctx.fillStyle = '#FFF6D8'; ctx.beginPath(); ctx.arc(x, y, Math.max(1.6, 6.2 * s), 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(80,44,10,0.7)'; ctx.beginPath(); ctx.arc(x + 1.6 * s, y + 1.8 * s, Math.max(1, 3 * s), 0, TAU); ctx.fill();
    P.ink(ctx, P.circlePts(x, y, Math.max(1.6, 6.2 * s), 8), { closed: true, color: INK, width: 0.5 * lw, boil: B, seed: 210 + i, amp: 0.3, passes: 1, step: 4, alpha: 0.8 });
  }
}
function portalGlass(ctx, B, t, o = {}) {              // cockpit glow: EXACTLY the portal circle (1150,520) r=95
  const { cx, cy, r } = PORT, pulse = 0.5 + 0.5 * Math.sin((t - T0) * 5.2), up = smooth((t - 15.2) / 0.25);
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
  const g = ctx.createRadialGradient(cx - 14, cy - 22, 4, cx, cy, r * 1.02);
  g.addColorStop(0, '#FFF7CF'); g.addColorStop(0.42, '#FFCE62'); g.addColorStop(0.82, '#F59232'); g.addColorStop(1, '#C1501E');
  ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  // ceiling hatching (warm shading toward the rim)
  P.hatch(ctx, P.circlePts(cx, cy, r, 28), { color: '#8E3A12', angle: -0.9, gap: 6, width: 1.4, alpha: 0.55, boil: B, seed: 221, shade: (x, y) => clamp(Math.hypot(x - cx, y - cy) / r * 1.25 - 0.3, 0, 1), comp: 'multiply' });
  // cockpit: console, window struts, dials
  ctx.fillStyle = '#3A1A24'; trace(ctx, [[cx - 100, cy + 34], [cx - 44, cy + 24], [cx + 18, cy + 30], [cx + 100, cy + 22], [cx + 100, cy + 100], [cx - 100, cy + 100]]); ctx.fill();
  ctx.fillStyle = '#5A2A34'; trace(ctx, [[cx - 100, cy + 34], [cx - 44, cy + 24], [cx + 18, cy + 30], [cx + 100, cy + 22], [cx + 100, cy + 31], [cx + 18, cy + 39], [cx - 44, cy + 33], [cx - 100, cy + 43]]); ctx.fill();
  [[-62, 52, '#FF4B4B', 0], [-34, 58, '#7DF2A0', 1], [-6, 54, '#7DEBFF', 2], [26, 60, '#FFE070', 3], [58, 54, '#FF4B4B', 4], [80, 62, '#7DF2A0', 5]].forEach(([dx, dy, c, i]) => {
    const on = hash(i, Math.floor(t * 5), 6) > 0.3; ctx.fillStyle = on ? c : '#4A2A34'; ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 5.2, 0, TAU); ctx.fill();
    if (on) glow(ctx, cx + dx, cy + dy, 14, c, 0.5);
  });
  // a tiny toy pilot (cardboard doll) at the controls: helmet, visor, shoulders
  ctx.fillStyle = '#2C1420'; trace(ctx, [[cx - 38, cy + 34], [cx - 34, cy + 6], [cx - 14, cy - 2], [cx + 6, cy + 8], [cx + 10, cy + 34]]); ctx.fill();
  ctx.beginPath(); ctx.arc(cx - 15, cy - 22, 17, 0, TAU); ctx.fill();
  ctx.fillStyle = '#FFB44A'; ctx.beginPath(); ctx.ellipse(cx - 8, cy - 22, 8, 6, 0.1, 0, TAU); ctx.fill();
  ctx.fillStyle = '#FFF4C8'; ctx.beginPath(); ctx.ellipse(cx - 10, cy - 24, 3, 2, -0.4, 0, TAU); ctx.fill();
  P.ink(ctx, P.circlePts(cx - 15, cy - 22, 17, 14), { closed: true, color: '#2C1420', width: 2.2, boil: B, seed: 223, amp: 0.5, passes: 1, step: 6 });
  // glass: highlight arcs
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineCap = 'round'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, Math.PI * 1.12, Math.PI * 1.46); ctx.stroke();
  ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, Math.PI * 1.52, Math.PI * 1.6); ctx.stroke();
  glow(ctx, cx, cy, r * 1.05, '#FFF0B0', 0.18 + 0.1 * pulse * up);
  ctx.restore();
  if (o.halo) glow(ctx, cx, cy, 300, '#FFC25A', 0.18 + 0.12 * pulse * up);
}

// ------------------------------------------------------------------ wires (silver piano wire to the ceiling rig, with travelling glints)
function drawWires(ctx, B, t, pose) {
  const XF = mkXF(pose);
  ctx.save(); ctx.lineCap = 'round';
  WIRE_AT.forEach((a, i) => {
    const p = XF(a), sway = Math.sin((t - T0) * 2.1 + i * 1.7) * 3 + (hash(i, B, 4) - 0.5) * 0.8, top = [p[0] + (p[0] - 960) * 0.08 + sway, 20];
    ctx.strokeStyle = 'rgba(8,10,34,0.55)'; ctx.lineWidth = 3.2; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
    ctx.strokeStyle = 'rgba(226,232,250,0.78)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
    const ph = ((t - T0) * 0.55 + i * 0.37) % 1, gx = lerp(p[0], top[0], ph), gy = lerp(p[1], top[1], ph);
    const gr = ctx.createLinearGradient(gx, gy + 40, gx, gy - 40); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = gr; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(gx - (top[0] - p[0]) * 0.03, gy + 40); ctx.lineTo(gx + (top[0] - p[0]) * 0.03, gy - 40); ctx.stroke();
    // little eyelet where the wire is tied on
    ctx.strokeStyle = '#FFF6D8'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p[0], p[1] - 3, 3.4 * Math.max(0.6, pose.s), 0, TAU); ctx.stroke();
  });
  ctx.restore();
}

// ================================================================== lasers: muzzle flash, tapered bolt with halo, impact
function boltState(k, t) {
  const tk = ZAPS[k], tf = tk - 0.0667, head = clamp((t - tf) / 0.0667), tail = t <= tk ? Math.max(0, head - 0.8) : clamp(0.2 + ((t - tk) / 0.04) * 0.8), after = t - tk;
  return { tk, tf, head, tail, after, on: t >= tf - 1e-4 && t < tk + 0.2 };
}
function drawBolts(ctx, B, t, pose) {
  const XF = mkXF(pose), s = pose.s, lights = [];
  for (let k = 0; k < 3; k++) {
    const b = boltState(k, t); if (!b.on) continue;
    const m = XF(MUZ[k]), q = [TG.x, TG.y + 6];
    const hx = lerp(m[0], q[0], b.head), hy = lerp(m[1], q[1], b.head), tx = lerp(m[0], q[0], b.tail), ty = lerp(m[1], q[1], b.tail);
    const dx = q[0] - m[0], dy = q[1] - m[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L, w0 = 8 + 10 * s, w1 = 3.6;
    const wAt = (f) => lerp(w0, w1, f);
    const vis = b.after < 0.045;                 // the bolt itself exists for ~3 frames, then a thin afterglow
    if (vis && b.head > 0.001) {
      const f0 = b.tail, f1 = b.head, quad = (sc) => [[tx + nx * wAt(f0) * sc, ty + ny * wAt(f0) * sc], [hx + nx * wAt(f1) * sc * 0.8, hy + ny * wAt(f1) * sc * 0.8], [hx - nx * wAt(f1) * sc * 0.8, hy - ny * wAt(f1) * sc * 0.8], [tx - nx * wAt(f0) * sc, ty - ny * wAt(f0) * sc]];
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      [[3.2, 'rgba(255,40,100,0.22)'], [2.2, 'rgba(255,70,120,0.4)'], [1.45, 'rgba(255,140,170,0.7)']].forEach(([sc, c]) => { ctx.fillStyle = c; trace(ctx, quad(sc)); ctx.fill(); });
      ctx.restore();
      ctx.save(); ctx.fillStyle = '#FFFFFF'; trace(ctx, quad(0.5)); ctx.fill(); ctx.restore();
      // drawn pencil scribble along the streak (coloured pencil, boils)
      const o1 = wAt((f0 + f1) / 2) * 0.9;
      [-1, 1].forEach((sg, i) => P.ink(ctx, [[tx + nx * o1 * sg, ty + ny * o1 * sg], [(tx + hx) / 2 + nx * o1 * sg * 1.1, (ty + hy) / 2 + ny * o1 * sg * 1.1], [hx + nx * o1 * sg * 0.7, hy + ny * o1 * sg * 0.7]], { closed: false, color: '#FF9DB8', width: 2.2, boil: B, seed: 300 + k * 5 + i, amp: 1.3, passes: 2, step: 12, alpha: 0.85 }));
      glow(ctx, hx, hy, 46, '#FF4F8A', 0.55);
    } else if (b.after >= 0.045 && b.after < 0.17) {
      const a = Math.exp(-(b.after - 0.045) / 0.05) * 0.5;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,120,170,${a})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(m[0], m[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.restore();
    }
    // muzzle flash (spiky star + halo)
    const mf = clamp((t - b.tf + 0.01) / 0.012) * Math.exp(-Math.max(0, t - b.tf) / 0.055);
    if (mf > 0.02) {
      const R = (34 + 40 * s) * (0.7 + 0.5 * mf);
      glow(ctx, m[0], m[1], R * 2.6, '#FF8FB0', 0.8 * mf);
      const sp = star(m[0], m[1], R, R * 0.28, 7, hash(k, B, 1) * 3);
      ctx.save(); ctx.fillStyle = '#FFF6CF'; trace(ctx, sp); ctx.fill(); ctx.restore();
      P.ink(ctx, sp, { closed: true, color: '#FF4F8A', width: 2, boil: B, seed: 320 + k, amp: 1.2, passes: 2, step: 7, alpha: 0.9 * mf });
      lights.push({ x: m[0], y: m[1], a: mf, c: '255,210,230' });
    }
    // impact on the target
    const ia = b.after >= -0.002 && b.after < 0.2 ? Math.exp(-Math.max(0, b.after) / 0.07) : 0;
    if (ia > 0.02 && !(k === 2)) {
      const R = 40 * (0.5 + 0.7 * (1 - ia * 0.4));
      glow(ctx, q[0], q[1], R * 2.8, '#FFD2A0', 0.9 * ia);
      const sp = star(q[0], q[1], R, R * 0.3, 8, 0.4 + k);
      ctx.save(); ctx.fillStyle = '#FFFFFF'; trace(ctx, sp); ctx.fill(); ctx.restore();
      P.ink(ctx, sp, { closed: true, color: '#FF7A3A', width: 2.4, boil: B, seed: 330 + k, amp: 1.4, passes: 2, step: 7, alpha: 0.95 * ia });
      for (let i = 0; i < 9; i++) { const a = hash(k, i, 11) * TAU, d0 = 20 + 90 * (1 - ia) * (0.6 + hash(k, i, 12)), d1 = d0 + 16 + 24 * hash(k, i, 13); ctx.save(); ctx.strokeStyle = `rgba(255,${200 + 50 * hash(k, i, 14)},120,${ia})`; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(q[0] + Math.cos(a) * d0, q[1] + Math.sin(a) * d0); ctx.lineTo(q[0] + Math.cos(a) * d1, q[1] + Math.sin(a) * d1); ctx.stroke(); ctx.restore(); }
    }
  }
  return lights;
}

// ================================================================== the miniature-pyro explosion (15.0)
function puff(ctx, B, x, y, r, col, seed, o = {}) {
  const pts = []; const n = 14;
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU, rr = r * (0.86 + 0.2 * hash(seed, i, 1) + 0.06 * Math.sin(i * 3 + B)); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * (o.sq ?? 0.92)]); }
  const sm = P.smoothPts(pts, { closed: true, n: 3 });
  ctx.save(); ctx.globalAlpha *= o.alpha ?? 1; ctx.fillStyle = col; trace(ctx, sm); ctx.fill();
  if (o.hatch) P.hatch(ctx, sm, { color: o.hatch, angle: o.ang ?? -0.7, gap: Math.max(4, r * 0.16), width: 1.5, alpha: 0.55, boil: B, seed: seed + 3, shade: (px, py) => clamp(((py - y) / r + 1) * 0.5 + 0.2, 0, 1), comp: 'multiply' });
  if (o.lit) { ctx.save(); trace(ctx, sm); ctx.clip(); const g = ctx.createRadialGradient(x + o.lit[0] * r, y + o.lit[1] * r, 0, x + o.lit[0] * r, y + o.lit[1] * r, r * 1.3); g.addColorStop(0, P.rgba(o.litC ?? '#FFB060', 0.55)); g.addColorStop(1, P.rgba(o.litC ?? '#FFB060', 0)); ctx.fillStyle = g; ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4); ctx.restore(); }
  P.ink(ctx, sm, { closed: true, color: o.ink ?? INK, width: o.w ?? 2.8, boil: B, seed: seed + 7, amp: 1.3, passes: 2, step: 9, alpha: 0.95 * (o.alpha ?? 1) });
  ctx.restore();
}
function drawExplosion(ctx, B, t) {
  const d = t - BOOM; if (d < -1e-4) return;
  const { x, y } = TG;
  ctx.save();
  // 1. the white flash + shock ring
  const flash = Math.exp(-Math.max(0, d) / 0.08);
  if (d < 0.35) {
    glow(ctx, x, y, 340 * (0.7 + Math.min(d, 0.2) * 2.5), '#FFF1C0', 0.95 * flash, 'lighter');
    const rr = 40 + 520 * outCubic(clamp(d / 0.4)), ra = 0.9 * Math.exp(-d / 0.16);
    ctx.save(); ctx.strokeStyle = `rgba(255,236,190,${ra})`; ctx.lineWidth = 7 * (1 - d / 0.45) + 1.5; ctx.beginPath(); ctx.ellipse(x, y, rr, rr * 0.82, 0, 0, TAU); ctx.stroke(); ctx.restore();
    P.ink(ctx, P.ellipsePts(x, y, rr * 1.04, rr * 0.86, 0, 60), { closed: true, color: '#FFE9B0', width: 2.2, boil: B, seed: 401, amp: 3, passes: 2, step: 16, alpha: 0.7 * ra });
  }
  glow(ctx, x, y, 300, '#FF8A2A', 0.5 * Math.exp(-Math.max(0, d) / 0.45) * (d > 0.05 ? 1 : 0));
  // 2. jagged star burst (three nested stars, spikes re-roll with every boil frame)
  const burstK = lerp(0.6, 1, outBack(clamp(d / 0.12), 1.2)), burstA = 1 - smooth((d - 0.3) / 0.22);
  if (burstA > 0.01) {
    const R = 210 * burstK * (1 + 0.25 * clamp(d, 0, 0.5)), spikes = (n, seed, r0) => { const pts = []; for (let i = 0; i < n * 2; i++) { const a = (i * Math.PI) / n + hash(seed, 1, 1) * 6, rr = (i % 2 ? r0 * (0.38 + 0.18 * hash(seed, i, B)) : r0 * (0.8 + 0.5 * hash(seed, i, B + 9))); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.9]); } return pts; };
    ctx.save(); ctx.globalAlpha = burstA;
    [[17, 501, 1.0, '#FF4A2A', 5], [14, 502, 0.74, '#FF9A24', 4], [11, 503, 0.5, '#FFE45A', 3.4], [8, 504, 0.28, '#FFFBE0', 2.4]].forEach(([n, sd, k, c, w]) => {
      const sp = spikes(n, sd, R * k); ctx.fillStyle = c; trace(ctx, sp); ctx.fill();
      P.ink(ctx, sp, { closed: true, color: k > 0.6 ? '#4A1410' : '#B4401A', width: w, boil: B, seed: sd + 20, amp: 1.5, passes: 2, step: 9, alpha: 0.95 });
    });
    // radiating pencil strokes
    for (let i = 0; i < 26; i++) { const a = hash(i, 5, 31) * TAU, r0 = R * (0.3 + 0.2 * hash(i, 5, 32)), r1 = R * (0.62 + 0.4 * hash(i, 5, B)); ctx.strokeStyle = i % 2 ? 'rgba(120,20,10,0.55)' : 'rgba(255,255,230,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0 * 0.9); ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1 * 0.9); ctx.stroke(); }
    ctx.restore();
  }
  // 3. cauliflower fireball: layered puffs, hot core -> sooty rim, cooling to dark red
  const fk = clamp(d / 0.85), fa = 1 - smooth((fk - 0.74) / 0.26), grow = outCubic(clamp(d / 0.35));
  if (fa > 0.01 && d > 0.03) {
    for (let i = 0; i < 11; i++) {
      const a = hash(i, 6, 1) * TAU, dist = (30 + 90 * hash(i, 6, 2)) * grow * (1 + 0.25 * fk), r = (34 + 46 * hash(i, 6, 3)) * (0.35 + 0.65 * grow) * (1 + 0.2 * fk);
      const px = x + Math.cos(a) * dist, py = y + Math.sin(a) * dist * 0.8 - 40 * fk * (0.4 + hash(i, 6, 4));
      const cool = clamp(fk * 0.95 + hash(i, 6, 5) * 0.25, 0, 1), col = mx(mx('#FFDA3A', '#FF7E1C', clamp(cool * 1.6, 0, 1)), '#C23A18', clamp(cool * 1.5 - 0.8, 0, 1));
      puff(ctx, B, px, py, r, col, 600 + i, { alpha: fa, hatch: '#B8300F', ink: '#5A1A10', w: 3.2, lit: [-0.2, -0.3], litC: '#FFF0A0' });
    }
    puff(ctx, B, x, y - 10 * fk, 70 * (0.5 + 0.5 * grow) * (1 - 0.3 * fk), '#FFF3B0', 640, { alpha: fa * (1 - fk * 0.6), ink: '#C8501E', w: 2.4 });
  }
  // 4. sparks + cardboard debris (ballistic with drag), each leaves a short trail
  for (let i = 0; i < 46; i++) {
    const a = hash(i, 7, 1) * TAU, v = 380 + 760 * hash(i, 7, 2), k = 3.2 + 2 * hash(i, 7, 3), dd = (1 - Math.exp(-k * Math.max(0, d))) / k, life = 0.25 + 0.55 * hash(i, 7, 4);
    if (d < 0 || d > life) continue; const al = 1 - smooth(d / life), px = x + Math.cos(a) * v * dd, py = y + Math.sin(a) * v * dd * 0.85, tl = 0.045;
    const dd2 = (1 - Math.exp(-k * Math.max(0, d - tl))) / k, qx = x + Math.cos(a) * v * dd2, qy = y + Math.sin(a) * v * dd2 * 0.85;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,${190 + 60 * hash(i, 7, 5)},110,${al})`; ctx.lineWidth = 2.6 * (1 - 0.5 * d); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(px, py); ctx.stroke(); ctx.restore();
  }
  const DEB = [['#B5BAD8', 1], ['#F1E7D0', 2], ['#B33A7A', 3], ['#C9CDE6', 4], ['#7C82A8', 5], ['#EC6A2C', 6], ['#F4B63A', 7], ['#B5BAD8', 8], ['#C9A56B', 9], ['#F1E7D0', 10], ['#B33A7A', 11], ['#9A9FC0', 12]];
  DEB.forEach(([c, i]) => {
    const a = hash(i, 8, 1) * TAU, v = 260 + 520 * hash(i, 8, 2), kk = 1.6 + 1.2 * hash(i, 8, 3), dd = (1 - Math.exp(-kk * Math.max(0, d))) / kk;
    if (d < 0) return; const px = x + Math.cos(a) * v * dd, py = y + Math.sin(a) * v * dd * 0.85 + 60 * d * d, sz = 9 + 17 * hash(i, 8, 4), rot = hash(i, 8, 5) * TAU + d * (6 + 12 * hash(i, 8, 6)) * (hash(i, 8, 7) < 0.5 ? -1 : 1);
    const al = 1 - smooth((d - 0.55) / 0.35); if (al <= 0.01) return;
    const pts = P.xform([[-sz, -sz * 0.5], [sz * 0.8, -sz * 0.7], [sz, sz * 0.5], [-sz * 0.4, sz * 0.8]], { x: px, y: py, rot });
    ctx.save(); ctx.globalAlpha = al; ctx.fillStyle = c; trace(ctx, pts); ctx.fill(); P.ink(ctx, pts, { closed: true, color: INK, width: 2.2, boil: B, seed: 700 + i, amp: 0.7, passes: 2, step: 6 }); ctx.restore();
  });
  // 5. smoke: sooty puffs drifting up and sideways (miniature pyro), ink spirals inside, curl ribbons trailing up (they linger through the dive)
  const sk = d - 0.2;
  if (sk > 0) {
    for (let i = 0; i < 13; i++) {
      const u = clamp(sk / 0.85), born = hash(i, 9, 1) * 0.3, uu = clamp((u - born) / (1 - born)); if (uu <= 0) continue;
      const a = hash(i, 9, 2) * TAU, r0 = 40 + 70 * hash(i, 9, 3);
      const px = x + Math.cos(a) * r0 * (0.4 + uu) + 70 * uu * (hash(i, 9, 4) - 0.1) + 16 * Math.sin(uu * 4 + i), py = y + Math.sin(a) * r0 * 0.5 - 170 * uu * (0.5 + hash(i, 9, 5)) + 20 * uu;
      const r = (34 + 36 * hash(i, 9, 6)) * (0.5 + 0.8 * uu), al = clamp(uu * 6, 0, 1) * (1 - smooth((uu - 0.7) / 0.3)) * 0.95;
      puff(ctx, B, px, py, r, mx('#3B3346', '#6B6076', 0.4 + 0.4 * hash(i, 9, 7)), 800 + i, { alpha: al, hatch: '#120C1C', ink: '#120C1C', w: 2.6, lit: [0, 0.55], litC: '#FF8A3A' });
      const cp = []; for (let k = 0; k <= 16; k++) { const aa = k * 0.55 + i, rr = r * (0.15 + 0.62 * k / 16); cp.push([px + Math.cos(aa) * rr, py + Math.sin(aa) * rr * 0.9]); }
      ctx.save(); ctx.globalAlpha = al; P.ink(ctx, cp, { closed: false, color: '#D8CFE4', width: 1.8, boil: B, seed: 820 + i, amp: 0.9, passes: 1, step: 7, alpha: 0.7 }); ctx.restore();
    }
    for (let i = 0; i < 3; i++) {                   // curl ribbons: pencil spirals climbing out of the burst
      const u = clamp((sk - i * 0.05) / 0.8); if (u <= 0) continue;
      const pts = []; for (let k = 0; k <= 26; k++) { const v = k / 26 * u, a = v * 11 + i * 2, rr = 14 + 40 * v; pts.push([x + (i - 1) * 60 + Math.cos(a) * rr + 30 * v * (i - 1), y - 30 - 260 * v + Math.sin(a) * rr * 0.35]); }
      ctx.save(); ctx.globalAlpha = (1 - smooth((u - 0.6) / 0.4)) * 0.9; P.ink(ctx, pts, { closed: false, color: i % 2 ? '#3A2E48' : '#6B6076', width: 4, boil: B, seed: 840 + i, amp: 1.2, passes: 2, step: 9, alpha: 0.9, taper: true }); ctx.restore();
    }
  }
  ctx.restore();
}

// ================================================================== Amrita (bottom-left, tiny, rim-lit) + viewfinder
function amritaState(t, ship) {
  const lt = t - T0, R = AM.R;
  let squash = 0.012 * Math.sin(lt * 3.9), dy = Math.sin(lt * 3.9 + 0.7) * R * 0.04;
  ZAPS.forEach((z) => { const dd = t - z; if (dd >= -0.0334 && dd < 0.4) squash += 0.12 * Math.exp(-Math.max(0, dd) / 0.1) * Math.cos(Math.max(0, dd) * 24); });
  const bd = t - BOOM; let hop = 0;
  if (bd >= 0 && bd < 0.5) { const u = bd / 0.5; hop = Math.sin(u * Math.PI) * 0.42 * R * (1 - 0.3 * u); }
  const awe = smooth((t - 14.0) / 0.2) * (1 - smooth((t - 14.3) / 0.2)), det = smooth((t - 14.25) / 0.15) * (1 - smooth((bd + 0.02) / 0.04));
  const sur = clamp(bd >= 0 ? smooth(bd / 0.05) * (1 - smooth((bd - 0.25) / 0.2)) : 0, 0, 1), joy = smooth((bd - 0.3) / 0.15);
  const eye = { open: 1, surprised: 0.5 * awe + 1.0 * sur + 0.25 * joy, determined: 0.7 * det, happy: joy, squint: 0 };
  return { x: AM.x + Math.sin(lt * 1.3) * 3, y: AM.y + dy - hop, squash, eye, bd };
}
function drawAmrita(ctx, T, S, ship, lights) {
  const t = T.t, st = amritaState(t, ship), R = AM.R, c = tmpCanvas(S, 600, 520), g = c.getContext('2d');
  const ox = 300, oy = 300; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
  g.setTransform(S.scale, 0, 0, S.scale, (ox - st.x) * S.scale, (oy - st.y) * S.scale);
  const look = (() => { const dx = ship.x - st.x, dy = ship.y - st.y, d = Math.hypot(dx, dy) || 1; return { lookX: (dx / d) * 0.9, lookY: (dy / d) * 0.7 }; })();
  const o = { x: st.x, y: st.y, size: R, yaw: 0.42, roll: -0.04, squash: st.squash, eye: { ...st.eye, ...look }, groundY: st.y + R * 1.1, seed: 31, shadow: false, prop: null };
  const bd = st.bd;
  if (bd >= 0 && bd < 0.45) { o.fx = [{ kind: 'exclaim' }]; o.fxT = Math.max(0, bd); }
  S.amrita2d.drawAmrita(g, T, S, o);
  g.setTransform(S.scale, 0, 0, S.scale, (ox - st.x) * S.scale, (oy - st.y) * S.scale);
  // near-silhouette: blue shadow on the side away from the ship's glow, bright rim from the flashes (clipped to the disc: the prop stays untouched)
  g.save(); g.beginPath(); g.arc(st.x, st.y, R * 1.04, 0, TAU); g.clip(); g.globalCompositeOperation = 'source-atop';
  const sg = g.createLinearGradient(st.x - R * 1.2, st.y + R * 0.9, st.x + R * 1.1, st.y - R * 0.8); sg.addColorStop(0, 'rgba(8,10,60,0.34)'); sg.addColorStop(0.6, 'rgba(14,20,90,0.12)'); sg.addColorStop(1, 'rgba(60,70,170,0.0)');
  g.fillStyle = sg; g.fillRect(st.x - R * 4, st.y - R * 4, R * 8, R * 8);
  const fl = Math.max(0, ...ZAPS.map((z) => (t > z - 0.04 && t < z + 0.4 ? Math.exp(-Math.max(0, t - z + 0.03) / 0.08) : 0)));
  const boom = t >= BOOM ? Math.exp(-(t - BOOM) / 0.35) : 0;
  const lg = g.createRadialGradient(st.x + R * 1.0, st.y - R * 1.5, 0, st.x + R * 1.0, st.y - R * 1.5, R * 3.2); lg.addColorStop(0, `rgba(255,170,90,${0.75 * boom})`); lg.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = lg; g.fillRect(st.x - R * 4, st.y - R * 4, R * 8, R * 8);
  const lr = g.createRadialGradient(st.x + R * 2, st.y - R * 1.1, 0, st.x + R * 2, st.y - R * 1.1, R * 3.4); lr.addColorStop(0, `rgba(255,150,190,${0.5 * fl + 0.1})`); lr.addColorStop(1, 'rgba(255,150,190,0)');
  g.fillStyle = lr; g.fillRect(st.x - R * 4, st.y - R * 4, R * 8, R * 8);
  g.restore();
  glow(ctx, st.x + R * 0.8, st.y - R * 0.5, R * 1.9, '#9FB4FF', 0.14 + 0.2 * boom + 0.14 * fl);
  ctx.drawImage(c, st.x - ox, st.y - oy, 600, 520);
  // ---- the VIEWFINDER: rests at her side, snaps up at 14.25 and tracks the shot (ship -> the explosion at 15.0 -> the porthole)
  const aimAt = (() => {
    const A = [ship.x, ship.y], B2 = [TG.x, TG.y - 20], k1 = smooth((t - (BOOM + 0.04)) / 0.12), k2 = smooth((t - (BOOM + 0.5)) / 0.25);
    const p1 = [lerp(A[0], B2[0], k1), lerp(A[1], B2[1], k1)]; return [lerp(p1[0], PORT.cx, k2), lerp(p1[1], PORT.cy, k2)];
  })();
  const ang = Math.atan2(aimAt[1] - st.y, aimAt[0] - st.x), up = spring(t - FINDER_T, 3.2, 0.5), rise = t < FINDER_T ? 0 : clamp(up, 0, 1.15);
  const dist = lerp(R * 1.75, R * 2.15, rise), size = lerp(R * 0.85, R * 1.6, rise);
  const rx = st.x + Math.cos(ang) * dist * rise + R * 1.75 * (1 - rise), ry = st.y + Math.sin(ang) * dist * rise + R * 0.45 * (1 - rise) - 6 * (1 - rise);
  const wob = 0.025 * Math.sin(t * 5.3) + (t >= BOOM && t < BOOM + 0.25 ? 0.05 * Math.sin((t - BOOM) * 60) * Math.exp(-(t - BOOM) / 0.1) : 0);
  glow(ctx, rx, ry, size * 1.5, '#FFB62E', 0.16 * rise);
  ctx.save(); ctx.translate(rx, ry); ctx.rotate(lerp(0.3, ang * 0.55, rise) + wob);
  S.amrita2d.drawProp(ctx, T, S, 'viewfinder', { x: 0, y: 0, size, anim: { t, rec: t >= FINDER_T }, boil: T.boil, seed: 41, style: 'ink' });
  ctx.restore();
  return st;
}

// ================================================================== the frame
export default {
  id: 'e1977', kind: '2d',
  draw(ctx, T, S) {
    const B = T.boil, t = T.t, pose = shipPose(t);
    ctx.save();
    ctx.drawImage(layer(S, 'sky|' + B, (g) => drawSkyLayer(g, S, B)), 0, 0, 1920, 1080);
    // flash that lights the sky / planet (the target blows up in front of it)
    const bd = t - BOOM;
    if (bd >= 0 && bd < 0.9) {
      glow(ctx, TG.x, TG.y, 1000, '#FF9A50', 0.28 * Math.exp(-bd / 0.3));
      glow(ctx, PLANET.cx + 90, PLANET.cy - 90, 300, '#FFB060', 0.12 * Math.exp(-bd / 0.25));
    }
    const hitPulse = Math.max(0, ...ZAPS.slice(0, 2).map((z) => (t >= z && t < z + 0.15 ? Math.exp(-(t - z) / 0.05) : 0)));
    drawTarget(ctx, B, t, hitPulse);
    drawExplosion(ctx, B, t);
    // the ship, lit by flashes
    const ship = drawShip(ctx, B, t, pose, S);
    const lights = drawBolts(ctx, B, t, pose);
    if (bd >= 0 && bd < 0.8) lights.push({ x: TG.x, y: TG.y, a: 0.8 * Math.exp(-bd / 0.3), c: '255,170,90', big: 1 });
    if (lights.length) {
      ctx.save(); ctx.beginPath(); ship.sil.forEach((p) => trace(ctx, p, true)); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      lights.forEach((l) => { const R = (l.big ? 1100 : 260 + 280 * pose.s), g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, R); g.addColorStop(0, `rgba(${l.c},${0.55 * l.a})`); g.addColorStop(1, `rgba(${l.c},0)`); ctx.fillStyle = g; ctx.fillRect(l.x - R, l.y - R, 2 * R, 2 * R); });
      ctx.globalCompositeOperation = 'source-over';
      lights.forEach((l) => { const R = (l.big ? 900 : 230 + 220 * pose.s); hatchField(ctx, B, { x0: l.x - R, y0: l.y - R, x1: l.x + R, y1: l.y + R, angle: -0.8, gap: 6, seg: 40, color: `rgb(${l.c})`, alpha: 0.7 * l.a, width: 1.5, seed: 55, dens: (x, y) => clamp(1 - Math.hypot(x - l.x, y - l.y) / R, 0, 1) }); });
      ctx.restore();
    }
    drawWires(ctx, B, t, pose);
    const am = drawAmrita(ctx, T, S, pose, lights);
    // the portal glass is the very last thing painted: pristine, exactly (1150,520) r=95 once the ship is at rest
    if (t >= SETTLE - 0.02) portalGlass(ctx, B, t, { halo: true });
    else { const XF = mkXF(pose), c0 = XF([0, 0]); ctx.save(); ctx.translate(c0[0], c0[1]); ctx.scale(pose.s, pose.s); ctx.translate(-PORT.cx, -PORT.cy); portalGlass(ctx, B, t, {}); ctx.restore(); }
    ctx.restore();
  },
  grade: (T) => { const bd = T.t - BOOM, fl = bd >= 0 ? Math.exp(-bd / 0.12) : 0, z = Math.max(0, ...ZAPS.map((z) => (T.t >= z - 0.03 && T.t < z + 0.2 ? Math.exp(-Math.max(0, T.t - z) / 0.06) : 0))); return { halation: 0.22 + 0.5 * fl + 0.2 * z, bright: 1 + 0.16 * fl + 0.05 * z }; },
  barColor: '#0b0a0d',
};
