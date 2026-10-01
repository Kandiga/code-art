// =============================================================================
// e2009 — THE 3D BOOM (18.0-20.0, 1.43:1 IMAX-style, TEAL-ORANGE, prop: clapperboard, portal LENS @ (1180,560) r=170)
//   Audience POV in an IMAX DOME. A colossal curved screen (sunburst sky, concentric screen-print bands, teal ridges) fills the frame;
//   bold capsule heads with chunky 3D glasses fill the bottom; Amrita floats centre-bottom in GIANT red/cyan 3D glasses —
//   her RIGHT lens is the portal (1180,560) r=170: a clean cyan glass disc (dome + audience reflected in it).
//   18.0-18.5  the screen "film": a swarm of butterflies / shards / arrows hovers around a glowing gem; the screen pushes in
//   18.50      POP_OUT: the whole swarm launches toward us (perspective growth, red/cyan double-printed outlines, motion streaks);
//              the gem becomes the BIGGEST thing: a faceted spear-tip flying straight at the camera
//   19.00      IMAX_BOOM: it hits the lens: whiteout, shock rings, BOOM!, screen shake, the 4 facets blow apart, Amrita recoils,
//              the clapperboard CLACKS, the audience jolts
//   19.4-20.0  everything settles; the right lens is pristine and unoccluded; engine dives into it at 19.5
// Pure function of T.t. Seeded hashing only. Every pencil call gets T.boil (12 fps).
// =============================================================================
import * as P from '../pencil.js';
import { hash, noise1 } from '../rng.js';
import { clamp, lerp, smooth, outCubic, outBack } from '../ease.js';
import { ERAS } from '../../../shared/cues.js';

const ERA = ERAS[7], LENS = ERA.portal;            // {type:'lens', cx:1180, cy:560, r:170}
const TAU = Math.PI * 2;
const POP = 18.5, BOOM = 19.0, CLEAR = 19.4;
const VPX = 960, VPY = 300;                         // vanishing point of the pop-out (the rift / gem on the screen)
const AX = 980, AY = 640, AR = 310;                 // Amrita disc
const LL = { x: LENS.cx - 400, y: LENS.cy, r: LENS.r }; // left lens (red)
const MARGIN = 90;                                  // static layer overscan (screen shake)

const C = {
  ink: '#08161F', wall: '#0E3544', wall2: '#154B5C', teal: '#157A8C', turq: '#25A9AA', mint: '#8FDCC4', cream: '#FFEFC2', white: '#FFFBEA',
  orange: '#FF8A2A', verm: '#F2542D', amber: '#FFB62E', red: '#FF2E3A', cyan: '#27E4FF', violet: '#6B5BFF', plastic: '#120E1E',
};
const FR = '#FF2E3A', FC = '#22E1FF'; // anaglyph fringe colours

