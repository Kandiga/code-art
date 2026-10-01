// =============================================================================
// coldopen — 0.0-4.0 s, 16:9, grade 'projector'.   "Every film starts with a blank page."
//   0.0-1.0  darkness: only a faint pencil-drawn film gate + sprocket glow (projector spinning up)
//   1.0      lamp strikes (flash + arc flicker) -> ONE hatched cone of light from the upper-left
//   1.0-2.0  the beam finds a big blank sheet lying tilted on a dark table; dust motes drift in the beam
//   1.5-3.0  sheet stays blank (the engine writes the title on its lower part, y 800-930)
//   2.0-3.0  pencil construction lines -> aperture blades trace on -> play-triangle traces on  (Amrita sketches herself)
//   3.0      eyes_open: two glossy black ovals open, blink, glance up toward the light; colour blooms into the sketch
//   3.5-4.0  beam widens / overexposes, paper floods white-warm  ->  hard cut to 1895 (white-out -> iris-in)
// Pure function of T.t. All randomness = seeded hashing. Every pencil call gets T.boil (12 fps line boil).
// =============================================================================
import * as P from '../pencil.js';
import { hash, noise1 } from '../rng.js';
import { clamp, lerp, smooth, smoother, outCubic, outBack } from '../ease.js';

const rad = (d) => (d * Math.PI) / 180;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- layout --
const SHEET = { cx: 960, cy: 506, hw: 548, hh: 442, rot: rad(-2.5) };   // big tilted sheet; title is written on its lower part
const AM = { x: 0, y: -98, R: 232 };                                    // Amrita sketch, in SHEET-local coords (x right, y down, 0,0 = sheet centre)
const LAMP = [-90, -120];                                                // beam apex (off-frame, upper-left)
const POOL = { cx: 850, cy: 452, a: 900, b: 740, ang: rad(24) };       // elliptical pool of light (screen space)
const INK = '#37343f', GRAPH = '#5d5967';
const PAL = { vermilion: '#F2542D', amber: '#FFB62E', cream: '#FFF3D6' };

const sheetToScreen = (x, y) => {
  const c = Math.cos(SHEET.rot), s = Math.sin(SHEET.rot);
  return [SHEET.cx + x * c - y * s, SHEET.cy + x * s + y * c];
};
let _sheetPts = null;
function sheetPts() {
  if (_sheetPts) return _sheetPts;
  // paper is never perfectly flat: each edge gets a seeded gentle bow + a lifted corner
  const hw = SHEET.hw, hh = SHEET.hh, pts = [];
  const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  for (let e = 0; e < 4; e++) {
    const a = corners[e], b = corners[(e + 1) % 4];
    const n = 10;
    for (let i = 0; i < n; i++) {
      const u = i / n, bow = Math.sin(u * Math.PI) * (3.2 + 2.4 * hash(e, 7)) * (e % 2 ? -1 : 1) + noise1(u * 4 + e * 9, 31) * 1.4;
      const x = lerp(a[0], b[0], u), y = lerp(a[1], b[1], u);
      const nx = e % 2 === 0 ? 0 : 1, ny = e % 2 === 0 ? 1 : 0;
      pts.push(sheetToScreen(x + nx * bow, y + ny * bow));
    }
  }
  _sheetPts = pts;
  return pts;
}

// ------------------------------------------------------------ small tools --
function partial(pts, u) {
  if (u >= 1) return pts;
  const n = pts.length; if (n < 2 || u <= 0.002) return [];
  const seg = []; let L = 0;
  for (let i = 1; i < n; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; }
  const target = L * u; let acc = 0; const out = [pts[0]];
  for (let i = 0; i < seg.length; i++) {
    if (acc + seg[i] >= target) { const f = (target - acc) / (seg[i] || 1); out.push([lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f)]); break; }
    out.push(pts[i + 1]); acc += seg[i];
  }
  return out;
}
const inkP = (ctx, pts, o) => { if (pts && pts.length > 1) P.ink(ctx, pts, o); };
const lineP = (ctx, pts, o) => { if (pts && pts.length > 1) P.line(ctx, pts, o); };
const pathOf = (ctx, pts, close = true) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (close) ctx.closePath(); };

