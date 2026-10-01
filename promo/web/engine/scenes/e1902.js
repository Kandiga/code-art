// =============================================================================
// e1902 — STAGE MAGIC (6.0–8.0, 4:3, sepia, prop: hand-crank camera, portal EYE @ (960,470) r=120)
// A painted theatre stage seen head-on: gilded proscenium, velvet curtains that swing open (6.0), painted flats
// (night sky, hills, a cardboard castle, cardboard clouds, stars on strings) and a giant painted crescent moon
// (profile, opening LEFT) whose sleepy closed eye is the portal.  6.5 POOF -> Amrita + camera, confetti, sparks;
// 6.75 sparkle_up + theatrical bow; 7.0-7.5 the moon wakes: its eye opens wide and stares into the lens (dive target).
// Pure function of time. Drawn on paper with offset flat fills, hatching, doubled wobbly ink, 12 fps boil.
// Value design is for the SEPIA grade (applied after we draw): dark sky / bright moon / mid velvet / gold.
// =============================================================================
import { hash, noise1 } from '../rng.js';
import { wobble, resample } from '../pencil.js';
import { clamp, lerp, smooth, smoother, outCubic, outBack, inOutCubic, spring } from '../ease.js';

const TAU = Math.PI * 2;
export const EYE = { x: 960, y: 470, r: 120 };
const OPEN = { x0: 365, x1: 1555, y0: 178, floorY: 852, y1: 962 }; // the stage opening inside the proscenium
export const INK = '#221d27';
export const GOLD = '#E2B650', GOLD_L = '#F8E3A2', GOLD_D = '#946416';
export const VEL = '#C23048', VEL_L = '#F58A9C', VEL_D = '#7A1C30';
const CREAM = '#FFF0C8', OCHRE = '#C99A3E';
const AMR = { x: 960, y: 794, size: 150 }; // Amrita pops in centre-stage, below the moon's eye
const POOF = { x: 960, y: 806 };
const AMR_PAL = { blade: '#FF7C4E', bladeAlt: '#FFD870', face: '#FFF6DC' }; // lighter pigment so she survives the sepia grade on dark flats

// ---------- small helpers --------------------------------------------------------------------------------------
export const path = (ctx, pts, close = true) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (close) ctx.closePath(); };
const g = (x, mu, sg) => Math.exp(-0.5 * ((x - mu) / sg) ** 2);
const rot2 = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

// layer cache: static layers are re-drawn once per 12 fps boil step (not per 30 fps frame)
const _cache = new Map();
export function cached(S, key, draw) {
  const k = key + '@' + S.scale;
  let c = _cache.get(k);
  if (!c) {
    c = S.mk(); const gx = c.getContext('2d'); gx.setTransform(S.scale, 0, 0, S.scale, 0, 0); draw(gx);
    _cache.set(k, c);
    while (_cache.size > 6) _cache.delete(_cache.keys().next().value);
  }
  return c;
}
export const blit = (ctx, c) => ctx.drawImage(c, 0, 0, 1920, 1080);

// quick pencil hatch of a bbox (caller sets the clip). dashes + seeded jitter, boils with `boil`.
export function hatchBox(ctx, bx, { angle = -0.8, gap = 8, color = '#000', width = 1.2, alpha = 0.5, seed = 1, boil = 0, jit = 1.4, comp = 'multiply', dash = 60, keep = 0.85 } = {}) {
  // lines are generated only where they cross the bbox; dashes are batched into 3 alpha buckets (3 strokes instead of hundreds)
  const c = Math.cos(angle), s = Math.sin(angle), nx = -s, ny = c;
  const x0 = bx.x, x1 = bx.x + bx.w, y0 = bx.y, y1 = bx.y + bx.h;
  const pr = [x0 * nx + y0 * ny, x1 * nx + y0 * ny, x0 * nx + y1 * ny, x1 * nx + y1 * ny];
  const o0 = Math.min(...pr), o1 = Math.max(...pr), n = Math.ceil((o1 - o0) / gap), i0 = Math.floor(o0 / gap);
  const B3 = [new Path2D(), new Path2D(), new Path2D()], A3 = [0.62, 0.78, 0.93];
  for (let ii = 0; ii < n; ii++) {
    const i = i0 + ii, off = o0 + ii * gap + (hash(i, seed) - 0.5) * gap * 0.6;
    let ta = -1e9, tb = 1e9;
    if (Math.abs(c) > 1e-6) { const u = (x0 - off * nx) / c, v = (x1 - off * nx) / c; ta = Math.max(ta, Math.min(u, v)); tb = Math.min(tb, Math.max(u, v)); }
    else if (off * nx < x0 || off * nx > x1) continue;
    if (Math.abs(s) > 1e-6) { const u = (y0 - off * ny) / s, v = (y1 - off * ny) / s; ta = Math.max(ta, Math.min(u, v)); tb = Math.min(tb, Math.max(u, v)); }
    else if (off * ny < y0 || off * ny > y1) continue;
    if (tb <= ta) continue;
    let t = ta, k = 0;
    while (t < tb && k < 24) {
      const len = dash * (0.5 + hash(i, k, seed + 3) * 1.2), t1 = Math.min(tb, t + len);
      if (hash(i, k, seed + 9) < keep) {
        const j = noise1(i * 0.7 + k, seed + boil * 5) * jit, h7 = hash(i, k, seed + 7), P3 = B3[h7 < 0.33 ? 0 : h7 < 0.66 ? 1 : 2];
        P3.moveTo(off * nx + c * t + nx * j, off * ny + s * t + ny * j);
        P3.lineTo(off * nx + c * t1 - nx * j, off * ny + s * t1 - ny * j);
      }
      t = t1 + gap * (0.3 + hash(i, k, seed + 13)); k++;
    }
  }
  ctx.save(); ctx.globalCompositeOperation = comp; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
  for (let q = 0; q < 3; q++) { ctx.globalAlpha = alpha * A3[q]; ctx.stroke(B3[q]); }
  ctx.restore();
}
// fast doubled wobbly ink (same look as pencil.ink, ~5x fewer stroke calls: each pass is a handful of long strokes)
export function inkFast(ctx, pts, { closed = true, color = '#2A2833', width = 3, passes = 2, amp = 1.6, boil = 0, seed = 1, alpha = 0.95, step = 9, taper = false } = {}) {
  const base = resample(pts, step, closed);
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color;
  for (let p = 0; p < passes; p++) {
    const w = wobble(base, { boil, amp: amp * (p === 0 ? 1 : 1.35), seed: seed + p * 31, closed });
    const n = w.length, chunk = Math.max(taper ? 3 : 6, Math.ceil(n / (taper ? 9 : 4))), lim = n - 1 + (closed ? 1 : 0);
    for (let i = 0; i < lim; i += chunk) {
      const pr = 0.65 + 0.6 * (noise1(i * 0.17, seed * 13 + p * 97 + boil * 3) * 0.5 + 0.5);
      let tp = 1; if (taper && !closed) { const u = i / n; tp = clamp(Math.min(u, 1 - u) * 6, 0.25, 1); }
      ctx.globalAlpha = alpha * (p === 0 ? 1 : 0.7); ctx.lineWidth = Math.max(0.6, width * pr * tp * (p === 0 ? 1 : 0.78));
      ctx.beginPath(); ctx.moveTo(w[i][0], w[i][1]);
      for (let k = 1; k <= chunk + 1 && i + k < n + (closed ? 1 : 0); k++) { const q = w[(i + k) % n]; ctx.lineTo(q[0], q[1]); }
      ctx.stroke();
    }
  }
  ctx.restore();
}
export const bbox = (pts) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };

// flat opaque pigment (offset + wobble) + optional pencil hatch + doubled ink outline
export function solid(ctx, P, pts, { fill, hatch, ink = INK, w = 3, boil, seed, off = [3, 2], amp = 1.4, alpha = 1, closed = true, hatchOpt = {} } = {}) {
  if (fill) P.fill(ctx, pts, { color: fill, comp: 'source-over', offset: off, boil, seed, amp, alpha });
  if (hatch) {
    ctx.save(); path(ctx, pts); ctx.clip();
    hatchBox(ctx, bbox(pts), { color: hatch, boil, seed: seed + 5, ...hatchOpt });
    ctx.restore();
  }
  if (ink) inkFast(ctx, pts, { color: ink, width: w, boil, seed, closed, amp: 1.5 });
}