// ------------------------------------------------------------------ small helpers
const poly = (ctx, pts) => { ctx.beginPath(); for (let i = 0; i < pts.length; i++) (i ? ctx.lineTo(pts[i][0], pts[i][1]) : ctx.moveTo(pts[i][0], pts[i][1])); ctx.closePath(); };
const polyO = (ctx, pts, dx = 0, dy = 0) => { ctx.beginPath(); for (let i = 0; i < pts.length; i++) (i ? ctx.lineTo(pts[i][0] + dx, pts[i][1] + dy) : ctx.moveTo(pts[i][0] + dx, pts[i][1] + dy)); ctx.closePath(); };
const L = (a, b, t) => a + (b - a) * t;
const norm2 = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const star4 = (cx, cy, r, ri = 0.2, rot = 0) => { const pts = []; for (let i = 0; i < 8; i++) { const a = rot + (i * Math.PI) / 4 - Math.PI / 2, rr = i % 2 ? r * ri : r; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } return pts; };
function glow(ctx, x, y, r, col, a, comp = 'lighter') {
  ctx.save(); ctx.globalCompositeOperation = comp; const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, P.rgba(col, a)); g.addColorStop(0.4, P.rgba(col, a * 0.4)); g.addColorStop(1, P.rgba(col, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
}
// batched coloured-pencil hatching (same look as pencil.hatch, 3 stroke calls instead of one per segment)
function hatchFast(ctx, pts, { color = '#000', angle = -0.75, gap = 12, width = 1.4, alpha = 0.5, boil = 0, seed = 3, jitter = 1.4, shade = null, comp = 'source-over', segLen = 90, clip = true, margin = 0.05 } = {}) {
  const b = P.bounds(pts), Rr = Math.hypot(b.w, b.h) / 2 + 6;
  ctx.save(); if (clip) { poly(ctx, pts); ctx.clip(); }
  ctx.globalCompositeOperation = comp; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineWidth = width;
  const buckets = [new Path2D(), new Path2D(), new Path2D()], used = [false, false, false];
  const c = Math.cos(angle), s = Math.sin(angle), nx = -s, ny = c, lines = Math.ceil((Rr * 2) / gap);
  for (let li = 0; li < lines; li++) {
    const off = -Rr + li * gap + (hash(li, seed, 0) - 0.5) * gap * 0.5 + noise1(li * 0.31, seed + boil * 7) * jitter;
    const ox = b.cx + nx * off, oy = b.cy + ny * off; let t0 = -Rr, guard = 0;
    while (t0 < Rr && guard++ < 300) {
      const len = segLen * (0.6 + hash(li, Math.floor((t0 + Rr) / segLen), seed + 5) * 0.9), t1 = Math.min(Rr, t0 + len);
      const mx = ox + (c * (t0 + t1)) / 2, my = oy + (s * (t0 + t1)) / 2, dens = shade ? shade(mx, my) : 1;
      if (shade == null || hash(li, Math.floor(t0), seed + 11) < dens * (0.55 + margin)) {
        const j = (k) => noise1(li * 0.7 + k, seed * 3 + boil * 5) * jitter, bi = Math.min(2, Math.floor(hash(li, Math.floor(t0), seed + 7) * 3)), pa = buckets[bi]; used[bi] = true;
        pa.moveTo(ox + c * t0 + nx * j(0), oy + s * t0 + ny * j(0));
        pa.quadraticCurveTo(ox + (c * (t0 + t1)) / 2 + nx * j(1) * 1.5, oy + (s * (t0 + t1)) / 2 + ny * j(1) * 1.5, ox + c * t1 + nx * j(2), oy + s * t1 + ny * j(2));
      }
      t0 = t1 + gap * (0.15 + hash(li, Math.floor(t0), seed + 13) * 0.6);
    }
  }
  for (let k = 0; k < 3; k++) if (used[k]) { ctx.globalAlpha = alpha * (0.6 + 0.4 * ((k + 0.5) / 3)); ctx.stroke(buckets[k]); }
  ctx.restore();
}
// cached full-canvas layers (static background per boil step)
const LAYERS = new Map();
function layer(S, key, draw) {
  const k = key + '@' + S.scale; let c = LAYERS.get(k); if (c) return c;
  c = S.mk(Math.round((1920 + 2 * MARGIN) * S.scale), Math.round((1080 + 2 * MARGIN) * S.scale));
  const g = c.getContext('2d'); g.setTransform(S.scale, 0, 0, S.scale, MARGIN * S.scale, MARGIN * S.scale);
  g.fillStyle = '#fff'; g.fillRect(-MARGIN, -MARGIN, 1920 + 2 * MARGIN, 1080 + 2 * MARGIN);
  draw(g); LAYERS.set(k, c); if (LAYERS.size > 5) LAYERS.delete(LAYERS.keys().next().value);
  return c;
}

// ------------------------------------------------------------------ the DOME (static, drawn once per boil step; multiplied onto the paper)
const topY = (x) => 70 + 250 * Math.pow((x - 960) / 1000, 2);   // curved top edge of the screen
const botY = (x) => 832 + 60 * Math.pow((x - 960) / 1000, 2);
function drawDome(g, B) {
  // walls / ceiling
  P.fill(g, P.rectPts(-MARGIN - 10, -MARGIN - 10, 1920 + 2 * MARGIN + 20, 1080 + 2 * MARGIN + 20), { color: C.wall, offset: [5, 4], boil: B, seed: 11, amp: 0 });
  const topPts = [], botPts = [];
  for (let x = -100; x <= 2020; x += 40) topPts.push([x, topY(x)]);
  for (let x = 2020; x >= -100; x -= 40) botPts.push([x, botY(x)]);
  const ceil = [[-100, -100], [2020, -100], ...topPts.slice().reverse()];
  const ceilP = [[-100, -100], ...topPts, [2020, -100]];
  // ceiling: darker + hatch + ribs radiating from the vanishing point
  hatchFast(g, ceilP, { color: '#04141C', angle: 1.15, gap: 11, width: 1.6, alpha: 0.5, boil: B, seed: 21, segLen: 100 });
  for (let i = 0; i <= 18; i++) {
    const x = -100 + i * 118 + (hash(i, 5) - 0.5) * 20, y = topY(x), d = norm2(x - VPX, y - VPY);
    const a = [x, y], b = [x + d[0] * 1000, y + d[1] * 1000];
    P.ink(g, [a, b], { closed: false, color: '#58B5C2', width: 4.5, alpha: 0.5, boil: B, seed: 30 + i, passes: 1, step: 18, amp: 1.4 });
    P.ink(g, [[a[0] + 9, a[1] + 2], [b[0] + 9, b[1] + 2]], { closed: false, color: '#031017', width: 3, alpha: 0.55, boil: B, seed: 60 + i, passes: 1, step: 18, amp: 1.4 });
  }
  for (let k = 1; k <= 4; k++) {
    const pts = []; for (let x = -100; x <= 2020; x += 40) pts.push([x, topY(x) - 46 * k * (1 + 0.1 * k)]);
    P.ink(g, pts, { closed: false, color: '#3B93A3', width: 3.2, alpha: 0.5 - 0.08 * k, boil: B, seed: 80 + k, passes: 1, step: 24, amp: 1.4 });
  }
  // ------------------------------------------------------------- the SCREEN
  const scr = [...topPts, ...botPts];
  g.save(); poly(g, scr); g.clip();
  const bands = [[1650, '#0F4A5C'], [1180, '#14697C'], [850, '#1C95A2'], [610, '#5FC9B6'], [430, '#BDE9C2'], [290, '#FFE7A0'], [175, '#FFFBEA']];
  bands.forEach(([rx, col], i) => {
    P.fill(g, P.ellipsePts(VPX, VPY, rx, rx * 0.8, 0, 90), { color: col, offset: [6, 4], boil: B, seed: 100 + i, amp: 1.2 });
  });
  // pencil texture on the screen bands: dark hatch (density grows towards the edge) + light pencil
  const sh = (x, y) => clamp(Math.hypot(x - VPX, (y - VPY) * 1.25) / 1250, 0.05, 1);
  hatchFast(g, scr, { color: '#06242E', angle: 1.1, gap: 15, width: 1.7, alpha: 0.5, boil: B, seed: 120, shade: sh, segLen: 130, margin: 0.2 });
  hatchFast(g, scr, { color: '#031A22', angle: 0.35, gap: 22, width: 1.5, alpha: 0.4, boil: B, seed: 121, shade: (x, y) => clamp((sh(x, y) - 0.4) * 2, 0, 1), segLen: 110, margin: 0.2 });
  hatchFast(g, scr, { color: '#FFFFFF', angle: -0.6, gap: 21, width: 1.5, alpha: 0.22, boil: B, seed: 122, shade: (x, y) => clamp(1 - sh(x, y) * 1.6, 0, 1), segLen: 90, margin: 0.1 });
  // sunburst rays (light + dark wedges from the vanishing point)
  for (let k = 0; k < 28; k++) {
    const a0 = (k / 28) * TAU + 0.07 + (hash(k, 3) - 0.5) * 0.04, a1 = a0 + (TAU / 28) * (0.38 + 0.2 * hash(k, 4)), R = 2400;
    const w = [[VPX, VPY], [VPX + Math.cos(a0) * R, VPY + Math.sin(a0) * R], [VPX + Math.cos(a1) * R, VPY + Math.sin(a1) * R]];
    g.fillStyle = k % 2 ? 'rgba(255,247,215,0.17)' : 'rgba(4,36,46,0.20)'; poly(g, w); g.fill();
  }
  // far + near ridges
  const ridge = (y0, amp, f, seed, col, rim) => {
    const pts = []; for (let x = -120; x <= 2040; x += 24) pts.push([x, y0 + amp * noise1(x * f, seed) + amp * 0.5 * noise1(x * f * 2.3, seed + 9) + 40 * Math.pow((x - 960) / 1000, 2)]);
    const top = pts.slice(); pts.push([2040, 1200], [-120, 1200]);
    P.fill(g, pts, { color: col, offset: [5, 3], boil: B, seed: seed + 1, amp: 1.1 });
    if (rim) P.ink(g, top, { closed: false, color: rim, width: 3.2, alpha: 0.7, boil: B, seed: seed + 2, passes: 1, step: 16, amp: 1.2 });
    return pts;
  };
  const far = ridge(618, 60, 0.0042, 211, '#0D5565', '#FFC46A');
  hatchFast(g, far, { color: '#04202A', angle: 0.9, gap: 13, width: 1.6, alpha: 0.45, boil: B, seed: 215, segLen: 70 });
  const near = ridge(712, 46, 0.0058, 311, '#072E3C', '#FF9A4A');
  hatchFast(g, near, { color: '#010D13', angle: -0.9, gap: 12, width: 1.7, alpha: 0.5, boil: B, seed: 315, segLen: 70 });
  g.restore();
  // bezel of the screen (thick ink along the curved top edge + a lit inner line)
  P.ink(g, topPts, { closed: false, color: C.ink, width: 10, alpha: 0.95, boil: B, seed: 401, passes: 2, step: 20, amp: 1.6 });
  P.ink(g, topPts.map(([x, y]) => [x, y + 13]), { closed: false, color: '#9FEFF7', width: 3.4, alpha: 0.5, boil: B, seed: 402, passes: 1, step: 20, amp: 1.2 });
  // front wall / floor under the screen + seat-row curves
  const floor = [...botPts.slice().reverse(), [2020, 1200], [-100, 1200]];
  P.fill(g, floor, { color: '#04141D', offset: [5, 4], boil: B, seed: 410, amp: 1 });
  for (let k = 0; k < 3; k++) {
    const pts = []; for (let x = -100; x <= 2020; x += 40) pts.push([x, botY(x) + 18 + 52 * k - 22 * Math.pow((x - 960) / 1000, 2) * k]);
    P.ink(g, pts, { closed: false, color: '#2C8191', width: 3, alpha: 0.5 - 0.1 * k, boil: B, seed: 420 + k, passes: 1, step: 24, amp: 1.2 });
  }
}

// ------------------------------------------------------------------ timeline helpers
const pushOf = (t) => (t < BOOM ? 1 + 0.07 * smooth((t - 18.2) / 0.8) : 1 + 0.07 * (1 - smooth((t - BOOM) / 0.4)));
const recoil = (t) => { const d = t - BOOM; if (d < 0 || d > 0.42) return 0; return Math.exp(-d / 0.11) * (1 - smooth((d - 0.26) / 0.14)) * Math.cos((TAU * d) / 0.22); };
function shakeAmp(t) {
  const d = t - BOOM;
  if (d < 0) return 7 * smooth((t - 18.7) / 0.3);
  if (d > 0.4) return 0;
  return 26 * Math.exp(-d / 0.09) * (1 - smooth((d - 0.22) / 0.18));
}

// ------------------------------------------------------------------ pop-out items
const ITEMS = (() => {
  const out = [];
  for (let i = 0; i < 28; i++) {
    const h = (k) => hash(i * 13 + k, 77);
    const type = i % 7 < 3 ? 'bf' : i % 7 < 5 ? 'sh' : 'ar';
    const ang = i * 2.39996 + h(1) * 0.9;
    const rad = 60 + 330 * Math.pow(h(2), 1.25);
    let ox = Math.cos(ang) * rad * 1.45, oy = Math.sin(ang) * rad * 0.78 + 10;
    if (oy < -130) oy = -130 + (oy + 130) * 0.2;
    const r2 = Math.hypot(ox, oy);
    const Kmin = 1 + (1250 / Math.max(60, r2) - 1) / 2.6;
    out.push({ i, type, ox, oy, K: Math.max(3.4 + h(3) * 5.5, Kmin), delay: h(4) * 0.1, size: type === 'bf' ? 30 + h(5) * 16 : type === 'sh' ? 22 + h(5) * 16 : 52 + h(5) * 26,
      ph: h(6) * TAU, rate: 1.6 + h(7) * 1.3, rot: (h(8) - 0.5) * 0.9, col: Math.floor(h(9) * 4) });
    out[out.length - 1].r2 = r2;
  }
  return out;
})();
const BF_COL = [['#F2542D', '#FFB62E'], ['#FFB62E', '#FFF3D6'], ['#6B5BFF', '#FF8FB0'], ['#FF8A2A', '#FFE9A8']];
const BF_UP = [[0.02, -0.03], [0.10, -0.22], [0.30, -0.44], [0.50, -0.40], [0.54, -0.20], [0.44, -0.02], [0.20, 0.04]];
const BF_LO = [[0.03, 0.04], [0.26, 0.04], [0.42, 0.14], [0.38, 0.34], [0.22, 0.40], [0.08, 0.22]];
const mirror = (pts) => pts.map(([x, y]) => [-x, y]).reverse();

function itemState(it, t) {
  const tau = (t - POP - it.delay) / 0.5;
  const s = tau <= 0 ? 1 : 1 + (it.K - 1) * Math.pow(tau, 1.7);
  return { tau, s };
}
const fringeD = (s, size) => clamp(1.2 + 0.7 * Math.pow(Math.max(0, s - 1), 0.85) * Math.min(1.6, size / 40), 0, 44);
function strokeFringe(ctx, pts, d, w, closed = true, alpha = 0.9) {
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = w; ctx.globalAlpha *= alpha;
  ctx.strokeStyle = FR; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0] + d, p[1] + d * 0.15) : ctx.moveTo(p[0] + d, p[1] + d * 0.15))); if (closed) ctx.closePath(); ctx.stroke();
  ctx.strokeStyle = FC; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0] - d, p[1] - d * 0.15) : ctx.moveTo(p[0] - d, p[1] - d * 0.15))); if (closed) ctx.closePath(); ctx.stroke();
  ctx.restore();
}
// one flat-coloured, inked, anaglyph-fringed piece
function piece(ctx, pts, col, o) {
  const { B, seed, d, size, hatchCol = null, lw = 2.6, ink = '#10202A' } = o;
  P.fill(ctx, pts, { color: col, offset: [size * 0.04, size * 0.03], boil: B, seed, amp: Math.min(2.2, 0.8 + size * 0.004), comp: 'source-over' });
  if (hatchCol && size > 70) hatchFast(ctx, pts, { color: hatchCol, angle: 0.8, gap: Math.max(7, size * 0.07), width: 1.4, alpha: 0.5, boil: B, seed: seed + 3, segLen: size * 0.3, comp: 'multiply' });
  P.ink(ctx, pts, { color: ink, width: Math.min(lw * (1 + size / 260), 9), boil: B, seed: seed + 5, passes: size < 70 ? 1 : 2, amp: Math.min(2.4, 0.8 + size * 0.004), step: clamp(size * 0.07, 5, 18), closed: true });
  strokeFringe(ctx, pts, d, Math.min(2.4 + size * 0.012, 6), true, 0.92);
}
function drawButterfly(ctx, it, st, t, B, a) {
  const { s } = st, push = pushOf(t), se = s * push;
  const idle = st.tau <= 0 ? 1 : 0;
  const px = VPX + it.ox * se + (idle ? noise1(t * 1.1 + it.ph, it.i) * 7 : 0), py = VPY + it.oy * se + (idle ? noise1(t * 1.3 + it.ph, it.i + 9) * 6 : 0);
  const size = it.size * se * (1 + 0.04 * Math.sin(t * 5 + it.ph));
  if (size < 5) return;
  const f = 0.30 + 0.70 * Math.abs(Math.cos(t * it.rate * Math.PI + it.ph)), cols = BF_COL[it.col], rot = it.rot + 0.12 * Math.sin(t * 2 + it.ph);
  const tf = (pts, sx) => P.xform(pts, { x: px, y: py, sx: size * sx, sy: size, rot });
  const d = fringeD(s, size), o = { B, seed: 500 + it.i * 7, d, size, hatchCol: '#5A1A10' };
  ctx.save(); ctx.globalAlpha *= a;
  if (st.tau > 0) streak(ctx, it, st, t, size * 0.5, a);
  const wings = [[tf(BF_LO, f), cols[1]], [tf(mirror(BF_LO), f), cols[1]], [tf(BF_UP, f), cols[0]], [tf(mirror(BF_UP), f), cols[0]]];
  wings.forEach(([pts, col], k) => piece(ctx, pts, col, { ...o, seed: o.seed + k * 11 }));
  // body + dots
  const body = P.xform(P.ellipsePts(0, 0.04, 0.045, 0.24, 0, 14), { x: px, y: py, sx: size, sy: size, rot });
  piece(ctx, body, '#1A1230', { ...o, seed: o.seed + 50, lw: 2 });
  if (size > 34) { ctx.fillStyle = '#FFF3D6'; [[0.30 * f, -0.22], [-0.30 * f, -0.22]].forEach(([x, y]) => { const q = P.xform([[x, y]], { x: px, y: py, sx: size, sy: size, rot })[0]; ctx.beginPath(); ctx.arc(q[0], q[1], size * 0.045, 0, TAU); ctx.fill(); }); }
  ctx.restore();
}
const SH_PTS = [[-0.55, 0.05], [-0.05, -0.95], [0.5, 0.0], [0.12, 0.9]];
function drawShard(ctx, it, st, t, B, a) {
  const { s } = st, push = pushOf(t), se = s * push;
  const px = VPX + it.ox * se, py = VPY + it.oy * se, size = it.size * se;
  if (size < 4) return;
  const phs = t * (1.5 + it.rate) + it.ph, sx = 0.22 + 0.78 * Math.abs(Math.cos(phs)), rot = it.rot * 2 + t * (0.9 + 0.5 * it.rate) * (it.i % 2 ? 1 : -1) * (st.tau > 0 ? 2.2 : 0.7);
  const tf = (pts) => P.xform(pts, { x: px, y: py, sx: size * sx, sy: size, rot });
  const A1 = tf([SH_PTS[0], SH_PTS[1], SH_PTS[3]]), A2 = tf([SH_PTS[1], SH_PTS[2], SH_PTS[3]]), all = tf(SH_PTS);
  const d = fringeD(s, size), pal = [['#FFE9A8', '#F2542D'], ['#FFB62E', '#C73A22'], ['#FFF3D6', '#FF8A2A'], ['#8FE8F0', '#FF6A3A']][it.col];
  const o = { B, seed: 700 + it.i * 5, d: 0, size, hatchCol: '#4A1208' };
  ctx.save(); ctx.globalAlpha *= a;
  if (st.tau > 0) streak(ctx, it, st, t, size * 0.5, a);
  piece(ctx, A1, pal[0], o); piece(ctx, A2, pal[1], { ...o, seed: o.seed + 9 });
  strokeFringe(ctx, all, d, Math.min(2.4 + size * 0.012, 6), true, 0.92);
  ctx.restore();
}
function drawArrow(ctx, it, st, t, B, a) {
  const { s } = st, push = pushOf(t), se = s * push;
  const lz = 0.42, sTail = se / (1 + 0.5 * lz * se), sHead = se, sBase = se / (1 + 0.5 * 0.12 * se);
  const dx = it.ox, dy = it.oy;
  const tip = [VPX + dx * sHead, VPY + dy * sHead], base = [VPX + dx * sBase, VPY + dy * sBase], tail = [VPX + dx * sTail, VPY + dy * sTail];
  const len = Math.hypot(tip[0] - tail[0], tip[1] - tail[1]);
  const w0 = it.size * 0.075; // shaft half-width at s=1
  if (w0 * sHead < 0.8 && len < 6) return;
  const [ux, uy] = len > 1 ? [(tip[0] - tail[0]) / len, (tip[1] - tail[1]) / len] : [0, -1], nx = -uy, ny = ux;
  const hw = w0 * sHead, tw = w0 * sTail, bw = w0 * sBase;
  const shaft = [[tail[0] + nx * tw, tail[1] + ny * tw], [base[0] + nx * bw, base[1] + ny * bw], [base[0] - nx * bw, base[1] - ny * bw], [tail[0] - nx * tw, tail[1] - ny * tw]];
  const hb = 2.8 * bw, head = [tip, [base[0] + nx * hb, base[1] + ny * hb], [base[0] - nx * hb, base[1] - ny * hb]];
  const fl = (sg) => [[tail[0] + nx * tw * sg, tail[1] + ny * tw * sg], [tail[0] + nx * tw * 3.2 * sg - ux * 5 * tw, tail[1] + ny * tw * 3.2 * sg - uy * 5 * tw], [L(tail[0], base[0], 0.30) + nx * tw * 1.0 * sg, L(tail[1], base[1], 0.30) + ny * tw * 1.0 * sg]];
  const size = Math.max(hw * 6, len * 0.5), d = fringeD(s, size * 1.2);
  const pal = [['#FFF3D6', '#F2542D', '#27B7C9'], ['#FFE9A8', '#FF8A2A', '#6B5BFF'], ['#FFFBEA', '#FFB62E', '#F2542D'], ['#FFF3D6', '#C73A22', '#FF8FB0']][it.col];
  const o = { B, seed: 900 + it.i * 3, d, size, hatchCol: '#3A1008', lw: 2.2 };
  ctx.save(); ctx.globalAlpha *= a;
  if (st.tau > 0) streak(ctx, it, st, t, hw * 1.4, a, tail);
  piece(ctx, fl(1), pal[2], { ...o, seed: o.seed + 1 }); piece(ctx, fl(-1), pal[2], { ...o, seed: o.seed + 2 });
  piece(ctx, shaft, pal[0], { ...o, seed: o.seed + 3 }); piece(ctx, head, pal[1], { ...o, seed: o.seed + 4 });
  ctx.restore();
}
// motion streak: from where the item was 0.07 s ago towards its present position (and a lazy trail back to the vanishing point)
function streak(ctx, it, st, t, w, a, from = null) {
  const prevS = 1 + (it.K - 1) * Math.pow(Math.max(0, st.tau - 0.17), 1.7), push = pushOf(t);
  const x1 = VPX + it.ox * st.s * push, y1 = VPY + it.oy * st.s * push, x0 = VPX + it.ox * prevS * push, y0 = VPY + it.oy * prevS * push;
  const [ux, uy] = norm2(x1 - x0, y1 - y0), nx = -uy, ny = ux, ww = clamp(w, 2, 60);
  const al = clamp(st.tau * 4, 0, 1) * 0.55 * a;
  if (al <= 0.02 || Math.hypot(x1 - x0, y1 - y0) < 4) return;
  ctx.save(); ctx.fillStyle = `rgba(255,248,225,${al})`;
  ctx.beginPath(); ctx.moveTo(x1 + nx * ww, y1 + ny * ww); ctx.lineTo(x0, y0); ctx.lineTo(x1 - nx * ww, y1 - ny * ww); ctx.closePath(); ctx.fill(); ctx.restore();
}