// Amrita's mark geometry (BRAND.md): 6 pinwheel blades + cream rounded play-triangle (tip right) + two tall oval eyes.
function bladePts(i, R) {
  const a0 = rad(i * 60), ro = R * 0.985, ri = R * 0.62, pts = [];
  for (let k = 0; k <= 12; k++) { const a = a0 + rad(70) * (k / 12); pts.push([Math.cos(a) * ro, Math.sin(a) * ro]); }
  pts.push([Math.cos(a0 + rad(98)) * ri, Math.sin(a0 + rad(98)) * ri]);
  pts.push([Math.cos(a0 + rad(18)) * ri, Math.sin(a0 + rad(18)) * ri]);
  pts.push(pts[0]);
  return pts;
}
function roundTri(R, r) {
  const V = [0, 120, 240].map((d) => [Math.cos(rad(d)) * R * 0.6, Math.sin(rad(d)) * R * 0.6]), out = [];
  for (let i = 0; i < 3; i++) {
    const p0 = V[(i + 2) % 3], p1 = V[i], p2 = V[(i + 1) % 3];
    const d1 = [p0[0] - p1[0], p0[1] - p1[1]], d2 = [p2[0] - p1[0], p2[1] - p1[1]], l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    const a = [p1[0] + (d1[0] / l1) * r * 1.7, p1[1] + (d1[1] / l1) * r * 1.7], b = [p1[0] + (d2[0] / l2) * r * 1.7, p1[1] + (d2[1] / l2) * r * 1.7];
    for (let k = 0; k <= 8; k++) { const t = k / 8, u = 1 - t; out.push([u * u * a[0] + 2 * u * t * p1[0] + t * t * b[0], u * u * a[1] + 2 * u * t * p1[1] + t * t * b[1]]); }
  }
  return out;
}

// ------------------------------------------------------------- lamp level --
// arc-lamp strike at 1.0 (SFX lamp_ignite): hot flash, a few stuttering frames, then steady with a faint hum.
const STRIKE = [1.55, 0.3, 0.95, 0.22, 1.12, 0.62, 1.0, 0.82, 1.0, 0.93, 1.0];
function lampLevel(t) {
  if (t < 1.0) return 0;
  const lt = t - 1.0, f = Math.floor(lt * 30 + 1e-6);
  let L = f < STRIKE.length ? STRIKE[f] : 1;
  if (f >= STRIKE.length) L += 0.012 * Math.sin(t * 190) + 0.01 * (hash(Math.floor(t * 24), 5) - 0.5);
  return L;
}