// ---------- the moon (profile, opens LEFT; eye at the portal) ------------------------------------------------------
const C1 = { x: 780, y: 470, r: 380 }, C2 = { x: 470, y: 470, r: 300 };
const MOON = (() => {
  const dx = C2.x - C1.x, dy = C2.y - C1.y, d = Math.hypot(dx, dy);
  const a = (C1.r * C1.r - C2.r * C2.r + d * d) / (2 * d), h = Math.sqrt(C1.r * C1.r - a * a);
  const ux = dx / d, uy = dy / d, mx = C1.x + ux * a, my = C1.y + uy * a;
  const top = [mx + uy * h, my - ux * h], bot = [mx - uy * h, my + ux * h];
  const aTop = Math.atan2(top[1] - C1.y, top[0] - C1.x), aBot = Math.atan2(bot[1] - C1.y, bot[0] - C1.x);
  const outer = []; // from top horn, clockwise (through the top and the right) to the bottom horn
  const span = (aBot + TAU) - (aTop + TAU) > 0 ? aBot - aTop : aBot - aTop + TAU; // aTop<0 (≈-129°), aBot>0 (≈+129°): going through 0
  for (let i = 0; i <= 80; i++) { const an = aTop + (aBot - aTop) * (i / 80); outer.push([C1.x + Math.cos(an) * C1.r, C1.y + Math.sin(an) * C1.r]); }
  const phi0 = Math.atan2(bot[1] - C2.y, bot[0] - C2.x); // ≈ +80°
  const bump = (deg) => {
    const tp = smooth((80 - Math.abs(deg)) / 20);
    return tp * (16 * g(deg, -52, 15) + 32 * g(deg, -27, 6.5) - 5 * g(deg, -6, 6) + 86 * g(deg, 17, 8.5) + 44 * g(deg, 31.5, 4.5) + 36 * g(deg, 38.5, 4) + 56 * g(deg, 51, 7.5));
  };
  const inner = [];
  const N = 120;
  for (let i = 0; i <= N; i++) { // from bottom horn up to the top horn (phi from +80° to -80°)
    const deg = (phi0 * 180 / Math.PI) * (1 - (2 * i) / N), an = (deg * Math.PI) / 180, rr = C2.r - bump(deg);
    inner.push([C2.x + Math.cos(an) * rr, C2.y + Math.sin(an) * rr]);
  }
  const poly = [...outer, ...inner];
  const face = (deg, extra = 0) => { const an = (deg * Math.PI) / 180, rr = C2.r - bump(deg) + extra; return [C2.x + Math.cos(an) * rr, C2.y + Math.sin(an) * rr]; };
  return { top, bot, outer, inner, poly, face, bump };
})();

function eyeOpen(t) { // 0 closed .. 1 wide open (7.0–7.5, ease in-out with a tiny overshoot that settles by 7.5)
  const x = clamp((t - 7.0) / 0.5);
  return smoother(x) + (x < 1 ? 0.045 * Math.sin(x * Math.PI) * x : 0);
}

function drawEye(ctx, P, T, o, boil) {
  const { x: cx, y: cy } = EYE, t = T.t;
  const oo = clamp(o, 0, 1.05);
  const RX = 168;
  // lid curves (closed: sleepy ∪ sag; open: round wide eye)
  const upper = [], lower = [];
  const N = 36;
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI, c = Math.cos(th), s = Math.sin(th);
    const sag = cy + 46 * Math.pow(s, 1.1);
    const topO = cy - 142 * Math.pow(s, 0.78), botO = cy + 134 * Math.pow(s, 0.85);
    const x = cx + RX * c;
    upper.push([x, lerp(sag, topO, clamp(oo))]);
    lower.push([x, lerp(sag, botO, clamp(oo))]);
  }
  const poly = [...upper, ...lower.slice().reverse()];
  // socket shading around the eye
  ctx.save();
  const sg = ctx.createRadialGradient(cx, cy + 6, 60, cx, cy + 6, 250);
  sg.addColorStop(0, 'rgba(184,120,40,0.0)'); sg.addColorStop(0.55, 'rgba(184,120,40,0.30)'); sg.addColorStop(1, 'rgba(184,120,40,0)');
  ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(cx, cy + 6, 270, 230, 0, 0, TAU); ctx.fill();
  ctx.restore();
  if (oo > 0.04) {
    ctx.save(); path(ctx, poly); ctx.fillStyle = '#FFFDF4'; ctx.fill(); ctx.clip();
    // lid shadow cast on the eyeball
    const ls = ctx.createLinearGradient(0, cy - 150, 0, cy - 40);
    ls.addColorStop(0, 'rgba(70,40,10,0.55)'); ls.addColorStop(1, 'rgba(70,40,10,0)');
    ctx.fillStyle = ls; ctx.fillRect(cx - 200, cy - 160, 400, 140);
    // iris + pupil (looks straight at the lens when fully open)
    const settle = 1 - smooth((t - 7.15) / 0.35);
    const ix = cx + (-26 * Math.sin(t * 5) * 0.4 - 14) * settle, iy = cy + (16 + 6 * Math.cos(t * 6)) * settle;
    const R = EYE.r;
    ctx.fillStyle = '#E39A2E'; ctx.beginPath(); ctx.arc(ix, iy, R, 0, TAU); ctx.fill();
    const ig = ctx.createRadialGradient(ix, iy, R * 0.25, ix, iy, R);
    ig.addColorStop(0, 'rgba(255,224,130,0.95)'); ig.addColorStop(0.62, 'rgba(240,160,50,0.0)'); ig.addColorStop(1, 'rgba(90,40,8,0.78)');
    ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(ix, iy, R, 0, TAU); ctx.fill();
    // radial iris fibres
    ctx.save(); ctx.beginPath(); ctx.arc(ix, iy, R, 0, TAU); ctx.clip(); ctx.lineCap = 'round';
    { const pd = new Path2D(), pl = new Path2D();
      for (let k = 0; k < 44; k++) {
        const a = (k / 44) * TAU + hash(k, 3) * 0.2, r0 = 50 + hash(k, 5) * 18, r1 = R * (0.74 + 0.22 * hash(k, 7)), pp = k % 3 ? pd : pl;
        pp.moveTo(ix + Math.cos(a) * r0, iy + Math.sin(a) * r0); pp.lineTo(ix + Math.cos(a + 0.03) * r1, iy + Math.sin(a + 0.03) * r1);
      }
      ctx.strokeStyle = 'rgba(110,52,10,0.55)'; ctx.lineWidth = 2.4; ctx.stroke(pd); ctx.strokeStyle = 'rgba(255,236,160,0.7)'; ctx.lineWidth = 2.0; ctx.stroke(pl); }
    ctx.restore();
    const pr = lerp(36, 52, smooth((t - 7.1) / 0.4));
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(ix, iy, pr, 0, TAU); ctx.fill();
    inkFast(ctx, P.circlePts(ix, iy, R - 2, 44), { color: INK, width: 9, boil, seed: 91, amp: 1.1, passes: 2 });
    // glints
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.ellipse(ix - 36, iy - 40, 26, 17, -0.6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(ix + 30, iy + 34, 9, 0, TAU); ctx.fill();
    ctx.restore();
    inkFast(ctx, lower, { closed: false, color: INK, width: 4, boil, seed: 71, amp: 1.2, taper: true });
  }
  // upper lid (thick) + lashes
  inkFast(ctx, upper, { closed: false, color: INK, width: lerp(9, 13, clamp(oo)), boil, seed: 72, amp: 1.3, taper: true, passes: 2 });
  const lashN = 11;
  for (let i = 1; i < lashN; i++) {
    const u = i / lashN, k = Math.round(u * N), p0 = upper[k], p1 = upper[Math.min(N, k + 1)], p2 = upper[Math.max(0, k - 1)];
    let nx = p1[1] - p2[1], ny = -(p1[0] - p2[0]); const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    if (ny > 0) { nx = -nx; ny = -ny; } // outward = up while open
    const dir = oo < 0.3 ? -1 : 1; // when closed the lashes hang down
    const L = (30 + 16 * Math.sin(u * Math.PI)) * (1 - 0.12 * (hash(i, 4) - 0.5));
    const bend = (u - 0.5) * 22;
    const e = [p0[0] + nx * L * dir + bend * 0.5, p0[1] + ny * L * dir];
    inkFast(ctx, [p0, [lerp(p0[0], e[0], 0.55) + bend * 0.3, lerp(p0[1], e[1], 0.55)], e], { closed: false, color: INK, width: 4.5, boil, seed: 120 + i, amp: 0.6, passes: 1, taper: true });
  }
  // crease above the lid + eyebrow (lifts when the moon wakes)
  const lift = 20 * smooth(oo);
  const crease = [], brow = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24, x = cx - 190 + 380 * u, s = Math.sin(u * Math.PI);
    crease.push([x, cy - 8 - lift * 0.5 - 150 * Math.pow(s, 0.8) * oo - 60 * (1 - oo) * s]);
    brow.push([cx - 205 + 410 * u, cy - 120 - lift - 100 * Math.pow(s, 0.7) + 40 * (u - 0.35) ]);
  }
  inkFast(ctx, crease, { closed: false, color: GOLD_D, width: 3, boil, seed: 73, amp: 1.3, taper: true });
  // brow: filled tapered wedge, bold
  const bw = []; for (let i = 0; i <= 24; i++) bw.push([brow[i][0], brow[i][1] - 8 - 12 * Math.sin((i / 24) * Math.PI)]);
  const bpoly = [...bw, ...brow.slice().reverse()];
  ctx.save(); path(ctx, bpoly); ctx.fillStyle = '#3a2a1c'; ctx.fill(); ctx.restore();
  inkFast(ctx, bpoly, { color: INK, width: 3, boil, seed: 74, amp: 1.0 });
  // under-eye bag line
  const bag = lower.slice(6, 31).map(([x, y], i) => [x, y + 20 + 4 * Math.sin(i * 0.4)]);
  if (oo > 0.5) inkFast(ctx, bag, { closed: false, color: OCHRE, width: 2.4, boil, seed: 75, amp: 1.0, taper: true, alpha: 0.8 * smooth((oo - 0.5) / 0.4) });
}