// ---- the hero: a faceted spear-tip flying straight at the camera (also the gem on the screen before the pop)
const HERO_H0 = 14;
function heroScale(t) {
  if (t < POP) return 1.3 + 0.3 * smooth((t - 18.0) / 0.5) + 0.06 * Math.sin(t * 9);
  const tau = clamp((t - POP) / 0.5, 0, 1.6);
  return 1.6 + (130 - 1.6) * Math.pow(tau, 2.55);
}
function heroFacets(t) {
  const se = heroScale(t) * (t < POP ? pushOf(t) : 1), hs = HERO_H0 * se, spin = 0.35 + 0.5 * (t - 18.0) + (t > POP ? 1.2 * Math.pow((t - POP) / 0.5, 2) : 0);
  const c = Math.cos(spin), sn = Math.sin(spin), ap = [0.16, -0.12];
  const rot = ([x, y]) => [VPX + hs * (x * c - y * sn), VPY + hs * (x * sn + y * c)];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(rot), apex = rot(ap);
  return { hs, apex, facets: [0, 1, 2, 3].map((k) => [apex, corners[k], corners[(k + 1) % 4]]), spin };
}
const HERO_COL = ['#FFE9A8', '#FFB62E', '#E0432B', '#0F5A6E'];
function drawHero(ctx, t, B) {
  const H = heroFacets(t), d = t >= BOOM ? 0 : (t < POP ? 1 : clamp(1.5 + 0.55 * Math.pow(heroScale(t), 0.62), 1, 44));
  const tb = t - BOOM; if (tb > 0.34) return;
  ctx.save();
  if (t < POP) { glow(ctx, VPX, VPY, 150 + 40 * smooth((t - 18) / 0.5), '#FFF3C8', 0.9); glow(ctx, VPX, VPY, 60, '#FFFFFF', 0.9); }
  else if (t < BOOM) { glow(ctx, VPX, VPY, Math.min(1800, H.hs * 2.2), '#FFF3C8', 0.55); }
  H.facets.forEach((f, k) => {
    ctx.save();
    if (tb > 0) {
      const cx = (f[0][0] + f[1][0] + f[2][0]) / 3, cy = (f[0][1] + f[1][1] + f[2][1]) / 3, [ux, uy] = norm2(cx - H.apex[0] + (k - 1.5) * 4, cy - H.apex[1] - 2);
      const off = 3000 * tb + 14000 * tb * tb, rr = 0.9 * tb * (k % 2 ? 1 : -1);
      ctx.translate(f[0][0], f[0][1]); ctx.rotate(rr); ctx.translate(-f[0][0], -f[0][1]); ctx.translate(ux * off, uy * off);
    }
    const col = HERO_COL[k], sz = H.hs * 1.4;
    const stroke = Math.min(4 + sz * 0.012, 12);
    P.fill(ctx, f, { color: col, offset: [sz * 0.015, sz * 0.01], boil: B, seed: 1100 + k, amp: Math.min(2.4, 0.8 + sz * 0.002), comp: 'source-over' });
    if (sz > 60) hatchFast(ctx, f, { color: k === 0 ? '#C9822A' : k === 3 ? '#031E27' : '#5A1208', angle: 0.7 + k * 0.5, gap: clamp(sz * 0.03, 6, 26), width: clamp(sz * 0.004, 1.3, 3), alpha: 0.55, boil: B, seed: 1110 + k, segLen: clamp(sz * 0.2, 30, 300), comp: 'multiply', jitter: 1.8 });
    P.ink(ctx, f, { color: '#0E1A22', width: stroke, boil: B, seed: 1120 + k, passes: 2, amp: Math.min(3.5, 1 + sz * 0.003), step: clamp(sz * 0.06, 6, 40), closed: true });
    strokeFringe(ctx, f, d, Math.min(2.6 + sz * 0.01, 9), true, 0.95);
    ctx.restore();
  });
  // highlights: a cream glint on the apex
  if (t < BOOM) { const gl = Math.min(1, 0.4 + H.hs / 120); ctx.globalAlpha = 0.9 * gl; ctx.fillStyle = '#FFFFFF'; poly(ctx, star4(H.apex[0], H.apex[1], clamp(H.hs * 0.5, 14, 60), 0.16, 0.2)); ctx.fill(); }
  ctx.restore();
}