// ---------------------------------------------------------------- layers ---
function drawGate(ctx, T, S, t) {
  // 0.0-1.4: the dark is not dead — a faint pencil film gate + sprocket glow (projector motor spinning up)
  const fade = t < 1.0 ? 1 : 1 - smooth((t - 1.0) / 0.4);
  if (fade <= 0.001) return;
  const spin = Math.min(1, t / 2.0), speed = 40 + 760 * spin * spin;     // px/s the film runs
  const fl = 0.55 + 0.45 * hash(Math.floor(t * 24), 3);
  const a = 0.17 * fade * fl * (0.4 + 0.6 * smooth(t / 0.6));
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  // gate frame (the aperture of the projector): rounded rect with corner ticks
  P.ink(ctx, P.rectPts(150, 96, 1620, 888, 34), { color: '#cdbf9c', width: 2.4, amp: 1.3, boil: T.boil, seed: 3, alpha: a * 1.2, passes: 2, step: 12 });
  for (const [x, y, dx, dy] of [[150, 96, 1, 1], [1770, 96, -1, 1], [150, 984, 1, -1], [1770, 984, -1, -1]]) {
    P.line(ctx, [[x + dx * 26, y + dy * 26], [x + dx * 70, y + dy * 26]], { color: '#cdbf9c', width: 2, boil: T.boil, seed: 4, alpha: a * 1.4 });
    P.line(ctx, [[x + dx * 26, y + dy * 26], [x + dx * 26, y + dy * 70]], { color: '#cdbf9c', width: 2, boil: T.boil, seed: 5, alpha: a * 1.4 });
  }
  // film-leader cross-hair, very faint
  const cx = 960, cy = 540, rr = 168;
  P.ink(ctx, P.circlePts(cx, cy, rr, 56), { color: '#cdbf9c', width: 2, amp: 1.4, boil: T.boil, seed: 7, alpha: a * 0.8, passes: 2 });
  P.ink(ctx, P.circlePts(cx, cy, rr * 0.55, 40), { color: '#cdbf9c', width: 1.6, amp: 1.1, boil: T.boil, seed: 8, alpha: a * 0.6, passes: 1 });
  P.line(ctx, [[cx - rr * 1.3, cy], [cx + rr * 1.3, cy]], { color: '#cdbf9c', width: 1.6, boil: T.boil, seed: 9, alpha: a * 0.7 });
  P.line(ctx, [[cx, cy - rr * 1.3], [cx, cy + rr * 1.3]], { color: '#cdbf9c', width: 1.6, boil: T.boil, seed: 10, alpha: a * 0.7 });
  // sprockets: two columns of little rounded holes glowing, scrolling up
  const off = (t * speed) % 62;
  ctx.fillStyle = '#e8d9b0';
  for (const x of [72, 1848]) for (let k = -1; k < 19; k++) {
    const y = 20 + k * 62 - off;
    ctx.globalAlpha = a * (0.55 + 0.45 * hash(k + Math.floor(t * speed / 62), x));
    ctx.beginPath(); ctx.roundRect(x - 15, y, 30, 22, 5); ctx.fill();
  }
  ctx.restore();
}