function drawMoon(ctx, P, T, S) {
  const t = T.t, B = T.boil;
  const settle = 1 - smooth((t - 7.0) / 0.4);
  const jolt = t > 7.0 ? Math.exp(-(t - 7.0) * 8) * Math.sin((t - 7.0) * 28) * 0.032 * (1 - smooth((t - 7.12) / 0.22)) : 0;
  const ang = (Math.sin(t * 1.7) * 0.011 + Math.sin(t * 0.9 + 1) * 0.007) * settle + jolt;
  const AX = 900, AY = 40; // hung from the flies
  ctx.save(); ctx.translate(AX, AY); ctx.rotate(ang); ctx.translate(-AX, -AY);
  // cut-out cardboard edge (thickness) + drop shadow on the sky
  const poly = MOON.poly;
  P.fill(ctx, poly.map(([x, y]) => [x + 14, y + 12]), { color: '#1a1030', comp: 'source-over', offset: [0, 0], alpha: 0.55, boil: B, seed: 14, amp: 0.8 });
  P.fill(ctx, poly.map(([x, y]) => [x + 6, y + 5]), { color: '#8A5A14', comp: 'source-over', offset: [0, 0], boil: B, seed: 15, amp: 0.8 });
  P.fill(ctx, poly, { color: CREAM, comp: 'source-over', offset: [3, 2], boil: B, seed: 16, amp: 1.2 });
  ctx.save(); path(ctx, poly); ctx.clip();
  // painted shading: warm rim on the outer arc, face-side tint, craters, cheek
  ctx.globalCompositeOperation = 'multiply';
  ctx.strokeStyle = 'rgba(200,140,50,0.34)'; ctx.lineWidth = 70; ctx.lineJoin = 'round';
  path(ctx, MOON.outer, false); ctx.stroke();
  ctx.strokeStyle = 'rgba(210,160,70,0.22)'; ctx.lineWidth = 40; path(ctx, MOON.inner, false); ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  hatchBox(ctx, bbox(poly), { color: '#B97C22', gap: 12, width: 1.2, alpha: 0.22, angle: 0.95, seed: 21, boil: B, comp: 'multiply', dash: 90 });
  hatchBox(ctx, { x: 520, y: 100, w: 360, h: 760 }, { color: '#7A4C12', gap: 11, width: 1.1, alpha: 0.14, angle: 0.95 + Math.PI / 2, seed: 22, boil: B, comp: 'multiply', dash: 70 });
  // craters (painted rings)
  [[1060, 235, 40, 28], [1112, 640, 46, 34], [850, 740, 54, 36], [1010, 292, 20, 14], [700, 250, 30, 20], [1000, 775, 26, 18], [860, 220, 22, 15]].forEach(([x, y, rx, ry], i) => {
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgba(190,130,40,0.35)'; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0.3, 0, TAU); ctx.fill(); ctx.restore();
    inkFast(ctx, P.ellipsePts(x, y, rx, ry, 0.3, 26), { color: '#7a4c12', width: 2.4, boil: B, seed: 30 + i, amp: 0.8, alpha: 0.8 });
  });
  // cheek blush
  ctx.save(); ctx.globalCompositeOperation = 'multiply';
  const cg = ctx.createRadialGradient(895, 610, 6, 895, 610, 80); cg.addColorStop(0, 'rgba(226,84,60,0.55)'); cg.addColorStop(1, 'rgba(226,84,60,0)');
  ctx.fillStyle = cg; ctx.beginPath(); ctx.ellipse(895, 610, 90, 56, -0.2, 0, TAU); ctx.fill(); ctx.restore();
  P.hatch(ctx, P.ellipsePts(895, 610, 62, 36, -0.2, 20), { color: '#D0452E', gap: 6, width: 1.3, alpha: 0.5, angle: 0.8, boil: B, seed: 41 });
  ctx.restore();
  // double painted border (inner contour) + outline
  const inset = poly.map(([x, y]) => { const dx = x - 760, dy = y - 470, l = Math.hypot(dx, dy); return [x, y]; });
  inkFast(ctx, MOON.outer.map(([x, y]) => { const dx = x - C1.x, dy = y - C1.y, l = Math.hypot(dx, dy); return [x - (dx / l) * 24, y - (dy / l) * 24]; }), { closed: false, color: '#9A5E14', width: 3, boil: B, seed: 17, amp: 1.2, alpha: 0.75 });
  inkFast(ctx, poly, { color: INK, width: 5, boil: B, seed: 18, amp: 1.7 });
  // mouth: closed sleepy smile from the lip notch
  const mp = MOON.face(35);
  inkFast(ctx, [mp, [mp[0] + 34, mp[1] + 4], [mp[0] + 64, mp[1] - 4], [mp[0] + 82, mp[1] - 18]], { closed: false, color: INK, width: 4, boil: B, seed: 19, amp: 0.8, taper: true });
  // nostril
  const np = MOON.face(19);
  inkFast(ctx, [[np[0] + 46, np[1] - 10], [np[0] + 66, np[1] - 2], [np[0] + 52, np[1] + 8]], { closed: false, color: INK, width: 3.4, boil: B, seed: 20, amp: 0.6, taper: true });
  // the eye (portal)
  drawEye(ctx, P, T, eyeOpen(t), B);
  ctx.restore();
}