// ------------------------------------------------------------------ audience heads
function drawHeads(ctx, t, B) {
  const rows = [
    { w: 104, gap: 118, y: 770, col: '#0E3342', rim: '#7FD6DE', seed: 1, off: 0, hatch: 0.0 },
    { w: 152, gap: 172, y: 810, col: '#082531', rim: '#62C6D2', seed: 2, off: 70, hatch: 0.0 },
    { w: 224, gap: 252, y: 858, col: '#04131B', rim: '#4DB6C4', seed: 3, off: -30, hatch: 0.0 },
  ];
  const lean = smooth((t - 18.5) / 0.45) * (t < BOOM ? 1 : 0) * 7 + (t >= BOOM ? 7 * (1 - smooth((t - BOOM) / 0.4)) : 0);
  rows.forEach((r, ri) => {
    const n = Math.ceil(2100 / r.gap) + 1;
    for (let k = 0; k < n; k++) {
      const x0 = -90 + k * r.gap + r.off + (hash(k, r.seed, 1) - 0.5) * 18;
      if (x0 < 110 || x0 > 1810) continue;
      const hh = r.w * (1.14 + 0.1 * hash(k, r.seed, 2)), w = r.w * (0.94 + 0.12 * hash(k, r.seed, 3));
      const rc = recoil(t - hash(k, r.seed, 4) * 0.04);
      const dy = -r.w * 0.05 * (hash(k, r.seed, 5) - 0.3) * 0 - lean * (1 - ri * 0.2) - 20 * rc * (1 - ri * 0.25) + 2 * Math.sin(t * 1.4 + k * 1.3 + ri);
      const dx = 3 * Math.sin(t * 0.9 + k * 2.1) + (hash(k, r.seed, 6) - 0.5) * 6 + 5 * rc * (k % 2 ? 1 : -1);
      const topv = r.y - 36 * Math.pow((x0 - 960) / 900, 2) + dy + (hash(k, r.seed, 7) - 0.5) * 16;
      const x = x0 + dx;
      // glasses first (poke out of both sides; head overlaps their inner half)
      const yE = topv + hh * 0.27, tw = w * 0.30, th = r.w * 0.2;
      const tabL = P.rectPts(x - w / 2 - tw * 0.6, yE - th / 2, tw, th, th * 0.35), tabR = P.rectPts(x + w / 2 - tw * 0.4, yE - th / 2, tw, th, th * 0.35);
      P.fill(ctx, tabL, { color: '#E63A3A', offset: [1, 1], boil: B, seed: 1300 + k * 3 + ri, amp: 0.4, comp: 'source-over' });
      P.fill(ctx, tabR, { color: '#27C9E6', offset: [1, 1], boil: B, seed: 1301 + k * 3 + ri, amp: 0.4, comp: 'source-over' });
      P.ink(ctx, tabL, { color: '#02090E', width: 2.4, boil: B, seed: 1302 + k, passes: 1, amp: 0.6, step: 8 });
      P.ink(ctx, tabR, { color: '#02090E', width: 2.4, boil: B, seed: 1303 + k, passes: 1, amp: 0.6, step: 8 });
      const head = P.rectPts(x - w / 2, topv, w, hh, w * 0.47, 7);
      P.fill(ctx, head, { color: r.col, offset: [1.5, 1], boil: B, seed: 1310 + k * 3 + ri, amp: 0.6, comp: 'source-over' });
      if (ri > 0) hatchFast(ctx, head, { color: '#2F8EA0', angle: 1.2 + ri * 0.3, gap: 11 + ri * 2, width: 1.4, alpha: 0.2, boil: B, seed: 1320 + k, segLen: 60, shade: (px, py) => clamp(1.0 - (py - topv) / (hh * 0.7), 0, 1) * 0.9 + 0.05 });
      P.ink(ctx, head, { color: '#010A10', width: 3 + ri, boil: B, seed: 1330 + k * 3 + ri, passes: ri > 0 ? 2 : 1, amp: 1, step: 11 });
      // rim light (the screen behind the heads)
      ctx.save(); ctx.strokeStyle = r.rim; ctx.globalAlpha = 0.85; ctx.lineWidth = 2.4 + ri * 1.3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, topv + w * 0.47, w * 0.47 - 3, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(x, topv + w * 0.47, w * 0.47 - 9 - ri * 2, Math.PI * 1.2, Math.PI * 1.55); ctx.stroke(); ctx.restore();
    }
  });
}