function drawTable(ctx, T) {
  ctx.fillStyle = '#16100d'; ctx.fillRect(-100, -100, 2120, 1280);
  // wood grain: long soft pencil strokes, nearly horizontal
  ctx.save(); ctx.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const y0 = -40 + i * 26 + (hash(i, 1) - 0.5) * 18, len = 500 + hash(i, 2) * 900, x0 = hash(i, 3) * 1920 - 300;
    ctx.strokeStyle = hash(i, 4) < 0.5 ? 'rgba(130,88,56,0.34)' : 'rgba(60,40,28,0.5)';
    ctx.lineWidth = 1.4 + hash(i, 5) * 2.6;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    for (let k = 1; k <= 6; k++) ctx.lineTo(x0 + (len * k) / 6, y0 + noise1(k * 0.7 + i, 11 + T.boil * 0) * 5 + noise1(k * 0.9, T.boil * 13 + i) * 0.9);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSheet(ctx, T, S, t) {
  const pts = sheetPts();
  // soft cast shadow on the table (light from upper-left -> shadow falls lower-right)
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 30 * S.scale; ctx.shadowOffsetX = 20 * S.scale; ctx.shadowOffsetY = 26 * S.scale;
  ctx.fillStyle = '#000'; pathOf(ctx, pts); ctx.fill(); ctx.restore();
  // the sheet: paper texture, flat fill slightly mis-registered from the ink outline
  const pc = P.paperCanvas(Math.round(1920 * S.scale), Math.round(1080 * S.scale), { seed: 14, creases: false });
  ctx.save(); pathOf(ctx, pts); ctx.clip(); ctx.fillStyle = '#FBF4E3'; ctx.fillRect(0, 0, 1920, 1080); ctx.globalAlpha = 0.62; ctx.drawImage(pc, 0, 0, 1920, 1080); ctx.globalAlpha = 1;
  // paper shading: slightly cooler/darker toward the far right/bottom, a soft crease, a lifted corner
  const g = ctx.createLinearGradient(SHEET.cx - 500, SHEET.cy - 440, SHEET.cx + 560, SHEET.cy + 460);
  g.addColorStop(0, 'rgba(255,248,230,0.16)'); g.addColorStop(0.6, 'rgba(120,100,70,0.0)'); g.addColorStop(1, 'rgba(110,90,60,0.22)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1920, 1080);
  ctx.translate(SHEET.cx, SHEET.cy); ctx.rotate(SHEET.rot);
  // faint horizontal fold crease across the lower third (sheet was folded once)
  P.line(ctx, [[-SHEET.hw, 232], [-SHEET.hw * 0.3, 236], [SHEET.hw * 0.4, 229], [SHEET.hw, 233]], { color: '#8d7b5a', width: 2.4, alpha: 0.2, boil: 0, seed: 61, taper: false, amp: 0.8 });
  P.line(ctx, [[-SHEET.hw, 239], [-SHEET.hw * 0.3, 243], [SHEET.hw * 0.4, 236], [SHEET.hw, 240]], { color: '#ffffff', width: 2.2, alpha: 0.35, boil: 0, seed: 62, taper: false, amp: 0.8 });
  ctx.restore();
  // graphite shading: pencil hatch whose density follows the fall-off of the light pool (reads as drawn, not as a gradient)
  P.hatch(ctx, pts, {
    color: '#2a2630', angle: rad(-52), gap: 6.5, width: 1.5, alpha: 0.42, boil: T.boil, seed: 33, margin: 0.45, segLen: 46,
    shade: (x, y) => smooth((poolR(x, y) - 0.5) / 0.42) * (1 - 0.85 * smooth((y - 770) / 40) * smooth((x - 400) / 60) * smooth((1520 - x) / 60)),
  });
  // doubled wobbly ink outline of the sheet (reads as drawn); highlight along upper-left edge, darker lower-right edge
  P.ink(ctx, pts, { color: '#2a2833', width: 3.2, amp: 1.6, boil: T.boil, seed: 21, alpha: 0.9, passes: 2, step: 12 });
}

function drawSketch(ctx, T, S, t) {
  const R = AM.R, boil = T.boil;
  ctx.save(); ctx.translate(SHEET.cx, SHEET.cy); ctx.rotate(SHEET.rot); ctx.translate(AM.x, AM.y);
  // ---- 2.0-2.45 pencil construction: compass circle, spokes, inner circle, cross-hair
  const cu = smooth((t - 2.0) / 0.38);
  if (cu > 0) {
    const ring = P.circlePts(0, 0, R, 72, -rad(100)); ring.push(ring[0]);
    inkP(ctx, partial(ring, cu), { closed: false, color: GRAPH, width: 2.2, amp: 1.5, boil, seed: 101, alpha: 0.55, passes: 2, step: 10 });
    const su = smooth((t - 2.12) / 0.3);
    if (su > 0) {
      for (let i = 0; i < 6; i++) {
        const a = rad(i * 60 + 9), u = clamp(su * 1.25 - i * 0.04);
        inkP(ctx, partial([[0, 0], [Math.cos(a) * R * 1.06, Math.sin(a) * R * 1.06]], u), { closed: false, color: GRAPH, width: 1.5, amp: 0.9, boil, seed: 110 + i, alpha: 0.38, passes: 1, step: 14 });
      }
      const iu = smooth((t - 2.22) / 0.3);
      const inner = P.circlePts(0, 0, R * 0.62, 56, rad(-30)); inner.push(inner[0]);
      inkP(ctx, partial(inner, iu), { closed: false, color: GRAPH, width: 1.6, amp: 1.0, boil, seed: 120, alpha: 0.42, passes: 1, step: 10 });
      lineP(ctx, partial([[-R * 1.14, 0], [R * 1.14, 0]], su), { color: GRAPH, width: 1.2, boil, seed: 121, alpha: 0.3, taper: false });
      lineP(ctx, partial([[0, -R * 1.14], [0, R * 1.14]], su), { color: GRAPH, width: 1.2, boil, seed: 122, alpha: 0.3, taper: false });
    }
  }
  // ---- colour blooms in after the eyes open (flat offset fill + coloured-pencil hatch), outlines ink in
  const bloom = smooth((t - 3.05) / 0.5);
  const tide = 0.55 + 0.45 * smooth((t - 2.9) / 0.3);        // outline darkens as she "comes alive"
  for (let i = 0; i < 6; i++) {
    const bp = bladePts(i, R), col = i % 2 ? PAL.amber : PAL.vermilion;
    const u = smooth((t - (2.22 + 0.075 * i)) / 0.34);
    if (u <= 0) continue;
    if (bloom > 0.01) {
      const body = bp.slice(0, -1);
      P.fill(ctx, body, { color: col, offset: [R * 0.02, R * 0.014], boil, seed: 140 + i, alpha: 0.9 * bloom, comp: 'multiply', amp: 1.4 });
      P.hatch(ctx, body, { color: P.darken(col, 0.3), gap: R * 0.05, width: 1.3, alpha: 0.5 * bloom, angle: rad(i * 60 + 35), boil, seed: 150 + i });
    }
    inkP(ctx, partial(bp, u), { closed: false, color: INK, width: 3.1, amp: 1.5, boil, seed: 130 + i, alpha: 0.82 * tide, passes: 2, step: 10 });
  }
  // ---- 2.7-3.0 the play-triangle traces on, then its cream plate
  const tri = roundTri(R, R * 0.14), tc = tri.slice(); tc.push(tri[0]);
  const tu = smooth((t - 2.68) / 0.34);
  if (tu > 0) {
    if (bloom > 0.01) P.fill(ctx, tri, { color: '#FFE9B8', offset: [R * 0.015, R * 0.01], boil, seed: 160, alpha: 0.85 * bloom, comp: 'multiply', amp: 1.2 });
    inkP(ctx, partial(tc, tu), { closed: false, color: INK, width: 3.0, amp: 1.3, boil, seed: 161, alpha: 0.85 * tide, passes: 2, step: 10 });
  }
  ctx.restore();
}

// eyes: opening state machine (pure function of t)
function eyeState(t) {
  // 3.00-3.16 pop open (slit -> wide, overshoot) | 3.34-3.46 blink | 3.50-3.72 look up toward the light, wonder
  let open = 0;
  if (t >= 3.0) open = lerp(0.05, 1.0, outBack(clamp((t - 3.0) / 0.16), 2.2));
  if (t >= 3.34) { const b = clamp((t - 3.34) / 0.12); open *= 1 - Math.sin(b * Math.PI) * 0.94; }
  const wonder = smooth((t - 3.1) / 0.3);
  const look = smooth((t - 3.5) / 0.22);
  return { open, wonder, lookX: 0.35 * look, lookY: -1.0 * look + 0.1 * (1 - look) };
}
function drawEyes(ctx, T, S, t, A = 1) {
  if (t < 3.0 || A <= 0.002) return;
  const st = eyeState(t), R = AM.R, boil = T.boil;
  ctx.save(); ctx.translate(SHEET.cx, SHEET.cy); ctx.rotate(SHEET.rot); ctx.translate(AM.x, AM.y);
  const fx = 0, W = 1 + 0.2 * st.wonder;
  const ew = R * 0.094 * W, eh = R * 0.134 * W * Math.max(0.06, st.open);
  for (const idx of [0, 1]) {
    const ex = -R * 0.08 + fx + st.lookX * R * 0.035, ey = (idx ? -1 : 1) * R * (0.18 + 0.012 * st.wonder) + st.lookY * R * 0.035;
    const e = P.ellipsePts(ex, ey, ew, eh, 0, 28);
    // glossy black oval
    ctx.save(); ctx.globalAlpha = A; pathOf(ctx, e); ctx.fillStyle = '#0E0D12'; ctx.fill(); ctx.restore();
    P.ink(ctx, e, { color: '#0E0D12', width: 2.6, amp: 0.7, boil, seed: 170 + idx, passes: 1, alpha: A, step: 8 });
    if (st.open > 0.25) {
      ctx.save(); ctx.globalAlpha = A; pathOf(ctx, e); ctx.clip();
      // big window highlight (upper-left, where the lamp is), small kicker lower-right, thin rim light
      ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.beginPath(); ctx.ellipse(ex - ew * 0.34, ey - eh * 0.42, ew * 0.34, eh * 0.2, -0.35, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(190,215,255,0.65)'; ctx.beginPath(); ctx.arc(ex + ew * 0.38, ey + eh * 0.5, Math.max(1.5, ew * 0.13), 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,236,200,0.28)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(ex, ey, ew * 0.86, eh * 0.9, 0, rad(40), rad(140)); ctx.stroke();
      ctx.restore();
    }
  }
  // 3.0-3.35: "ding!" — a starburst of pencil ticks pops out around the disc as the glass opens
  const sp = clamp((t - 3.0) / 0.36);
  if (sp > 0 && sp < 1 && A > 0.9) {
    ctx.save(); ctx.strokeStyle = INK; ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + (hash(i, 40) - 0.5) * 0.18, e = outCubic(sp);
      const r0 = R * (1.1 + 0.2 * e), r1 = r0 + R * (0.1 + 0.2 * hash(i, 41)) * (1 - sp * 0.55);
      const j = noise1(i * 1.7, T.boil * 7) * 2;
      ctx.globalAlpha = (1 - sp * sp) * 0.9; ctx.lineWidth = 3.4 - sp * 1.6;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0 + j, Math.sin(a) * r0 + j); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

// -------------------------------------------------------- light & beam -----
function beamGeom(t) {
  // widening 3.45-4.0: half-angle 24 deg -> 62 deg
  const w = smooth((t - 3.45) / 0.55);
  const half = rad(lerp(24, 64, w));
  const C = [POOL.cx, POOL.cy], d = [C[0] - LAMP[0], C[1] - LAMP[1]], len = Math.hypot(d[0], d[1]), ang = Math.atan2(d[1], d[0]);
  return { half, ang, len, w };
}
function poolR(x, y) {
  const dx = x - POOL.cx, dy = y - POOL.cy, c = Math.cos(POOL.ang), sn = Math.sin(POOL.ang);
  return Math.hypot((dx * c + dy * sn) / POOL.a, (-dx * sn + dy * c) / POOL.b);
}
function drawDarkness(ctx, T, L, t) {
  // the "pool of light": everything outside it falls into darkness. 1 - lit(r) with the lamp level L
  const flood = smooth((t - 3.45) / 0.5), k = 1 + 1.9 * flood;
  const stops = [[0, 0.0], [0.3, 0.015], [0.5, 0.12], [0.7, 0.42], [0.88, 0.82], [1, 0.96]];
  ctx.save(); ctx.translate(POOL.cx, POOL.cy); ctx.rotate(POOL.ang); ctx.scale(1, POOL.b / POOL.a);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, POOL.a * k);
  const lv = clamp(L, 0, 1);
  for (const [s, b] of stops) g.addColorStop(s, `rgba(4,3,8,${lerp(0.985, b * (1 - flood), lv).toFixed(3)})`);
  ctx.fillStyle = g; ctx.fillRect(-5000, -5000, 10000, 10000); ctx.restore();
}
function drawBeam(ctx, T, S, t, L) {
  if (L <= 0.01) return;
  const B = beamGeom(t), [ax, ay] = LAMP, half = B.half;
  const far = B.len * 1.5, tip = (a) => [ax + Math.cos(a) * far, ay + Math.sin(a) * far];
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const lv = L, haze = 0.26 + 0.1 * B.w;
  // volumetric haze: thin angular slices with a bell profile -> soft edges, brightest near the lamp
  {
    const g = ctx.createLinearGradient(ax, ay, ax + Math.cos(B.ang) * far, ay + Math.sin(B.ang) * far);
    g.addColorStop(0, 'rgba(255,214,140,1)'); g.addColorStop(0.45, 'rgba(255,205,130,0.5)'); g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g;
    const NS = 28;
    for (let i = 0; i < NS; i++) {
      const u0 = i / NS, u1 = (i + 1) / NS, um = (u0 + u1) / 2, bell = Math.pow(Math.cos((um * 2 - 1) * Math.PI * 0.5), 0.8);
      const p1 = tip(B.ang + (u0 * 2 - 1) * half), p2 = tip(B.ang + (u1 * 2 - 1) * half);
      ctx.globalAlpha = clamp(haze * 1.5 * lv * bell, 0, 1);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // hatched rays: pencil strokes fanning from the lamp, seeded lengths, re-jittered at 12 fps
  ctx.lineCap = 'round';
  const NR = 54;
  for (let i = 0; i < NR; i++) {
    const u = (i + 0.5) / NR, a = B.ang + (u * 2 - 1) * half * 0.97 + (hash(i, 51) - 0.5) * 0.012;
    const s0 = B.len * (0.1 + 0.25 * hash(i, 52)), s1 = B.len * (0.42 + 0.5 * hash(i, 53) * (0.5 + 0.5 * (1 - Math.abs(u * 2 - 1))));
    const cs = Math.cos(a), sn = Math.sin(a), j = noise1(i * 0.7, 81 + T.boil * 5) * 1.6, j2 = noise1(i * 0.7 + 3, 82 + T.boil * 5) * 2;
    const edge = 1 - Math.abs(u * 2 - 1) * 0.55;
    ctx.strokeStyle = `rgba(255,224,160,${(0.34 * edge * lv * (0.45 + 0.55 * hash(i, 54))).toFixed(3)})`;
    ctx.lineWidth = 1.4 + 1.9 * hash(i, 55);
    ctx.beginPath(); ctx.moveTo(ax + cs * s0 - sn * j, ay + sn * s0 + cs * j);
    ctx.quadraticCurveTo(ax + cs * (s0 + s1) / 2 + sn * j2, ay + sn * (s0 + s1) / 2 - cs * j2, ax + cs * s1 + sn * j, ay + sn * s1 - cs * j); ctx.stroke();
  }
  // hot spot: the beam is brightest where it first meets the paper (overexposed upper-left of the sheet)
  {
    const hx = ax + Math.cos(B.ang) * B.len * 0.52, hy = ay + Math.sin(B.ang) * B.len * 0.52, hr = 520 + 500 * B.w;
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
    g.addColorStop(0, `rgba(255,226,170,${(0.30 * Math.min(1.3, L)).toFixed(3)})`); g.addColorStop(1, 'rgba(255,210,140,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, hr, 0, TAU); ctx.fill();
  }
  // the lamp itself: hot bloom in the corner (flares on the strike)
  const flare = clamp(L - 0.8, 0, 1) * 0.9 + 0.35;
  for (const [r, a] of [[620, 0.28], [330, 0.34], [150, 0.55]]) {
    const g = ctx.createRadialGradient(ax + 70, ay + 90, 0, ax + 70, ay + 90, r);
    g.addColorStop(0, `rgba(255,236,190,${(a * flare * Math.min(1.3, L)).toFixed(3)})`); g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ax + 70, ay + 90, r, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
function drawMotes(ctx, T, t, L) {
  if (L <= 0.05) return;
  const B = beamGeom(t), [ax, ay] = LAMP;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const N = 120, tt = t - 1.0;
  for (let i = 0; i < N; i++) {
    const s = 0.1 + 0.8 * Math.pow(hash(i, 61), 1.35), lat = (hash(i, 62) * 2 - 1) * 0.92;
    // slow drift: along the beam + lateral + gentle buoyancy; wraps within the cone
    const drift = tt * (0.012 + 0.02 * hash(i, 63)), s2 = 0.1 + ((s - 0.1 + drift) % 0.95 + 0.95) % 0.95;
    const d = s2 * B.len * 1.15, a = B.ang + lat * B.half * (0.9);
    const x = ax + Math.cos(a) * d + noise1(t * 0.5 + i, 71) * 14, y = ay + Math.sin(a) * d - tt * 3 * hash(i, 64) + noise1(t * 0.45 + i * 1.3, 72) * 12;
    const size = 1.1 + 1.9 * Math.pow(hash(i, 65), 2) * (0.4 + 0.6 * s2);
    const tw = 0.45 + 0.55 * Math.sin(t * (1.1 + 2 * hash(i, 66)) + hash(i, 67) * 6.28) ** 2;
    const vis = smooth((t - 1.05 - hash(i, 68) * 0.5) / 0.4) * Math.min(1, L);
    ctx.globalAlpha = clamp(0.85 * tw * vis * (0.4 + 0.6 * (1 - Math.abs(lat) * 0.6)), 0, 1);
    ctx.fillStyle = '#fff1cf';
    const jx = noise1(i, T.boil * 9) * 0.7, jy = noise1(i + 40, T.boil * 9) * 0.7;
    ctx.beginPath(); ctx.arc(x + jx, y + jy, size, 0, TAU); ctx.fill();
    // faint pencil ring so the speck still reads where it floats over the (already bright) paper
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.strokeStyle = 'rgba(70,60,50,0.55)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(x + jx, y + jy, size + 0.9, 0, TAU * (0.55 + 0.4 * hash(i, 69))); ctx.stroke(); ctx.restore();
    if (size > 1.7) { ctx.globalAlpha *= 0.3; ctx.beginPath(); ctx.arc(x + jx, y + jy, size * 2.4, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- scene ----
export default {
  id: 'coldopen', kind: '2d',
  // the white-out is part exposure: lift the projector vignette + exposure as the light floods (3.5-4.0)
  grade: (T) => { const wo = smooth((T.t - 3.5) / 0.46); return wo > 0 ? { bright: 1 + 0.4 * wo, vignette: 0.55 * (1 - 0.9 * wo), contrast: 1.05 - 0.08 * wo } : null; },
  draw(ctx, T, S) {
    const t = T.t, L = lampLevel(t);
    ctx.fillStyle = '#050408'; ctx.fillRect(0, 0, 1920, 1080);
    // filament pre-glow in the corner (0.7-1.0): the lamp is heating
    const pre = smooth((t - 0.55) / 0.45) * (t < 1 ? 1 : 0);
    // ---- world (slow 3 % push-in)
    const zoom = 1 + 0.03 * clamp(t / 4.0);
    ctx.save(); ctx.translate(960, 540); ctx.scale(zoom, zoom); ctx.translate(-960, -540);
    if (L > 0.005) {
      drawTable(ctx, T);
      drawSheet(ctx, T, S, t);
      drawSketch(ctx, T, S, t);
      if (t < 3.5) drawEyes(ctx, T, S, t);
    }
    drawDarkness(ctx, T, L, t);
    if (L > 0.01) { // warm lift on the lit paper so the pool glows rather than greys
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(POOL.cx - 120, POOL.cy - 60, 0, POOL.cx - 120, POOL.cy - 60, 720);
      g.addColorStop(0, `rgba(255,236,196,${(0.22 * Math.min(1.3, L)).toFixed(3)})`); g.addColorStop(1, 'rgba(255,220,170,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 1920, 1080); ctx.restore();
    }
    drawBeam(ctx, T, S, t, L);
    drawMotes(ctx, T, t, L);
    ctx.restore();
    if (pre > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const fl = 0.7 + 0.3 * hash(Math.floor(t * 24), 9), g = ctx.createRadialGradient(40, 30, 0, 40, 30, 330);
      g.addColorStop(0, `rgba(255,120,40,${(0.30 * pre * fl).toFixed(3)})`); g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 700, 600); ctx.restore();
    }
    drawGate(ctx, T, S, t);
    // ---- 3.5-4.0 overexposure: the paper floods white-warm (hard cut to 1895 on 4.0)
    const wo = smooth((t - 3.5) / 0.46);
    if (wo > 0.001) {
      ctx.save();
      const g = ctx.createRadialGradient(780, 380, 0, 780, 380, 1500);
      g.addColorStop(0, `rgba(255,250,236,${(wo * 1.0).toFixed(3)})`); g.addColorStop(0.6, `rgba(255,243,215,${(wo * 0.97).toFixed(3)})`); g.addColorStop(1, `rgba(255,236,200,${(Math.pow(wo, 1.4) * 0.96).toFixed(3)})`);
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = g; ctx.fillRect(0, 0, 1920, 1080);
      ctx.restore();
      // her eyes are the last thing to go: two black ovals on a sea of white, looking up at the light
      ctx.save(); ctx.translate(960, 540); ctx.scale(zoom, zoom); ctx.translate(-960, -540);
      drawEyes(ctx, T, S, t, 1 - smooth((t - 3.8) / 0.17));
      ctx.restore();
    }
  },
};