// ---------- static layers ------------------------------------------------------------------------------------------
function drawBack(gx, S, B) {
  const P = S.pencil, O = OPEN;
  P.paper(gx, S, { seed: 12 });
  // night-sky flat
  const sky = gx.createLinearGradient(0, O.y0, 0, O.floorY);
  sky.addColorStop(0, '#162050'); sky.addColorStop(0.5, '#2c3e92'); sky.addColorStop(1, '#6670b4');
  gx.fillStyle = sky; gx.fillRect(O.x0, O.y0, O.x1 - O.x0, O.floorY - O.y0);
  gx.save(); gx.beginPath(); gx.rect(O.x0, O.y0, O.x1 - O.x0, O.floorY - O.y0); gx.clip();
  // moon glow (painted halo) + pencil strokes of lighter blue
  const hg = gx.createRadialGradient(900, 480, 120, 900, 480, 620);
  hg.addColorStop(0, 'rgba(255,236,170,0.55)'); hg.addColorStop(0.5, 'rgba(255,226,150,0.20)'); hg.addColorStop(1, 'rgba(255,226,150,0)');
  gx.fillStyle = hg; gx.fillRect(O.x0, O.y0, O.x1 - O.x0, O.floorY - O.y0);
  hatchBox(gx, { x: O.x0, y: O.y0, w: O.x1 - O.x0, h: O.floorY - O.y0 }, { color: '#8FA0E8', gap: 12, width: 1.3, alpha: 0.26, angle: -0.35, seed: 3, boil: B, comp: 'source-over', dash: 120, keep: 0.7 });
  hatchBox(gx, { x: O.x0, y: O.y0, w: O.x1 - O.x0, h: 300 }, { color: '#04061a', gap: 9, width: 1.5, alpha: 0.35, angle: 0.5, seed: 4, boil: B, comp: 'source-over', dash: 140, keep: 0.8 });
  // painted stars
  for (let i = 0; i < 46; i++) {
    const x = O.x0 + 20 + hash(i, 1) * (O.x1 - O.x0 - 40), y = O.y0 + 14 + hash(i, 2) * 560;
    const dm = Math.hypot(x - 880, y - 470); if (dm < 420 || (x > 1280 && y > 560)) continue;
    const s = 4 + hash(i, 3) * 9, tw = hash(Math.floor(B / 2) + i, 8) < 0.15 ? 0.45 : 1;
    gx.fillStyle = hash(i, 4) < 0.5 ? '#FFF3C8' : '#CFE0FF'; gx.globalAlpha = 0.9 * tw;
    spark4(gx, x, y, s * tw); gx.fill();
  }
  gx.globalAlpha = 1;
  // far hills + near hills (ground rows)
  const hill = (base, amp, seed, col, hatchC, edge) => {
    const pts = []; for (let i = 0; i <= 40; i++) { const x = O.x0 - 10 + (i / 40) * (O.x1 - O.x0 + 20); pts.push([x, base + noise1(i * 0.34, seed) * amp + noise1(i * 0.9, seed + 4) * amp * 0.25]); }
    pts.push([O.x1 + 10, O.floorY + 6], [O.x0 - 10, O.floorY + 6]);
    solid(gx, P, pts, { fill: col, hatch: hatchC, w: 3.2, boil: B, seed, off: [0, 0], hatchOpt: { gap: 10, width: 1.3, alpha: 0.38, angle: -0.6, comp: 'source-over', dash: 80 } });
  };
  hill(782, 38, 61, '#2E3A78', '#7E8CD8');
  // castle flat (right wing): dark silhouette, two lit windows
  const cx0 = 1262, cy1 = O.floorY - 6;
  const castle = [[cx0, cy1], [cx0, 640], [cx0 - 8, 640], [cx0 - 8, 604], [cx0 + 10, 604], [cx0 + 10, 622], [cx0 + 28, 622], [cx0 + 28, 604], [cx0 + 46, 604], [cx0 + 46, 622], [cx0 + 64, 622], [cx0 + 64, 604], [cx0 + 82, 604], [cx0 + 82, 640], [cx0 + 74, 640], [cx0 + 74, 690], [cx0 + 118, 690], [cx0 + 118, 560], [cx0 + 108, 560], [cx0 + 150, 478], [cx0 + 192, 560], [cx0 + 182, 560], [cx0 + 182, 690], [cx0 + 220, 690], [cx0 + 220, 740], [cx0 + 262, 740], [cx0 + 262, cy1]];
  const sc = 0.78, cs = castle.map(([x, y]) => [cx0 + (x - cx0) * sc, cy1 + (y - cy1) * sc]);
  solid(gx, P, cs, { fill: '#161a3c', hatch: '#6C79C8', w: 3.2, boil: B, seed: 63, off: [3, 2], hatchOpt: { gap: 12, width: 1.2, alpha: 0.3, angle: -0.5, comp: 'source-over', dash: 60 } });
  [[cx0 + 40, 668, 20, 30], [cx0 + 150, 596, 22, 34], [cx0 + 150, 655, 18, 26]].map(([x, y, w, h]) => [cx0 + (x - cx0) * sc, cy1 + (y - cy1) * sc, w * sc, h * sc]).forEach(([x, y, w, h], i) => {
    gx.fillStyle = '#FFD670'; gx.fillRect(x - w / 2, y - h / 2, w, h);
    inkFast(gx, P.rectPts(x - w / 2, y - h / 2, w, h, 6), { color: INK, width: 2.4, boil: B, seed: 64 + i, amp: 0.6, passes: 1 });
  });
  hill(826, 22, 66, '#14183a', '#5560B0');
  gx.restore();
  // the stage floor
  const floor = [[O.x0, O.floorY], [O.x1, O.floorY], [O.x1, O.y1], [O.x0, O.y1]];
  gx.fillStyle = '#7F5632'; gx.fillRect(O.x0, O.floorY, O.x1 - O.x0, O.y1 - O.floorY);
  gx.save(); gx.beginPath(); gx.rect(O.x0, O.floorY, O.x1 - O.x0, O.y1 - O.floorY); gx.clip();
  const fg = gx.createLinearGradient(0, O.floorY, 0, O.y1); fg.addColorStop(0, 'rgba(25,14,8,0.75)'); fg.addColorStop(0.35, 'rgba(25,14,8,0.1)'); fg.addColorStop(1, 'rgba(255,200,110,0.25)');
  gx.fillStyle = fg; gx.fillRect(O.x0, O.floorY, O.x1 - O.x0, O.y1 - O.floorY);
  hatchBox(gx, { x: O.x0, y: O.floorY, w: O.x1 - O.x0, h: O.y1 - O.floorY }, { color: '#2E1A0C', gap: 7, width: 1.4, alpha: 0.5, angle: 0.03, seed: 8, boil: B, comp: 'multiply', dash: 150, keep: 0.8 });
  for (let i = -8; i <= 8; i++) { // planks converge to the vanishing point
    const xb = 960 + i * 150, a = [960 + (xb - 960) * 0.18, O.floorY - 80], b = [xb, O.y1 + 6];
    inkFast(gx, [a, b], { closed: false, color: '#2A170A', width: 2.2, boil: B, seed: 70 + i, amp: 1.0, alpha: 0.7, passes: 1 });
  }
  gx.restore();
  inkFast(gx, [[O.x0, O.floorY], [O.x1, O.floorY]], { closed: false, color: INK, width: 3.4, boil: B, seed: 69, amp: 1.2 });
}

export function spark4(ctx, x, y, s) {
  ctx.beginPath(); ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x + s * 0.12, y - s * 0.12, x + s, y); ctx.quadraticCurveTo(x + s * 0.12, y + s * 0.12, x, y + s);
  ctx.quadraticCurveTo(x - s * 0.12, y + s * 0.12, x - s, y); ctx.quadraticCurveTo(x - s * 0.12, y - s * 0.12, x, y - s); ctx.closePath();
}
export function star5(cx, cy, R, r, rot = 0, n = 5) {
  const pts = []; for (let i = 0; i < n * 2; i++) { const a = rot - Math.PI / 2 + (i / (n * 2)) * TAU, rr = i % 2 ? r : R; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } return pts;
}

// velvet drape between xo (outer, fixed) and edge(y) (inner, moves). rows of vertical folds, gold braid on the leading edge.
export function drape(ctx, P, { xo, edge, y0, y1, folds = 8, seed, boil, lightBias = 0, braid = true, hem = true }) {
  const ys = []; for (let i = 0; i <= 12; i++) ys.push(lerp(y0, y1, i / 12));
  const xe = ys.map(edge);
  const fx = (j, i) => lerp(xo, xe[i], j / folds) + Math.sin(ys[i] * 0.012 + j * 1.3) * 3 * Math.min(1, Math.abs(xe[i] - xo) / 80);
  for (let j = 0; j < folds; j++) {
    const top = ys.map((y, i) => [fx(j, i), y]), bot = ys.map((y, i) => [fx(j + 1, i), y]).reverse();
    const poly = [...top, ...bot];
    const dark = (j + lightBias) % 2 === 0;
    ctx.save(); path(ctx, poly);
    const gr = ctx.createLinearGradient(0, y0, 0, y1);
    const c0 = dark ? VEL_D : VEL, c1 = dark ? VEL : VEL_L;
    gr.addColorStop(0, c0); gr.addColorStop(0.45, c1); gr.addColorStop(1, c0);
    ctx.fillStyle = gr; ctx.fill(); ctx.clip();
    hatchBox(ctx, bbox(poly), { color: '#240510', gap: 6, width: 1.2, alpha: dark ? 0.34 : 0.18, angle: Math.PI / 2 + 0.03, seed: seed + j * 3, boil, comp: 'multiply', dash: 170, jit: 1.0 });
    if (!dark) hatchBox(ctx, bbox(poly), { color: '#FF9AA8', gap: 9, width: 1.2, alpha: 0.35, angle: Math.PI / 2 - 0.02, seed: seed + j * 3 + 1, boil, comp: 'source-over', dash: 120, keep: 0.5, jit: 0.8 });
    ctx.restore();
    inkFast(ctx, top, { closed: false, color: INK, width: 2.4, boil, seed: seed + j, amp: 1.0, passes: 1, alpha: 0.9 });
  }
  if (braid) {
    const e = ys.map((y, i) => [xe[i], y]);
    inkFast(ctx, e, { closed: false, color: GOLD_D, width: 12, boil, seed: seed + 50, amp: 0.8, passes: 1 });
    inkFast(ctx, e, { closed: false, color: GOLD, width: 8, boil, seed: seed + 51, amp: 0.8, passes: 1 });
    inkFast(ctx, e, { closed: false, color: INK, width: 2.2, boil, seed: seed + 52, amp: 1.0, passes: 1, alpha: 0.8 });
  }
  if (hem) { // gold fringe along the bottom edge
    ctx.save(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    const a = fx(0, 12), b = fx(folds, 12);
    for (let x = Math.min(a, b); x < Math.max(a, b); x += 7) { ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x + (hash(Math.round(x), seed) - 0.5) * 3, y1 + 10); ctx.stroke(); }
    ctx.restore();
  }
}
// curtain edge shape
function edgeOpen(side, y) { // inner edge x when fully open, tied back at y≈600
  const pts = [[OPEN.y0, 168], [330, 150], [470, 118], [600, 92], [700, 104], [860, 150], [962, 178]];
  let i = 0; while (i < pts.length - 2 && y > pts[i + 1][0]) i++;
  const u = clamp((y - pts[i][0]) / (pts[i + 1][0] - pts[i][0])), d = lerp(pts[i][1], pts[i + 1][1], smooth(u));
  return side < 0 ? OPEN.x0 + d : OPEN.x1 - d;
}
function curtainK(t) {
  const x = t - 6.0;
  if (x <= 0) return 0;
  const m = smoother(clamp(x / 0.52));
  const w = x > 0.46 ? Math.exp(-(x - 0.46) * 6.5) * Math.sin((x - 0.46) * 24) * 0.05 : 0;
  return m + w;
}
function curtainEdge(side, k) {
  return (y) => {
    const yn = clamp((y - OPEN.y0) / (OPEN.y1 - OPEN.y0));
    const kk = Math.min(1.05, k * (1 + 0.5 * yn));
    const closed = 960 + side * 8;
    const open = edgeOpen(side, y);
    return lerp(closed, open, clamp(kk, 0, 1.06));
  };
}
// gold half-sun appliqué stitched on the cloth next to the leading edge (compresses with the folds, shrinks away as they gather)
function emblem(ctx, P, side, edge, xo, yc, B, k) {
  const sc = 1 - smooth((k - 0.3) / 0.45); if (sc < 0.04) return;
  const comp = clamp(Math.abs(edge(yc) - xo) / 603, 0.05, 1);
  const X = (a, b) => [edge(yc + b * sc) + side * a * sc * comp, yc + b * sc];
  const ray = (th, r0, r1, hw) => [X(Math.cos(th - hw) * r0, Math.sin(th - hw) * r0), X(Math.cos(th) * r1, Math.sin(th) * r1), X(Math.cos(th + hw) * r0, Math.sin(th + hw) * r0)];
  for (let i = 0; i < 9; i++) {
    const th = -Math.PI / 2 + ((i + 0.5) / 9) * Math.PI, long = i % 2 === 0;
    solid(ctx, P, ray(th, 92, long ? 205 : 150, 0.13), { fill: long ? GOLD : '#F0CF7E', hatch: GOLD_D, w: 2.6, boil: B, seed: 450 + i + (side > 0 ? 20 : 0), off: [2, 1.5], hatchOpt: { gap: 6, width: 1, alpha: 0.5, angle: th, comp: 'multiply' } });
  }
  const disc = Array.from({ length: 21 }, (_, i) => { const th = -Math.PI / 2 + (i / 20) * Math.PI; return X(Math.cos(th) * 84, Math.sin(th) * 84); });
  solid(ctx, P, disc, { fill: '#FFF0C0', hatch: GOLD_D, w: 3.2, boil: B, seed: 480 + (side > 0 ? 3 : 0), off: [2, 1.5], hatchOpt: { gap: 6, width: 1, alpha: 0.4, angle: -0.7, comp: 'multiply' } });
  const disc2 = Array.from({ length: 21 }, (_, i) => { const th = -Math.PI / 2 + (i / 20) * Math.PI; return X(Math.cos(th) * 46, Math.sin(th) * 46); });
  solid(ctx, P, disc2, { fill: VEL, hatch: '#2a0610', w: 2.6, boil: B, seed: 484 + (side > 0 ? 3 : 0), off: [1, 1], hatchOpt: { gap: 5, width: 1, alpha: 0.5, angle: 0.8, comp: 'multiply' } });
}
export function drawCurtains(ctx, P, k, B) {
  [-1, 1].forEach((side) => {
    const xo = side < 0 ? OPEN.x0 - 6 : OPEN.x1 + 6, edge = curtainEdge(side, k);
    drape(ctx, P, { xo, edge, y0: OPEN.y0 - 10, y1: OPEN.y1, folds: 9, seed: side < 0 ? 200 : 300, boil: B, lightBias: side < 0 ? 0 : 1 });
    emblem(ctx, P, side, edge, xo, 560, B, k);
  });
  // tie-backs with tassels (once open)
  const tk = smooth((k - 0.85) / 0.15);
  if (tk > 0.5) {
    [-1, 1].forEach((side) => {
      const ex = curtainEdge(side, k)(612), cx = side < 0 ? OPEN.x0 : OPEN.x1;
      ctx.save();
      inkFast(ctx, [[cx, 604], [lerp(cx, ex, 0.5), 628], [ex + side * -4, 618]], { closed: false, color: GOLD_D, width: 11, boil: B, seed: 400 + side, amp: 0.6, passes: 1 });
      inkFast(ctx, [[cx, 604], [lerp(cx, ex, 0.5), 628], [ex + side * -4, 618]], { closed: false, color: GOLD, width: 7, boil: B, seed: 402 + side, amp: 0.6, passes: 1 });
      const tx = lerp(cx, ex, 0.55), ty = 632;
      solid(ctx, P, [[tx - 5, ty], [tx + 5, ty], [tx + 18, ty + 46], [tx, ty + 56], [tx - 18, ty + 46]], { fill: GOLD, hatch: GOLD_D, w: 2.4, boil: B, seed: 410 + side, off: [2, 1], hatchOpt: { gap: 5, width: 1, alpha: 0.5, angle: 1.2, comp: 'multiply' } });
      ctx.restore();
    });
  }
}