// ------------------------------------------------------------------ Amrita + the giant 3D glasses
function eyeNumbers(S, T) {
  const A = S.amrita2d, t = T.t;
  const script = [
    { t: 0, expr: 'neutral', look: [0.12, -0.78], dur: 0.01, ease: 'snap' },
    { t: 18.3, expr: 'focus', amt: 0.5, look: [0.05, -0.62], dur: 0.14 },
    { t: 18.5, expr: 'surprised', amt: 1.0, look: [0, -0.35], dur: 0.1 },
    { t: 18.8, expr: 'surprised', amt: 1.2, look: [0, -0.1], dur: 0.15 },
    { t: 19.0, eye: { open: 0.14, squint: 1, lookY: 0.2 }, dur: 0.03 },
    { t: 19.2, expr: 'surprised', amt: 0.7, look: [0, 0], dur: 0.1 },
    { t: 19.32, expr: 'joy', amt: 1, dur: 0.16, ease: 'spring' },
  ];
  return A.eyeAnim({ ...T, t, lt: t }, script, { time: 't', blink: t < 18.45 });
}
function drawLensEye(ctx, S, cx, cy, side, e, sc) {
  const sh = S.amrita2d.eyeShape(e, side);
  const ox = (e.lookX || 0) * 26, oy = (e.lookY || 0) * 24;
  const pts = sh.pts.map((p) => [cx + ox + p[0] * sc, cy + oy + p[1] * sc]);
  ctx.save(); ctx.fillStyle = '#0A0716'; poly(ctx, pts); ctx.fill(); ctx.strokeStyle = '#0A0716'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
  if (sh.happy > 0.55) { ctx.lineWidth = 7; ctx.stroke(); }
  if (sh.glintA > 0.02) {
    ctx.globalAlpha = sh.glintA; ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.ellipse(cx + ox + sh.glint.x * sc, cy + oy + sh.glint.y * sc, sh.glint.rx * sc, sh.glint.ry * sc, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + ox + sh.glint2.x * sc, cy + oy + sh.glint2.y * sc, sh.glint2.r * sc, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
function lensBase(ctx, l, kind) {
  ctx.save(); ctx.beginPath(); ctx.arc(l.x, l.y, l.r, 0, TAU); ctx.clip();
  const g = ctx.createLinearGradient(l.x - l.r * 0.85, l.y - l.r * 0.95, l.x + l.r * 0.85, l.y + l.r * 0.95);
  if (kind === 'cyan') { g.addColorStop(0, '#E6FDFF'); g.addColorStop(0.28, '#5CE7FA'); g.addColorStop(0.7, '#1FB4E6'); g.addColorStop(1, '#1480C4'); }
  else { g.addColorStop(0, '#FFE2DC'); g.addColorStop(0.28, '#FF7A6C'); g.addColorStop(0.7, '#E8303F'); g.addColorStop(1, '#A81042'); }
  ctx.fillStyle = g; ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  // dome reflection: the lit screen (upper band) and the audience (lower bumps)
  ctx.fillStyle = kind === 'cyan' ? 'rgba(255,246,214,0.50)' : 'rgba(255,238,200,0.42)';
  ctx.beginPath(); ctx.ellipse(l.x, l.y - l.r * 0.18, l.r * 0.66, l.r * 0.34, 0, Math.PI * 1.04, Math.PI * 1.96); ctx.closePath(); ctx.fill();
  ctx.fillStyle = kind === 'cyan' ? 'rgba(6,40,70,0.38)' : 'rgba(70,6,30,0.36)';
  for (let i = 0; i < 5; i++) { const bx = l.x - l.r * 0.62 + i * l.r * 0.31, by = l.y + l.r * (0.62 + 0.05 * (i % 2)); ctx.beginPath(); ctx.arc(bx, by + l.r * 0.2, l.r * 0.17, Math.PI, TAU); ctx.fill(); ctx.fillRect(bx - l.r * 0.17, by + l.r * 0.2, l.r * 0.34, l.r * 0.5); }
  ctx.restore();
}
function lensShine(ctx, l, kind, t) {
  ctx.save(); ctx.beginPath(); ctx.arc(l.x, l.y, l.r, 0, TAU); ctx.clip();
  // chromatic rim (red on the cyan lens, cyan on the red lens)
  ctx.lineCap = 'round'; ctx.strokeStyle = kind === 'cyan' ? 'rgba(255,60,80,0.55)' : 'rgba(40,225,255,0.55)'; ctx.lineWidth = l.r * 0.11;
  ctx.beginPath(); ctx.arc(l.x, l.y, l.r * 0.94, 0.25, 1.55); ctx.stroke();
  ctx.strokeStyle = kind === 'cyan' ? 'rgba(40,225,255,0.5)' : 'rgba(255,70,90,0.5)'; ctx.lineWidth = l.r * 0.06;
  ctx.beginPath(); ctx.arc(l.x, l.y, l.r * 0.96, 3.5, 4.5); ctx.stroke();
  // specular streaks
  ctx.strokeStyle = 'rgba(255,255,255,0.88)'; ctx.lineWidth = l.r * 0.085;
  ctx.beginPath(); ctx.arc(l.x, l.y, l.r * 0.76, 3.35, 4.3); ctx.stroke();
  ctx.lineWidth = l.r * 0.045; ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(l.x, l.y, l.r * 0.76, 4.42, 4.72); ctx.stroke();
  ctx.lineWidth = l.r * 0.05; ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.arc(l.x, l.y, l.r * 0.82, 0.55, 0.95); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(l.x - l.r * 0.5, l.y - l.r * 0.5, l.r * 0.06, 0, TAU); ctx.fill();
  ctx.restore();
}
function glassFrame(ctx, l, B, seed) {
  const ro = l.r + 26;
  ctx.save(); ctx.beginPath(); ctx.arc(l.x, l.y, ro, 0, TAU); ctx.arc(l.x, l.y, l.r, 0, TAU, true); ctx.fillStyle = C.plastic; ctx.fill('evenodd');
  // bevel: warm highlight on the upper-left of the ring, cream hairline just outside the glass
  ctx.strokeStyle = 'rgba(255,214,150,0.55)'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(l.x, l.y, l.r + 15, 3.4, 4.6); ctx.stroke();
  ctx.strokeStyle = '#FFF3D6'; ctx.lineWidth = 3; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(l.x, l.y, l.r + 3.5, 0, TAU); ctx.stroke(); ctx.restore();
  P.ink(ctx, P.circlePts(l.x, l.y, ro, 72), { color: '#05030A', width: 4, boil: B, seed, passes: 2, amp: 1.5, step: 12 });
}
function drawGlassesAndFace(ctx, T, S, B, e) {
  const t = T.t, A = S.amrita2d;
  A.drawAmrita(ctx, T, S, { x: AX, y: AY, size: AR, yaw: 0.04, roll: Math.PI / 2, style: 'ink', noEyes: true, shadow: false, seed: 21, expr: 'neutral' });
  // temples + bridge (behind the lens rings)
  const mid = (LENS.cx + LL.x) / 2, yb = LENS.cy - 22;
  const arm = (sg) => { const x0 = (sg > 0 ? LENS.cx + LENS.r + 20 : LL.x - LENS.r - 20), x1 = x0 + sg * 86; return [[x0, yb - 20], [x1, yb - 10], [x1 + sg * 6, yb + 22], [x0, yb + 22]]; };
  [-1, 1].forEach((sg, i) => { const a = arm(sg); P.fill(ctx, a, { color: C.plastic, offset: [1, 1], boil: B, seed: 1500 + i, amp: 0.5, comp: 'source-over' }); P.ink(ctx, a, { color: '#05030A', width: 3.4, boil: B, seed: 1502 + i, passes: 2, amp: 1, step: 10 }); });
  const br = P.rectPts(mid - 46, yb - 28, 92, 44, 16); P.fill(ctx, br, { color: C.plastic, offset: [1, 1], boil: B, seed: 1510, amp: 0.5, comp: 'source-over' }); P.ink(ctx, br, { color: '#05030A', width: 3.4, boil: B, seed: 1511, passes: 2, amp: 1, step: 10 });
  // lenses: tinted glass -> her eyes -> reflections -> frame
  [[LL, 'red', -1], [LENS, 'cyan', 1]].forEach(([l, kind, side]) => {
    lensBase(ctx, l, kind);
    drawLensEye(ctx, S, l.x, l.y + 6, side, e, 500);
    lensShine(ctx, l, kind, t);
    glassFrame(ctx, l, B, 1520 + side);
  });
  // glints on the frame
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,250,230,0.9)';
  const gs = 0.7 + 0.3 * Math.sin(t * 6); poly(ctx, star4(LENS.cx - LENS.r * 0.74, LENS.cy - LENS.r * 0.74, 34 * gs, 0.16, 0)); ctx.fill(); ctx.restore();
}

// ------------------------------------------------------------------ main draw
export default {
  id: 'e2009', kind: '2d',
  draw(ctx, T, S) {
    const t = T.t, B = T.boil, A = S.amrita2d;
    P.paper(ctx, S, { seed: 9 });
    const f60 = Math.floor(t * 60 + 1e-6), sa = shakeAmp(t), rc = recoil(t);
    ctx.save();
    ctx.translate((hash(f60, 11) - 0.5) * 2 * sa, (hash(f60, 12) - 0.5) * 2 * sa);
    // 1) the dome + screen (cached per boil step), pushing in towards the vanishing point
    const dome = layer(S, 'dome' + B, (g) => drawDome(g, B));
    const push = pushOf(t);
    ctx.save(); ctx.translate(VPX, VPY); ctx.scale(push, push); ctx.translate(-VPX, -VPY);
    ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(dome, -MARGIN, -MARGIN, 1920 + 2 * MARGIN, 1080 + 2 * MARGIN);
    ctx.restore();
    // glow at the rift
    glow(ctx, VPX, VPY, 420 * push, '#FFF3C8', 0.35 + 0.25 * smooth((t - 18.2) / 0.7));
    // 2) radial speed lines (peak around the boom)
    const sp = smooth((t - 18.55) / 0.3) * (1 - smooth((t - 19.12) / 0.2));
    if (sp > 0.01) {
      ctx.save(); ctx.fillStyle = 'rgba(255,248,225,0.9)'; ctx.globalAlpha = 0.5 * sp;
      for (let k = 0; k < 46; k++) {
        const a = (k / 46) * TAU + hash(k, 8) * 0.12, r0 = 150 + 520 * hash(k, 9) + 700 * Math.pow(sp, 2) * hash(k, 10), r1 = r0 + 300 + 700 * hash(k, 12) * sp, w = 2 + 5 * hash(k, 13);
        const c = Math.cos(a), s = Math.sin(a), nx = -s, ny = c;
        ctx.beginPath(); ctx.moveTo(VPX + c * r0 + nx * w, VPY + s * r0 + ny * w); ctx.lineTo(VPX + c * r1, VPY + s * r1); ctx.lineTo(VPX + c * r0 - nx * w, VPY + s * r0 - ny * w); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    // 3) items behind Amrita
    const alphaOf = (tt) => 1 - smooth((tt - 19.2) / 0.1);
    const itemA = alphaOf(t);
    const live = ITEMS.map((it) => ({ it, st: itemState(it, t) }));
    const drawIt = (o) => { const { it, st } = o; if (itemA <= 0.01) return; if (it.type === 'bf') drawButterfly(ctx, it, st, t, B, itemA); else if (it.type === 'sh') drawShard(ctx, it, st, t, B, itemA); else drawArrow(ctx, it, st, t, B, itemA); };
    const SA = 2.0;
    live.filter((o) => o.st.s < SA).sort((a, b) => a.st.s - b.st.s).forEach(drawIt);
    // 4) audience
    drawHeads(ctx, t, B);
    // 5) clapperboard (floats lower-left; CLACKS on the boom)
    const cl = A.clapAt(t, BOOM, { pre: 0.45, hold: 0.1 });
    A.drawProp(ctx, T, S, 'clapper', { x: 420, y: 730 + 6 * Math.sin(t * 2.2) * (t < 18.9 ? 1 : 0) + 10 * rc, size: 190, anim: { t, clap: cl.clap, hit: cl.hit }, boil: B, seed: 5, style: 'ink' });
    // 6) Amrita + glasses (group transform for the recoil; identity at rest => the lens sits exactly at (1180,560))
    const e = eyeNumbers(S, T);
    const bob = (t < 18.9 ? 5 * Math.sin(t * 2.6) : 0) * (1 - smooth((t - 18.75) / 0.15));
    const pop = smooth((t - 18.5) / 0.06) * (1 - smooth((t - 18.62) / 0.2));
    ctx.save();
    ctx.translate(AX, AY); ctx.rotate(-0.13 * rc - 0.03 * pop); ctx.translate(0, bob + 34 * rc - 10 * pop); const k = 1 - 0.05 * rc + 0.03 * pop; ctx.scale(k, k * (1 + 0.04 * rc - 0.03 * pop)); ctx.translate(-AX, -AY);
    drawGlassesAndFace(ctx, T, S, B, e);
    ctx.restore();
    // 7) items in front of Amrita + the hero spear-tip
    live.filter((o) => o.st.s >= SA).sort((a, b) => a.st.s - b.st.s).forEach(drawIt);
    drawHero(ctx, t, B);
    // 8) impact: shock rings, flash, BOOM!
    const d = t - BOOM;
    if (d >= 0 && d < 0.5) {
      [0, 0.07].forEach((dl, i) => {
        const x = clamp((d - dl) / 0.4, 0, 1); if (x <= 0 || x >= 1) return;
        const r = 1500 * outCubic(x) * (i ? 0.72 : 1), w = (i ? 12 : 22) * (1 - x) + 2, al = (1 - x) * (i ? 0.7 : 0.95);
        ctx.save(); ctx.globalAlpha = al;
        P.ink(ctx, P.circlePts(VPX + 7, VPY + 30, r, 100), { color: FR, width: w, boil: B, seed: 1600 + i, passes: 1, amp: 3, step: 24 });
        P.ink(ctx, P.circlePts(VPX - 7, VPY + 30, r, 100), { color: FC, width: w, boil: B, seed: 1610 + i, passes: 1, amp: 3, step: 24 });
        P.ink(ctx, P.circlePts(VPX, VPY + 30, r, 100), { color: '#FFFBEA', width: w * 0.6, boil: B, seed: 1620 + i, passes: 1, amp: 3, step: 24 });
        ctx.restore();
      });
    }
    const flash = t < BOOM ? 0.35 * smooth((t - 18.93) / 0.07) : 0.95 * Math.pow(clamp(1 - d / 0.24), 2);
    if (flash > 0.01) { ctx.save(); ctx.fillStyle = `rgba(255,250,232,${flash})`; ctx.fillRect(-100, -100, 2120, 1280); ctx.restore(); }
    if (d >= -0.01 && d < 0.4) {
      const k2 = outBack(clamp(d / 0.13), 2.2), al = 1 - smooth((d - 0.26) / 0.1), sc = 0.35 + 0.65 * k2;
      ctx.save(); ctx.globalAlpha = Math.max(0, al); ctx.translate(960, 205); ctx.rotate(-0.07); ctx.scale(sc, sc);
      const font = S.F.hand(210, 700);
      P.text(ctx, 'BOOM!', 8, 6, { font, color: FR, align: 'center', boil: B, seed: 41, amp: 2 });
      P.text(ctx, 'BOOM!', -8, -2, { font, color: FC, align: 'center', boil: B, seed: 42, amp: 2 });
      P.text(ctx, 'BOOM!', 0, 2, { font, color: '#FFFBEA', align: 'center', boil: B, seed: 43, amp: 2, stroke: 16, strokeColor: '#10202A' });
      ctx.restore();
    }
    ctx.restore();
  },
};