function drawFront(gx, S, B) { // proscenium: columns, gold top band, velvet pelmet, apron lip + footlights (static per boil)
  const P = S.pencil, O = OPEN;
  // --- columns (gold pilasters with fluting)
  [[240, O.x0], [O.x1, 1680]].forEach(([x0, x1], si) => {
    const gr = gx.createLinearGradient(x0, 0, x1, 0);
    if (si === 0) { gr.addColorStop(0, '#F3D888'); gr.addColorStop(0.45, '#E2B650'); gr.addColorStop(1, '#8E5E14'); } else { gr.addColorStop(0, '#8E5E14'); gr.addColorStop(0.55, '#E2B650'); gr.addColorStop(1, '#F3D888'); }
    gx.fillStyle = gr; gx.fillRect(x0, 0, x1 - x0, 1080);
    for (let f = 1; f < 5; f++) {
      const x = lerp(x0, x1, f / 5);
      inkFast(gx, [[x, 190], [x + (hash(f, si) - 0.5) * 3, 905]], { closed: false, color: '#5A3A08', width: 2.4, boil: B, seed: 500 + f + si * 9, amp: 1.2, alpha: 0.75, passes: 1 });
      inkFast(gx, [[x + 7, 200], [x + 6, 895]], { closed: false, color: '#FFF1BE', width: 1.8, boil: B, seed: 520 + f + si * 9, amp: 1.2, alpha: 0.6, passes: 1 });
    }
    gx.save(); gx.beginPath(); gx.rect(x0, 190, x1 - x0, 720); gx.clip();
    hatchBox(gx, { x: x0, y: 190, w: x1 - x0, h: 720 }, { color: '#6A4208', gap: 6, width: 1.1, alpha: 0.35, angle: Math.PI / 2, seed: 530 + si, boil: B, comp: 'multiply', dash: 220 });
    gx.restore();
    // capital + plinth
    [[170, 232], [896, 966]].forEach(([ya, yb], q) => {
      const pad = q === 0 ? 14 : 12;
      solid(gx, P, P.rectPts(x0 - (si === 0 ? 20 : 0), ya, x1 - x0 + 20, yb - ya, 6), { fill: q === 0 ? '#F1D083' : '#D9A845', hatch: GOLD_D, w: 3.2, boil: B, seed: 540 + q + si * 3, off: [3, 2], hatchOpt: { gap: 6, width: 1.2, alpha: 0.4, angle: -0.7, comp: 'multiply' } });
    });
    inkFast(gx, [[x0 + (si === 0 ? 0 : 0), 0], [x0, 1080]], { closed: false, color: INK, width: 3, boil: B, seed: 560 + si, amp: 1.2 });
    inkFast(gx, [[x1, 0], [x1, 1080]], { closed: false, color: INK, width: 3, boil: B, seed: 562 + si, amp: 1.2 });
  });
  // --- gold top band with fan ornaments
  const band = P.rectPts(240, -10, 1440, 130, 0);
  gx.fillStyle = '#F0CF7E'; gx.fillRect(240, 0, 1440, 118);
  gx.save(); gx.beginPath(); gx.rect(240, 0, 1440, 118); gx.clip();
  hatchBox(gx, { x: 240, y: 0, w: 1440, h: 118 }, { color: '#A47218', gap: 10, width: 1.0, alpha: 0.14, angle: -0.5, seed: 580, boil: B, comp: 'multiply', dash: 100 });
  for (let i = 0; i < 24; i++) { const x = 270 + i * 60; gx.fillStyle = 'rgba(148,100,22,0.5)'; gx.beginPath(); gx.arc(x, 100, 3.2, 0, TAU); gx.fill(); }
  gx.restore();
  inkFast(gx, [[240, 118], [1680, 118]], { closed: false, color: INK, width: 4, boil: B, seed: 590, amp: 1.2 });
  inkFast(gx, [[240, 100], [1680, 100]], { closed: false, color: GOLD_D, width: 2, boil: B, seed: 591, amp: 1.0, alpha: 0.8 });
  // centre medallion
  solid(gx, P, P.circlePts(960, 70, 52, 34), { fill: '#FFF0C0', hatch: GOLD_D, w: 4, boil: B, seed: 592, off: [3, 2], hatchOpt: { gap: 5, width: 1, alpha: 0.4, angle: -0.8, comp: 'multiply' } });
  solid(gx, P, star5(960, 70, 40, 17), { fill: VEL, hatch: '#2a0610', w: 3, boil: B, seed: 593, off: [2, 1], hatchOpt: { gap: 4, width: 1, alpha: 0.5, angle: 0.8, comp: 'multiply' } });
  // --- velvet pelmet (6 swags between rosettes) + gold fringe + tassels
  for (let k = 0; k < 6; k++) {
    const xa = 240 + k * 240, xb = xa + 240;
    const bottom = []; for (let i = 0; i <= 18; i++) { const u = i / 18, s = Math.pow(Math.sin(u * Math.PI), 0.8); bottom.push([lerp(xa, xb, u), 118 + 62 * s]); }
    const poly = [[xa, 116], [xb, 116], ...bottom.slice().reverse()];
    gx.save(); path(gx, poly);
    const gr = gx.createLinearGradient(0, 116, 0, 182); gr.addColorStop(0, VEL_D); gr.addColorStop(0.5, k % 2 ? VEL : VEL_L); gr.addColorStop(1, VEL_D);
    gx.fillStyle = gr; gx.fill(); gx.clip();
    for (let f = 1; f < 9; f++) { // gathered folds fanning from the top corners
      const u = f / 9, tx = lerp(xa, xb, u), bx = lerp(xa, xb, clamp(u + (u < 0.5 ? 0.08 : -0.08)));
      const bi = Math.round(clamp(u + (u < 0.5 ? 0.08 : -0.08)) * 18);
      inkFast(gx, [[tx, 118], [lerp(tx, bottom[bi][0], 0.5), lerp(118, bottom[bi][1], 0.5)], [bottom[bi][0], bottom[bi][1]]], { closed: false, color: '#240510', width: 2.2, boil: B, seed: 800 + k * 13 + f, amp: 0.9, passes: 1, alpha: 0.7 });
    }
    hatchBox(gx, bbox(poly), { color: '#240510', gap: 7, width: 1.1, alpha: 0.28, angle: 1.1, seed: 820 + k, boil: B, comp: 'multiply', dash: 90 });
    gx.restore();
    inkFast(gx, bottom, { closed: false, color: INK, width: 3.2, boil: B, seed: 840 + k, amp: 1.1 });
    gx.save(); gx.strokeStyle = GOLD; gx.lineWidth = 3; gx.lineCap = 'round';
    for (let i = 0; i <= 40; i++) { const u = i / 40, s = Math.pow(Math.sin(u * Math.PI), 0.8), x = lerp(xa, xb, u), y = 118 + 62 * s + 2; gx.beginPath(); gx.moveTo(x, y); gx.lineTo(x + (hash(i, k) - 0.5) * 2, y + 11); gx.stroke(); }
    gx.restore();
  }
  for (let k = 0; k <= 6; k++) { // rosettes + tassels at the swag junctions
    const x = 240 + k * 240;
    if (x < 250 || x > 1670) continue;
    solid(gx, P, P.circlePts(x, 124, 22, 20), { fill: GOLD, hatch: GOLD_D, w: 3, boil: B, seed: 860 + k, off: [2, 2], hatchOpt: { gap: 5, width: 1, alpha: 0.5, angle: 0.6, comp: 'multiply' } });
    solid(gx, P, [[x - 6, 150], [x + 6, 150], [x + 16, 196], [x, 214], [x - 16, 196]], { fill: GOLD, hatch: GOLD_D, w: 2.6, boil: B, seed: 880 + k, off: [2, 1], hatchOpt: { gap: 4.5, width: 1, alpha: 0.5, angle: 1.2, comp: 'multiply' } });
  }
  // --- apron lip + footlights
  gx.fillStyle = '#2A1A0E'; gx.fillRect(O.x0, O.y1 - 8, O.x1 - O.x0, 30);
  inkFast(gx, [[O.x0, O.y1 - 8], [O.x1, O.y1 - 8]], { closed: false, color: GOLD, width: 6, boil: B, seed: 900, amp: 0.8, passes: 1 });
  for (let j = 0; j < 9; j++) {
    const x = 420 + j * 135, fl = 0.8 + 0.2 * hash(Math.floor(B / 2), j, 77);
    // upward cone of light
    const cone = gx.createLinearGradient(0, O.y1 - 10, 0, O.y1 - 330);
    cone.addColorStop(0, `rgba(255,222,140,${0.20 * fl})`); cone.addColorStop(1, 'rgba(255,222,140,0)');
    gx.fillStyle = cone; gx.beginPath(); gx.moveTo(x - 20, O.y1 - 14); gx.lineTo(x + 20, O.y1 - 14); gx.lineTo(x + 100, O.y1 - 330); gx.lineTo(x - 100, O.y1 - 330); gx.closePath(); gx.fill();
    const halo = gx.createRadialGradient(x, O.y1 - 22, 4, x, O.y1 - 22, 70);
    halo.addColorStop(0, `rgba(255,238,180,${0.85 * fl})`); halo.addColorStop(1, 'rgba(255,200,100,0)');
    gx.fillStyle = halo; gx.fillRect(x - 70, O.y1 - 92, 140, 140);
    solid(gx, P, [[x - 32, O.y1 - 8], [x - 26, O.y1 - 26], [x - 12, O.y1 - 36], [x + 12, O.y1 - 36], [x + 26, O.y1 - 26], [x + 32, O.y1 - 8]], { fill: '#3B3040', hatch: '#F0C860', w: 3, boil: B, seed: 920 + j, off: [2, 1], hatchOpt: { gap: 6, width: 1.1, alpha: 0.4, angle: -0.8, comp: 'source-over' } });
    gx.fillStyle = '#FFF6D2'; gx.beginPath(); gx.ellipse(x, O.y1 - 30, 15, 9, 0, 0, TAU); gx.fill();
    inkFast(gx, P.ellipsePts(x, O.y1 - 30, 15, 9, 0, 16), { color: INK, width: 2, boil: B, seed: 940 + j, amp: 0.5, passes: 1 });
  }
}

// ---------- dynamic stage dressing -----------------------------------------------------------------------------------
function drawClouds(ctx, P, T) {
  const t = T.t, B = T.boil;
  const defs = [
    { x: 1395, y: 796, w: 420, h: 138, seed: 11, drift: 8, ph: 0.3, z: 1 },
    { x: 548, y: 808, w: 250, h: 84, seed: 14, drift: 8, ph: 3.3, z: 1 },
    { x: 1430, y: 372, w: 250, h: 96, seed: 12, drift: 16, ph: 1.4, z: 1 },
    { x: 1215, y: 232, w: 210, h: 70, seed: 13, drift: 12, ph: 2.2, z: 0 },
  ];
  defs.forEach((d) => {
    const cx = d.x + Math.sin(t * 0.8 + d.ph) * d.drift, cy = d.y;
    const n = 6, circles = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), mid = 1 - Math.abs(u - 0.5) * 1.5;
      const r = d.h * (0.36 + 0.34 * mid + 0.12 * hash(i, d.seed));
      circles.push([cx - d.w / 2 + u * d.w, cy - r * 0.35 * mid - (i % 2 ? 6 : 0), r]);
    }
    const base = cy + d.h * 0.33;
    ctx.save();
    // outline pass (stroke wide, fill covers the inside) for a clean outer contour
    ctx.lineJoin = 'round'; ctx.strokeStyle = INK; ctx.lineWidth = 8; ctx.globalAlpha = 0.95;
    ctx.beginPath(); circles.forEach(([x, y, r]) => { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }); ctx.rect(cx - d.w / 2 - 4, cy, d.w + 8, base - cy); ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = '#F4EFE0';
    ctx.beginPath(); circles.forEach(([x, y, r]) => { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }); ctx.rect(cx - d.w / 2 - 4, cy, d.w + 8, base - cy); ctx.fill();
    // cut base
    ctx.clip();
    ctx.globalCompositeOperation = 'multiply';
    const sh = ctx.createLinearGradient(0, cy - d.h * 0.5, 0, base); sh.addColorStop(0, 'rgba(160,170,210,0)'); sh.addColorStop(1, 'rgba(110,120,175,0.7)');
    ctx.fillStyle = sh; ctx.fillRect(cx - d.w, cy - d.h, d.w * 2, d.h * 2);
    hatchBox(ctx, { x: cx - d.w / 2, y: cy - d.h * 0.6, w: d.w, h: d.h * 1.1 }, { color: '#4A5390', gap: 7, width: 1.2, alpha: 0.4, angle: -0.8, seed: 950 + d.seed, boil: B, comp: 'multiply', dash: 60 });
    ctx.restore();
    // wooden brace / stick behind the cardboard (shows it is a prop)
    inkFast(ctx, [[cx - d.w * 0.15, base - 2], [cx - d.w * 0.15 - 8, base + 52]], { closed: false, color: '#3a2412', width: 7, boil: B, seed: 960 + d.seed, amp: 0.8, passes: 1 });
    inkFast(ctx, [[cx + d.w * 0.2, base - 2], [cx + d.w * 0.2 + 8, base + 44]], { closed: false, color: '#3a2412', width: 7, boil: B, seed: 962 + d.seed, amp: 0.8, passes: 1 });
    inkFast(ctx, [[cx - d.w / 2 + 6, base], [cx + d.w / 2 - 6, base]], { closed: false, color: INK, width: 4, boil: B, seed: 964 + d.seed, amp: 1.0 });
  });
}

const STARS = [
  { x: 1290, y: 336, s: 54, len: 100, ph: 0.2, hue: 0 }, { x: 1470, y: 508, s: 40, len: 330, ph: 1.7, hue: 1 }, { x: 1216, y: 636, s: 34, len: 460, ph: 3.1, hue: 0 },
  { x: 586, y: 292, s: 42, len: 110, ph: 2.4, hue: 1 }, { x: 706, y: 214, s: 28, len: 40, ph: 0.9, hue: 0 }, { x: 1520, y: 676, s: 30, len: 500, ph: 4.0, hue: 1 }, { x: 452, y: 468, s: 30, len: 290, ph: 5.2, hue: 0 },
];
function drawStars(ctx, P, T) {
  const t = T.t, B = T.boil;
  STARS.forEach((s, i) => {
    const sw = Math.sin(t * 1.9 + s.ph) * 0.045 * (1 + 0.3 * Math.sin(t * 0.7 + i)), ax = s.x, ay = s.y - s.len;
    const sx = ax + Math.sin(sw) * s.len, sy = ay + Math.cos(sw) * s.len;
    // twinkle sweep on 6.75 (sparkle_up): left -> right
    const tw = Math.exp(-Math.pow((t - (6.75 + (s.x - 400) / 1300 * 0.4 + 0.02)) / 0.12, 2)) * 0.5;
    const R = s.s * (1 + tw), r = R * 0.46;
    inkFast(ctx, [[ax, ay], [sx, sy - R * 0.9]], { closed: false, color: '#E9E1CF', width: 2.2, boil: B, seed: 1000 + i, amp: 0.5, passes: 1, alpha: 0.95 });
    inkFast(ctx, [[ax + 1.5, ay], [sx + 1.5, sy - R * 0.9]], { closed: false, color: INK, width: 1, boil: B, seed: 1010 + i, amp: 0.4, passes: 1, alpha: 0.7 });
    const pts = star5(sx, sy, R, r, sw * 1.2 + 0.2 * Math.sin(t * 2 + i));
    solid(ctx, P, pts, { fill: s.hue ? '#FFF1B0' : GOLD, hatch: GOLD_D, w: 3, boil: B, seed: 1020 + i, off: [2.5, 2], hatchOpt: { gap: Math.max(4, R * 0.14), width: 1.1, alpha: 0.45, angle: -0.7, comp: 'multiply' } });
    if (tw > 0.05) { ctx.save(); ctx.globalAlpha = tw; ctx.fillStyle = '#FFFFFF'; spark4(ctx, sx, sy, R * 1.6); ctx.fill(); ctx.restore(); }
  });
}

function drawZzz(ctx, P, T) {
  const t = T.t; if (t > 7.16) return;
  const fade = 1 - smooth((t - 7.0) / 0.16);
  [[666, 478, 38, 0], [622, 414, 52, 0.4], [584, 336, 70, 0.8]].forEach(([x, y, s, ph], i) => {
    const bob = Math.sin(t * 3 + ph * 4) * 5, a = clamp((t - 6.0) / 0.4 - i * 0.3) * fade;
    if (a <= 0) return;
    ctx.save(); ctx.globalCompositeOperation = 'source-over';
    P.text(ctx, 'Z', x, y + bob, { font: `700 ${s}px Caveat`, color: '#F8F2DC', boil: T.boil, seed: 1100 + i, stroke: 9, strokeColor: INK, amp: 1.0, rotate: -0.18, alpha: a });
    ctx.restore();
  });
}

// ---------- the POOF -------------------------------------------------------------------------------------------------
function puffs(t, front) {
  const dt = t - 6.5, out = [];
  if (dt < 0 || dt > 0.6) return out;
  const N = 11;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU + 0.3 + hash(i, 5) * 0.4, side = Math.cos(a), low = Math.sin(a);
    const isFront = low > 0.1 && Math.abs(side) < 0.75; // the low-centre puffs hide the pop, then part to the sides
    if (isFront !== front) continue;
    const D = 150 + hash(i, 6) * 120, r0 = 62 + hash(i, 7) * 34;
    const grow = outCubic(clamp(dt / 0.2)), spread = outCubic(clamp((dt - 0.04) / 0.5));
    const sgn = side >= 0 ? 1 : -1;
    // front puffs slide sideways (out of her way); others rise and spread
    const x = POOF.x + (isFront ? sgn * (50 + 230 * spread) : side * D * 1.35 * spread) + Math.sin(dt * 5 + i) * 4;
    const y = POOF.y - 30 + (isFront ? 40 * low - 26 * spread : low * D * 0.5 * spread) - smooth((dt - 0.3) / 0.7) * 70;
    const r = r0 * grow * (1 - smooth((dt - 0.35) / 0.6) * 0.45);
    const alpha = 1 - smooth((dt - 0.2) / 0.34);
    if (alpha > 0.01 && r > 2) out.push({ x, y, r, alpha, i });
  }
  return out;
}
function drawPuffs(ctx, P, T, front) {
  const B = T.boil;
  puffs(T.t, front).forEach(({ x, y, r, alpha, i }) => {
    ctx.save();
    const pts = []; // lumpy puff: a circle of small bumps
    for (let k = 0; k < 28; k++) { const a = (k / 28) * TAU, rr = r * (1 + 0.06 * Math.sin(a * 5 + i) + 0.025 * Math.sin(a * 11 + i * 2)); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.92]); }
    P.fill(ctx, pts, { color: '#E4E0D6', comp: 'source-over', offset: [3, 2], boil: B, seed: 1200 + i, amp: 1.2, alpha });
    ctx.save(); path(ctx, pts); ctx.clip();
    const sh = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r * 1.1); sh.addColorStop(0, 'rgba(255,255,255,0.9)'); sh.addColorStop(0.6, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(90,92,110,0.5)');
    ctx.fillStyle = sh; ctx.globalAlpha = alpha; ctx.fillRect(x - r * 1.3, y - r * 1.3, r * 2.6, r * 2.6);
    hatchBox(ctx, { x: x - r, y: y - r, w: r * 2, h: r * 2 }, { color: '#6D6F86', gap: 6, width: 1.2, alpha: 0.42 * alpha, angle: -0.7, seed: 1210 + i, boil: B, comp: 'multiply', dash: 40 });
    ctx.restore();
    inkFast(ctx, pts, { color: INK, width: 3.4, boil: B, seed: 1220 + i, amp: 1.2, alpha: alpha * 0.95 });
    ctx.restore();
  });
}
function drawFlashSparks(ctx, P, T) {
  const dt = T.t - 6.5; if (dt < 0 || dt > 0.34) return;
  const B = T.boil;
  const fl = 1 - smooth(dt / 0.14);
  if (fl > 0.01) { ctx.save(); ctx.globalAlpha = 0.95 * fl; const gr = ctx.createRadialGradient(POOF.x, POOF.y, 10, POOF.x, POOF.y, 80 + 380 * outCubic(clamp(dt / 0.14))); gr.addColorStop(0, '#FFFFFF'); gr.addColorStop(0.6, 'rgba(255,240,190,0.8)'); gr.addColorStop(1, 'rgba(255,240,190,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(POOF.x, POOF.y, 470, 0, TAU); ctx.fill(); ctx.restore(); }
  // spark lines (radial burst)
  const u = clamp(dt / 0.3), len = outCubic(u), fade = 1 - smooth((u - 0.45) / 0.55);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU + hash(i, 2) * 0.15, r0 = 120 + 40 * hash(i, 3), r1 = r0 + (70 + 90 * hash(i, 4)) * len;
    const p0 = [POOF.x + Math.cos(a) * (r0 + 60 * len), POOF.y - 20 + Math.sin(a) * (r0 + 60 * len) * 0.85], p1 = [POOF.x + Math.cos(a) * r1, POOF.y - 20 + Math.sin(a) * r1 * 0.85];
    ctx.save();
    inkFast(ctx, [p0, p1], { closed: false, color: INK, width: 9, boil: B, seed: 1300 + i, amp: 0.4, passes: 1, taper: true, alpha: fade });
    inkFast(ctx, [p0, p1], { closed: false, color: '#FFF6D0', width: 5, boil: B, seed: 1330 + i, amp: 0.4, passes: 1, taper: true, alpha: fade });
    ctx.restore();
  }
}

const CONF_COL = ['#FFF3D6', '#9E2230', '#FFD36B', '#2B3A8C', '#FF8A5C', '#1C6E66', '#9AD4FF', '#FFF3D6'];
function drawConfetti(ctx, P, T, pass) { // pass 'back' (pop: behind Amrita) | 'front'
  const t0 = 6.5, tq = Math.floor(T.t * 12 + 1e-6) / 12, tau = tq - t0; // on twos
  if (tau < 0.02) return;
  const w = smooth((T.t - 7.2) / 0.15); // from 7.2 keep the portal clear
  for (let i = 0; i < 48; i++) {
    const a = -Math.PI / 2 + (hash(i, 1) - 0.5) * 2.9, sp = 520 + 700 * Math.pow(hash(i, 2), 1.2), k = 2.6, gg = 620;
    const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp, e = (1 - Math.exp(-k * tau)) / k;
    const born = hash(i, 9) * 0.08; if (tau < born) continue;
    if ((tau < 0.34) !== (pass === 'back')) continue;
    const x = POOF.x + vx * e + Math.sin(tau * 6.5 + hash(i, 3) * TAU) * 20 * smooth(tau / 0.5), y = POOF.y - 40 + (vy + gg / k) * e - (gg / k) * tau;
    if (y > 1010 || x < 250 || x > 1670) continue;
    let alpha = 1;
    const dm = Math.hypot(x - EYE.x, y - EYE.y); alpha = lerp(1, smooth((dm - 128) / 70), w);
    if (alpha < 0.02) continue;
    const spin = hash(i, 4) * TAU + tau * (hash(i, 5) < 0.5 ? -1 : 1) * (6 + 8 * hash(i, 6)), flip = Math.cos(tau * (5 + 6 * hash(i, 7)) + hash(i, 8) * TAU);
    const wd = 23 * (0.35 + 0.65 * Math.abs(flip)), ht = 12 + 5 * hash(i, 10), col = CONF_COL[i % CONF_COL.length];
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(spin);
    ctx.fillStyle = flip < 0 ? P.darken(col, 0.22) : col; ctx.fillRect(-wd / 2, -ht / 2, wd, ht);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.globalAlpha = alpha * 0.8; ctx.strokeRect(-wd / 2, -ht / 2, wd, ht);
    ctx.restore();
  }
}
function drawSparkles(ctx, P, T) {
  const t0 = 6.75, tq = Math.floor(T.t * 12 + 1e-6) / 12, tau = tq - t0; if (tau < 0 || tau > 0.8) return;
  const w = smooth((T.t - 7.2) / 0.15);
  for (let i = 0; i < 22; i++) {
    const born = hash(i, 1) * 0.28, life = 0.35 + hash(i, 2) * 0.3, u = (tau - born) / life; if (u < 0 || u > 1) continue;
    const bx = AMR.x + (hash(i, 3) - 0.5) * 330, by = AMR.y - 40 + (hash(i, 4) - 0.5) * 200;
    const x = bx + Math.sin(u * 5 + i) * 10, y = by - 220 * u * (0.5 + hash(i, 5)), s = (14 + 26 * hash(i, 6)) * Math.sin(u * Math.PI) * (0.8 + 0.4 * Math.sin(u * 20 + i));
    const dm = Math.hypot(x - EYE.x, y - EYE.y); const alpha = lerp(1, smooth((dm - 128) / 70), w);
    if (alpha < 0.02) continue;
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = INK; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
    spark4(ctx, x, y, s); ctx.fill(); ctx.stroke(); ctx.restore();
  }
}

// Amrita on a DARK stage: her fills are 'multiply' (made for paper), so she is painted on a transparent scratch canvas
// (multiply over transparent = the pure pigment) and then composited with source-over.
const _scratch = new Map();
function hero(ctx, T, S, o) {
  const Rm = AMR.size * 1.3, l = Math.ceil((Rm * 1.6) / 32) * 32, r = Math.ceil((Rm * 3.4) / 32) * 32, u = Math.ceil((Rm * 1.9) / 32) * 32, d = u; // her box: prop floats to the right
  const pw = Math.round((l + r) * S.scale), ph = Math.round((u + d) * S.scale), key = pw + 'x' + ph;
  let c = _scratch.get(key);
  if (!c) { c = S.mk(pw, ph); _scratch.set(key, c); }
  const g2 = c.getContext('2d');
  g2.setTransform(1, 0, 0, 1, 0, 0); g2.clearRect(0, 0, pw, ph);
  g2.setTransform(S.scale, 0, 0, S.scale, 0, 0); g2.translate(l - o.x, u - o.y);
  g2.globalCompositeOperation = 'source-over'; g2.globalAlpha = 1;
  const res = amrita(g2, T, S, o);
  ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(c, o.x - l, o.y - u, l + r, u + d); ctx.restore();
  return res;
}
// Amrita (library owner is mid-edit: fall back to a crude stand-in if drawAmrita is not exported yet)
function amrita(ctx, T, S, o) {
  if (S.amrita2d && typeof S.amrita2d.drawAmrita === 'function') return S.amrita2d.drawAmrita(ctx, T, S, o);
  const P = S.pencil, R = o.size, sy = 1 + (o.squash || 0), sx = 1 / Math.sqrt(sy);
  ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.roll || 0); ctx.scale(sx, sy);
  P.shape(ctx, P.circlePts(0, 0, R, 40), { boil: T.boil, seed: 5, fill: { color: '#F2542D', comp: 'source-over' }, ink: { width: 4 } });
  P.shape(ctx, P.circlePts(0, 0, R * 0.62, 6), { boil: T.boil, seed: 6, fill: { color: '#FFF3D6', comp: 'source-over' }, ink: { width: 3 } });
  ctx.fillStyle = '#111'; ctx.fillRect(-R * 0.12, -R * 0.3, R * 0.1, R * 0.2); ctx.fillRect(-R * 0.12, R * 0.1, R * 0.1, R * 0.2);
  ctx.restore();
}

// ---------- Amrita choreography ----------------------------------------------------------------------------------------
function amritaState(t) {
  const dt = t - 6.5;
  if (dt < 0.02) return null;
  const pop = outBack(clamp((dt - 0.02) / 0.2), 2.4);
  let size = AMR.size * (0.08 + 0.92 * pop);
  let squash = 0.42 * Math.exp(-dt * 7.5) * Math.cos(dt * 18);
  const hop = Math.sin(Math.PI * clamp(dt / 0.26)) * 70; // jump out of the smoke, land at 6.76
  let y = AMR.y - hop, roll = 0, yaw = 0.3, eye = { open: 1 }, x = AMR.x;
  const land = t >= 6.76 ? Math.exp(-(t - 6.76) * 14) * Math.cos((t - 6.76) * 26) : 0;
  squash += -0.2 * land;
  // bow: anticipate (6.80-6.90), down (6.90-7.02), hold, rise (7.10-7.28), settle
  const dn = inOutCubic(clamp((t - 6.88) / 0.14)), up = inOutCubic(clamp((t - 7.1) / 0.17)), b = dn * (1 - up);
  const ant = Math.sin(Math.PI * clamp((t - 6.78) / 0.12)) * 0.12;
  const rise = Math.sin(Math.PI * clamp((t - 7.1) / 0.24)) * 0.2;
  const after = t > 7.27 ? Math.exp(-(t - 7.27) * 9) * Math.sin((t - 7.27) * 24) * 0.06 : 0;
  roll = 0.5 * b - 0.04 * Math.sin(Math.PI * clamp((t - 7.18) / 0.2));
  squash += ant - 0.2 * b + rise + after;
  y += 26 * b - 16 * ant * 8 - 14 * rise * 4;
  yaw = 0.3 - 0.12 * b;
  const gaze = smooth((t - 7.12) / 0.2);
  if (b > 0.25 || (t > 6.86 && t < 7.22)) eye = { happy: 1 };
  else if (t < 6.86) eye = { open: 1, lookX: -0.4 };
  else eye = { open: 1, surprised: 0.8 * gaze, lookX: 1 * gaze, lookY: -1 * gaze };
  return { x, y, size, squash, roll, yaw, eye, crank: (t - 6.55) * 11 };
}

// ---------- the scene ------------------------------------------------------------------------------------------------------
export default {
  id: 'e1902', kind: '2d',
  draw(ctx, T, S) {
    const P = S.pencil, B = T.boil, t = T.t;
    ctx.save();
    blit(ctx, cached(S, 'back' + B, (gx) => drawBack(gx, S, B)));
    drawMoon(ctx, P, T, S);
    drawZzz(ctx, P, T);
    drawClouds(ctx, P, T);
    drawStars(ctx, P, T);
    // stage light pool for Amrita
    if (t >= 6.5) {
      const a = smooth((t - 6.5) / 0.2);
      ctx.save(); ctx.globalAlpha = 0.5 * a; const gr = ctx.createRadialGradient(AMR.x, 880, 20, AMR.x, 880, 260); gr.addColorStop(0, 'rgba(255,230,160,0.7)'); gr.addColorStop(1, 'rgba(255,230,160,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(AMR.x, 890, 290, 70, 0, 0, TAU); ctx.fill(); ctx.restore();
    }
    drawPuffs(ctx, P, T, false);
    drawConfetti(ctx, P, T, 'back');
    const A = amritaState(t);
    if (A) {
      // warm halo behind her so she pops off the dark flats
      ctx.save(); const hg = ctx.createRadialGradient(A.x, A.y, A.size * 0.3, A.x, A.y, A.size * 1.9); hg.addColorStop(0, 'rgba(255,236,170,0.55)'); hg.addColorStop(1, 'rgba(255,236,170,0)');
      ctx.fillStyle = hg; ctx.globalAlpha = smooth((t - 6.52) / 0.15); ctx.beginPath(); ctx.arc(A.x, A.y, A.size * 1.9, 0, TAU); ctx.fill(); ctx.restore();
      hero(ctx, T, S, { palette: AMR_PAL, x: A.x, y: A.y, size: A.size, yaw: A.yaw, roll: A.roll, squash: A.squash, eye: A.eye, prop: 'crank', propAnim: { crank: A.crank }, propSide: 1, seed: 17, shadow: false });
    }
    drawPuffs(ctx, P, T, true);
    drawFlashSparks(ctx, P, T);
    // curtains: dynamic while they swing; once settled (6.7) they are baked into the per-boil front layer
    if (t < 6.7) { drawCurtains(ctx, P, curtainK(t), B); blit(ctx, cached(S, 'front' + B, (gx) => drawFront(gx, S, B))); }
    else blit(ctx, cached(S, 'frontc' + B, (gx) => { drawCurtains(gx, P, 1, B); drawFront(gx, S, B); }));
    drawConfetti(ctx, P, T, 'front');
    drawSparkles(ctx, P, T);
    ctx.restore();
  },
};
