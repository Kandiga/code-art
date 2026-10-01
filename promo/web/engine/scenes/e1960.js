// =============================================================================
// e1960 — THE WIDESCREEN EPIC (12.0-14.0, 2.20:1, warm 70 mm, prop: viewfinder, portal LENS @ (1100,400) r=130)
//   A vast DESERT EPIC, backlit: a colossal SUN DISC (layered, concentric halo rings, lens-flare rays, anamorphic streak) low on the
//   horizon; layered dune ridges with rim-lit crests, long violet shadows and warm contour hatching; heat shimmer on the far ridge;
//   a CARAVAN of tiny silhouettes (pack animals + figures + a rider) crossing the far ridge; a ruined temple on the horizon; birds.
//   Amrita stands on the foreground dune in near-silhouette (warm rim light on the sun side) and FRAMES the epic with her viewfinder.
//   12.00-12.28  the viewfinder floats up from her side and snaps around the sun; 12.25 click + corner glints (extra cue viewfinder_on)
//   12.50  HORN (horn_distant): the lead rider raises a horn, sound arcs ring out, a red pennant unfurls, dust puffs along the caravan
//   13.00  WIND (wind_desert): sand streaks, spindrift off the crests and dust veils sweep across; the pennant snaps
//   13.4-14.0  the dive: the sun disc (exactly (1100,400) r=130) is the last thing painted — pristine and unoccluded
// Pure function of T.t. All randomness = seeded hashing. Every pencil call gets T.boil (12 fps line boil).
// =============================================================================
import * as P from '../pencil.js';
import { hash, noise1 } from '../rng.js';
import { clamp, lerp, smooth, outCubic, outBack, inOutCubic } from '../ease.js';
import { ERAS } from '../../../shared/cues.js';

const ERA = ERAS[4], SUN = ERA.portal;          // lens @ (1100,400) r=130
const T0 = ERA.t0, TAU = Math.PI * 2;
const HORN_T = 12.5, WIND_T = 13.0, FINDER_T = 12.25;
const INKD = '#3A1432';

// ---------------------------------------------------------------- helpers ------------------------------------------------------------
const LAYERS = new Map();
function layer(S, key, draw) {
  const k = key + '@' + S.scale; let c = LAYERS.get(k); if (c) return c;
  c = S.mk(Math.round(1920 * S.scale), Math.round(1080 * S.scale));
  const g = c.getContext('2d'); g.setTransform(S.scale, 0, 0, S.scale, 0, 0); draw(g);
  LAYERS.set(k, c); if (LAYERS.size > 9) LAYERS.delete(LAYERS.keys().next().value);
  return c;
}
let TMP = null;
const tmpCanvas = (S, w, h) => { if (!TMP || TMP.s !== S.scale) TMP = { s: S.scale, c: S.mk(Math.round(w * S.scale), Math.round(h * S.scale)) }; return TMP.c; };
const poly = (ctx, pts) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); };
function fillGrad(ctx, pts, y0, y1, stops, off = [0, 0]) {
  ctx.save(); ctx.translate(off[0], off[1]); poly(ctx, pts);
  const gr = ctx.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); ctx.fillStyle = gr; ctx.fill(); ctx.restore();
}
const line = (ctx, B, pts, o = {}) => P.ink(ctx, pts, { closed: false, color: o.c ?? INKD, width: o.w ?? 2.6, boil: B, seed: o.seed ?? 1, amp: o.amp ?? 1.2, alpha: o.a ?? 0.9, passes: o.passes ?? 2, step: o.step ?? 10, taper: o.taper ?? false });
const mx = (a, b, t) => P.mix(a, b, t);
function glow(ctx, x, y, r, col, a, comp = 'lighter') {
  ctx.save(); ctx.globalCompositeOperation = comp; const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, P.rgba(col, a)); g.addColorStop(0.4, P.rgba(col, a * 0.4)); g.addColorStop(1, P.rgba(col, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
}
const star4 = (cx, cy, r, ri = 0.26, rot = 0) => { const pts = []; for (let i = 0; i < 8; i++) { const a = rot + (i * Math.PI) / 4 - Math.PI / 2, rr = i % 2 ? r * ri : r; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } return pts; };
// cheap pencil hatch: long, slightly tilted strokes (wobble boils at 12 fps). shade(x,y) -> 0..1 density
function softLines(ctx, B, o) {
  const { x0, x1, y0, y1, gap = 14, seg = 120, col = '#000', alpha = 0.3, width = 1.4, angle = 0, seed = 1, shade = null } = o;
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = width; ctx.lineCap = 'round';
  const ta = Math.tan(angle); let row = 0;
  for (let y = y0; y < y1; y += gap, row++) {
    let x = x0 - hash(row, seed, 1) * seg;
    while (x < x1) {
      const len = seg * (0.45 + hash(row, Math.floor(x / 40), seed + 2) * 0.9), d = shade ? shade(x + len / 2, y) : 1;
      if (hash(row, Math.floor(x / 40), seed + 3) < d) {
        const j = noise1(row * 0.7 + x * 0.01, seed + B * 5) * 1.2;
        ctx.globalAlpha = alpha * (0.55 + 0.45 * hash(row, Math.floor(x / 40), seed + 4));
        ctx.beginPath(); ctx.moveTo(x, y + j); ctx.quadraticCurveTo(x + len / 2, y + len * ta * 0.5 + j * 1.6, x + len, y + len * ta + j); ctx.stroke();
      }
      x += len + gap * (0.4 + hash(row, Math.floor(x / 40), seed + 5) * 1.4);
    }
  }
  ctx.restore();
}
// contour hatching: copies of the crest line shifted down, drawn as broken wavy strokes (follows the dune form)
function contours(ctx, B, crest, o) {
  const { n = 8, step = 14, col = '#000', alpha = 0.3, width = 1.5, seed = 1, grow = 1.12, x0 = -50, x1 = 1970, fade = 1 } = o;
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = width; ctx.lineCap = 'round';
  for (let k = 1; k <= n; k++) {
    const dy = step * (k + (grow - 1) * k * k * 0.12);
    let i = Math.floor(hash(k, seed, 1) * 6);
    while (i < crest.length - 2) {
      const L = 4 + Math.floor(hash(k, i, seed + 2) * 9), j1 = Math.min(crest.length - 1, i + L);
      if (crest[i][0] >= x0 && crest[j1][0] <= x1 && hash(k, i, seed + 3) < 0.78) {
        ctx.globalAlpha = alpha * (0.5 + 0.5 * hash(k, i, seed + 4)) * (1 - (k / (n + 1)) * 0.55 * fade);
        ctx.beginPath();
        for (let q = i; q <= j1; q++) { const w = noise1(q * 0.3 + k * 1.7, seed + B * 5) * 1.0; if (q === i) ctx.moveTo(crest[q][0], crest[q][1] + dy + w); else ctx.lineTo(crest[q][0], crest[q][1] + dy + w); }
        ctx.stroke();
      }
      i = j1 + 1 + Math.floor(hash(k, i, seed + 5) * 4);
    }
  }
  ctx.restore();
}
const ridge = (ctrl, bottom = 1130) => { const crest = P.smoothPts(ctrl, { n: 10 }); return { crest, poly: crest.concat([[crest[crest.length - 1][0], bottom], [crest[0][0], bottom]]) }; };
const crestAt = (h, x) => { const c = h.crest; for (let i = 1; i < c.length; i++) if (c[i][0] >= x) { const a = c[i - 1], b = c[i]; return a[1] + (b[1] - a[1]) * ((x - a[0]) / Math.max(1e-6, b[0] - a[0])); } return c[c.length - 1][1]; };
const sub = (h, xa, xb) => h.crest.filter((p) => p[0] >= xa && p[0] <= xb);

// ---------------------------------------------------------------- geometry ------------------------------------------------------------
const HORIZON = 548;
const L1 = ridge([[-80, 552], [200, 546], [420, 551], [700, 545], [950, 553], [1250, 549], [1500, 554], [1760, 548], [2000, 552]]);
const L2 = ridge([[-80, 630], [100, 622], [260, 610], [420, 617], [600, 600], [780, 607], [960, 615], [1140, 627], [1320, 619], [1500, 606], [1700, 617], [1860, 605], [2000, 613]]);
const L3 = ridge([[-80, 718], [120, 676], [300, 652], [520, 702], [700, 664], [880, 714], [1060, 692], [1240, 660], [1420, 642], [1600, 698], [1800, 668], [2000, 708]]);
const L4 = ridge([[-80, 812], [140, 772], [330, 806], [540, 778], [760, 814], [960, 760], [1160, 774], [1360, 748], [1560, 798], [1760, 770], [2000, 808]]);
const L5 = ridge([[-80, 886], [120, 858], [330, 834], [478, 826], [640, 846], [820, 886], [1020, 930], [1200, 966], [1420, 990], [2000, 1000]]);
const AM = { x: 478, ground: crestAt(L5, 478), R: 120 };       // Amrita's spot on the foreground dune top

// ---------------------------------------------------------------- the sky (static layer) ----------------------------------------------------------
function drawSky(ctx, B) {
  const gr = ctx.createLinearGradient(0, 0, 0, HORIZON + 6);
  [[0, '#2A2072'], [0.22, '#4A2A86'], [0.42, '#9A3A88'], [0.62, '#E04C7E'], [0.80, '#FF8442'], [0.93, '#FFC45E'], [1, '#FFDF8A']].forEach(([o, c]) => gr.addColorStop(o, c));
  ctx.fillStyle = gr; ctx.fillRect(-10, -10, 1940, HORIZON + 30);
  // sun glow: wide warm bloom behind everything
  glow(ctx, SUN.cx, SUN.cy, 760, '#FFE9B0', 0.80, 'source-over');
  glow(ctx, SUN.cx, SUN.cy + 40, 460, '#FFF6D8', 0.55, 'source-over');
  // pencil hatching in the sky (cool above, warm near the sun)
  softLines(ctx, B, { x0: -40, x1: 1960, y0: 90, y1: 330, gap: 13, seg: 150, col: '#1E1550', alpha: 0.30, width: 1.7, angle: -0.03, seed: 5, shade: (x, y) => clamp(1.1 - (y - 90) / 240, 0, 1) });
  softLines(ctx, B, { x0: -40, x1: 1960, y0: 250, y1: 540, gap: 15, seg: 140, col: '#C0306A', alpha: 0.22, width: 1.6, angle: -0.02, seed: 9, shade: (x, y) => clamp(Math.hypot((x - SUN.cx) / 900, (y - SUN.cy) / 260) * 0.9 + 0.12, 0, 0.8) });
  softLines(ctx, B, { x0: -40, x1: 1960, y0: 400, y1: 546, gap: 11, seg: 200, col: '#FFF1C8', alpha: 0.30, width: 1.4, angle: 0.0, seed: 14, shade: (x, y) => clamp(1 - Math.abs(x - SUN.cx) / 1100, 0, 1) * clamp((y - 400) / 140, 0, 1) });
  // a few stars in the cold top of the sky
  for (let i = 0; i < 16; i++) {
    const x = 60 + hash(i, 2, 1) * 1800, y = 110 + hash(i, 2, 2) * 130; if (Math.hypot(x - SUN.cx, y - SUN.cy) < 420) continue;
    ctx.fillStyle = `rgba(255,240,220,${0.5 + 0.4 * hash(i, 2, 3)})`; ctx.beginPath(); ctx.arc(x, y, 1.4 + hash(i, 2, 4) * 1.6, 0, TAU); ctx.fill();
  }
}

// ---------------------------------------------------------------- distant landmarks ---------------------------------------------------------------
function drawTemple(ctx, B, x0, base) {
  const col = '#7A3A78', rim = '#FFC986', Wc = 12, Hc = 58, gap = 42, n = 6;
  const sil = (pts, seed) => { P.fill(ctx, pts, { color: col, comp: 'source-over', offset: [0, 0], boil: B, amp: 0.5, seed }); };
  // stylobate steps
  [[0, 12, 292], [10, 8, 272], [22, 7, 248]].forEach(([dx, h, w], i) => { sil([[x0 + dx, base - i * 7], [x0 + dx + w, base - i * 7], [x0 + dx + w, base - i * 7 - h], [x0 + dx, base - i * 7 - h]], 10 + i); });
  const by = base - 22;
  for (let i = 0; i < n; i++) {
    const cx = x0 + 26 + i * gap, broken = i === 0 || i === 3, h = broken ? Hc * (i === 0 ? 0.45 : 0.72) : Hc;
    sil([[cx - Wc / 2, by], [cx - Wc / 2 + 1, by - h], [cx + Wc / 2 - 1, by - h], [cx + Wc / 2, by]], 20 + i);
    sil([[cx - Wc / 2 - 3, by - h], [cx + Wc / 2 + 3, by - h], [cx + Wc / 2 + 1, by - h - 5], [cx - Wc / 2 - 1, by - h - 5]], 30 + i);       // capital
    ctx.fillStyle = rim; ctx.globalAlpha = 0.8; ctx.fillRect(cx - Wc / 2, by - h, 2, h); ctx.globalAlpha = 1;                                   // rim light on the sun side
  }
  // lintel (one slab fallen away on the left) + broken pediment
  sil([[x0 + 74, by - Hc - 5], [x0 + 26 + 5 * gap + 10, by - Hc - 5], [x0 + 26 + 5 * gap + 10, by - Hc - 15], [x0 + 74, by - Hc - 15]], 40);
  sil([[x0 + 130, by - Hc - 15], [x0 + 236, by - Hc - 15], [x0 + 205, by - Hc - 40], [x0 + 150, by - Hc - 30]], 41);
  // fallen column drums + a leaning column
  sil([[x0 - 16, base - 2], [x0 - 4, base - 3], [x0 + 2, base - 12], [x0 - 18, base - 9]], 42);
  sil([[x0 + 300, base], [x0 + 316, base - 2], [x0 + 330, base - 30], [x0 + 320, base - 31]], 43);
  // obelisk
  sil([[x0 + 360, base], [x0 + 370, base], [x0 + 368, base - 58], [x0 + 365, base - 66], [x0 + 362, base - 58]], 44);
}
function drawMesas(ctx, B) {
  const col = '#9B4C86';
  [[130, 90, 36], [250, 58, 24], [1020, 70, 18]].forEach(([x, w, h], i) => {
    const y = 552, pts = [[x, y], [x + 6, y - h], [x + w - 8, y - h - 2], [x + w, y]];
    P.fill(ctx, pts, { color: col, comp: 'source-over', offset: [0, 0], boil: B, amp: 0.5, seed: 60 + i });
    ctx.fillStyle = '#FFC986'; ctx.globalAlpha = 0.5; ctx.fillRect(x + w - 10, y - h, 3, h); ctx.globalAlpha = 1;
  });
}

// ---------------------------------------------------------------- the dunes ------------------------------------------------------------------
function rimLine(ctx, B, crest, col, w, a, seed) { line(ctx, B, crest.map(([x, y]) => [x, y - 2]), { c: col, w, a, seed, amp: 1.0, passes: 1, step: 10 }); }
// shadow side of every dune = the flank facing away from the sun (the sun is behind the scene: crests are rim-lit, flanks are violet)
function peaksOf(h) {
  const c = h.crest, out = [];
  for (let i = 24; i < c.length - 24; i++) { let ok = true; for (let d = -24; d <= 24; d += 3) if (c[i + d][1] < c[i][1] - 0.01) { ok = false; break; } if (ok && (!out.length || i - out[out.length - 1] > 20)) out.push(i); }
  return out;
}
function shadeDunes(ctx, B, h, o) {
  const c = h.crest, N = c.length;
  peaksOf(h).forEach((ip, n) => {
    const side = c[ip][0] < SUN.cx ? -1 : 1; let len = 12;
    for (let k = 12; k < 46; k++) { const i = ip + side * k; if (i < 1 || i > N - 2) break; len = k; if (c[i][1] > c[i + side][1] + 0.001 && c[i][1] > c[ip][1] + 6) break; }
    const lead = 9, dep = clamp((c[ip + side * len][1] - c[ip][1]) * 1.7, 26, o.depth), top = [], low = [];
    for (let k = -lead; k <= len; k++) {
      const i = clamp(ip + side * k, 0, N - 1), th = k < 0 ? dep * 0.92 * smooth((k + lead) / lead) : dep * Math.pow(1 - smooth(k / len), 0.9);
      top.push(c[i]); low.push([c[i][0], c[i][1] + th + 4]);
    }
    const pts = top.concat(low.reverse());
    ctx.save(); ctx.globalAlpha = o.alpha; fillGrad(ctx, pts, c[ip][1], c[ip][1] + dep, [[0, o.col], [1, mx(o.col, '#150A28', 0.4)]], [2, 1]); ctx.restore();
    contours(ctx, B, top, { n: 6, step: dep / 8, col: '#1E0C30', alpha: 0.40, width: 1.6, seed: o.seed + n, fade: 0.4 });
  });
}
// long cast shadows radiating from the sun (vanishing point) towards the viewer, clipped to the dune they fall on
function castShadows(ctx, B, h, o) {
  const c = h.crest;
  ctx.save(); poly(ctx, h.poly); ctx.clip();
  peaksOf(h).forEach((ip, n) => {
    const [px, py] = c[ip]; let dx = px - SUN.cx, dy = py - SUN.cy; const l = Math.hypot(dx, dy); dx /= l; dy /= l;
    const T = (o.yEnd - py) / Math.max(0.2, dy), nx = -dy, ny = dx, w0 = 8, w1 = o.w + 0.1 * T * 0.0;
    const pts = [[px - nx * w0, py - ny * w0 + 4], [px + nx * w0, py + ny * w0 + 4], [px + dx * T + nx * w1, py + dy * T + ny * w1], [px + dx * T - nx * w1, py + dy * T - ny * w1]];
    const g = ctx.createLinearGradient(px, py, px + dx * T, py + dy * T); g.addColorStop(0, P.rgba(o.col, o.alpha)); g.addColorStop(1, P.rgba(o.col, o.alpha * 0.5));
    ctx.fillStyle = g; poly(ctx, pts); ctx.fill();
  });
  ctx.restore();
}
function drawFar(ctx, B) {
  drawMesas(ctx, B);
  fillGrad(ctx, L1.poly, 540, 640, [[0, '#E8728A'], [1, '#C0507C']], [2, 1]);
  drawTemple(ctx, B, 1500, 551);
  contours(ctx, B, L1.crest, { n: 3, step: 9, col: '#8A3472', alpha: 0.35, width: 1.4, seed: 71 });
  rimLine(ctx, B, L1.crest, '#FFD6A0', 2.4, 0.8, 72);
  line(ctx, B, L1.crest, { c: '#7A2C62', w: 2.2, a: 0.7, seed: 73, amp: 1.0 });
  fillGrad(ctx, L2.poly, 590, 760, [[0, '#DC7488'], [0.5, '#B05482'], [1, '#7A3470']], [3, 2]);
  contours(ctx, B, L2.crest, { n: 7, step: 12, col: '#6A2468', alpha: 0.32, width: 1.5, seed: 74 });
  shadeDunes(ctx, B, L2, { depth: 46, col: '#4A2068', alpha: 0.5, seed: 75 });
  rimLine(ctx, B, L2.crest, '#FFD090', 2.6, 0.85, 77);
  line(ctx, B, L2.crest, { c: '#5A1C52', w: 2.8, a: 0.85, seed: 78 });
}
function drawNear(ctx, B) {
  // L3 golden dunes
  fillGrad(ctx, L3.poly, 640, 860, [[0, '#FFCB68'], [0.45, '#F59644'], [1, '#C45A3E']], [3, 2]);
  contours(ctx, B, L3.crest, { n: 9, step: 14, col: '#A8421F', alpha: 0.44, width: 1.8, seed: 81 });
  softLines(ctx, B, { x0: 0, x1: 1920, y0: 690, y1: 800, gap: 13, seg: 130, col: '#FFEDB0', alpha: 0.26, width: 1.5, angle: -0.04, seed: 82, shade: (x, y) => clamp(1 - (y - 690) / 110, 0, 1) });
  castShadows(ctx, B, L3, { yEnd: 860, w: 64, col: '#5A2A6E', alpha: 0.30 });
  shadeDunes(ctx, B, L3, { depth: 150, col: '#52266C', alpha: 0.66, seed: 83 });
  rimLine(ctx, B, L3.crest, '#FFEEB8', 3.6, 0.95, 86);
  line(ctx, B, L3.crest, { c: '#6A2230', w: 3.2, a: 0.85, seed: 87 });
  // L4 rose-umber dunes
  fillGrad(ctx, L4.poly, 730, 960, [[0, '#EA8644'], [0.4, '#BC5640'], [1, '#6E2C54']], [3, 2]);
  contours(ctx, B, L4.crest, { n: 10, step: 16, col: '#4A1A44', alpha: 0.32, width: 1.7, seed: 91 });
  castShadows(ctx, B, L4, { yEnd: 1000, w: 90, col: '#3A1A5C', alpha: 0.36 });
  shadeDunes(ctx, B, L4, { depth: 190, col: '#3A1A5C', alpha: 0.64, seed: 92 });
  rimLine(ctx, B, L4.crest, '#FFCC80', 3.4, 0.92, 95);
  line(ctx, B, L4.crest, { c: '#43152F', w: 3.4, a: 0.9, seed: 96 });
  // L5 the foreground dune: deep plum with a warm-rim crest
  fillGrad(ctx, L5.poly, 820, 1080, [[0, '#552656'], [0.5, '#34163F'], [1, '#1C0C28']], [3, 2]);
  contours(ctx, B, L5.crest, { n: 8, step: 17, col: '#E48A52', alpha: 0.22, width: 1.7, seed: 101, fade: 0.8 });
  rimLine(ctx, B, L5.crest.filter((p) => p[0] < 1100), '#FFC070', 4.4, 0.95, 102);
  line(ctx, B, L5.crest, { c: '#12061C', w: 3.8, a: 0.92, seed: 103 });
}

// ---------------------------------------------------------------- sun: rays, anamorphic streak, ghosts, disc ----------------------------------------------------
function drawRays(ctx, t) {
  const lt = t - T0, N = 14;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU + 0.05 * lt + hash(i, 6, 1) * 0.25, len = 520 + 700 * hash(i, 6, 2), w = 0.035 + 0.04 * hash(i, 6, 3);
    const x1 = SUN.cx + Math.cos(a - w) * len, y1 = SUN.cy + Math.sin(a - w) * len, x2 = SUN.cx + Math.cos(a + w) * len, y2 = SUN.cy + Math.sin(a + w) * len;
    const g = ctx.createLinearGradient(SUN.cx, SUN.cy, SUN.cx + Math.cos(a) * len, SUN.cy + Math.sin(a) * len);
    g.addColorStop(0, 'rgba(255,236,170,0.34)'); g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(SUN.cx, SUN.cy); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
function drawAnamorphic(ctx, t) {
  const lt = t - T0, pulse = 0.88 + 0.12 * Math.sin(lt * 4.1), wind = smooth((t - WIND_T) / 0.3) * (1 - smooth((t - WIND_T - 0.9) / 0.4));
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  // long horizontal flare, bluish at the tips like a real anamorphic streak
  [[2200, 18, 0.55, '190,225,255'], [1500, 7, 0.9, '255,244,215'], [900, 3.5, 1, '255,255,255']].forEach(([L, th, a, rgb]) => {
    const g = ctx.createLinearGradient(SUN.cx - L / 2, 0, SUN.cx + L / 2, 0);
    g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.5, `rgba(${rgb},${a * pulse * (1 + 0.25 * wind)})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(SUN.cx, SUN.cy, L / 2, th * (1 + 0.3 * wind), 0, 0, TAU); ctx.fill();
  });
  ctx.restore();
}
function drawGhosts(ctx, t) {
  const dx = 960 - SUN.cx, dy = 560 - SUN.cy, lt = t - T0;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  [[1.5, 38, '255,150,90', 0.16], [2.2, 24, '120,200,255', 0.12], [3.0, 58, '255,200,120', 0.10], [3.8, 16, '255,255,255', 0.14]].forEach(([k, r, rgb, a], i) => {
    const x = SUN.cx + dx * k + Math.sin(lt * 0.5 + i) * 3, y = SUN.cy + dy * k;
    const g = ctx.createRadialGradient(x, y, r * 0.55, x, y, r); g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.8, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  });
  ctx.restore();
}
// the disc itself: layered fills, inked rings, rim ticks — fills the portal circle exactly (outer edge at r = 130)
function drawSunDisc(ctx, B, t, withHalo = true) {
  const { cx, cy, r } = SUN, lt = t - T0, pulse = 0.5 + 0.5 * Math.sin(lt * 3.1);
  if (withHalo) {
    // concentric halo rings (pencil circles) + faint bands between them
    [[158, '#FFE08A', 0.60, 5.5], [196, '#FFB45A', 0.46, 4.2], [246, '#FF8E6E', 0.34, 3.4], [312, '#E86A94', 0.24, 2.8], [392, '#C8508E', 0.16, 2.4]].forEach(([rr, c, a, w], i) => {
      const k = rr + 3 * Math.sin(lt * 1.6 + i * 1.3);
      glow(ctx, cx, cy, k + 14, c, 0.0, 'lighter');
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = P.rgba(c, 0.10 + 0.04 * pulse); ctx.lineWidth = 22 - i * 2.5; ctx.beginPath(); ctx.arc(cx, cy, k, 0, TAU); ctx.stroke(); ctx.restore();
      P.ink(ctx, P.circlePts(cx, cy, k, 72), { closed: true, color: c, width: w, boil: B, seed: 300 + i * 7, amp: 2.2, passes: 2, step: 14, alpha: a });
    });
    glow(ctx, cx, cy, 300, '#FFF0C0', 0.5);
  }
  // layered disc
  const rings = [[r, '#E8501E'], [r * 0.90, '#FF8A22'], [r * 0.72, '#FFC63A'], [r * 0.52, '#FFEE90'], [r * 0.30, '#FFFDF2']];
  rings.forEach(([rr, c], i) => {
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(cx, cy, rr - (i === 0 ? 0 : 0), 0, TAU); ctx.fill();
  });
  // radial pencil strokes on the outer rim band
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.arc(cx, cy, r * 0.72, 0, TAU, true); ctx.clip();
  for (let i = 0; i < 54; i++) {
    const a = (i / 54) * TAU + hash(i, B, 7) * 0.05, r0 = r * (0.74 + 0.08 * hash(i, 8, 1)), r1 = r * (0.93 + 0.07 * hash(i, 8, 2));
    ctx.strokeStyle = i % 2 ? 'rgba(160,40,10,0.45)' : 'rgba(255,240,170,0.5)'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
  }
  ctx.restore();
  // inked rings between the layers
  rings.forEach(([rr], i) => P.ink(ctx, P.circlePts(cx, cy, rr - (i === 0 ? 2.5 : 1.5), 72), { closed: true, color: i === 0 ? '#8A1E10' : i < 3 ? '#B84A12' : '#E0A030', width: i === 0 ? 5.5 : 3.2, boil: B, seed: 400 + i * 5, amp: i === 0 ? 0.8 : 1.2, passes: 2, step: 12, alpha: i === 0 ? 0.95 : 0.8 }));
  glow(ctx, cx, cy, r * 0.8, '#FFFFFF', 0.35 + 0.1 * pulse, 'lighter');
}

// ---------------------------------------------------------------- birds ---------------------------------------------------------------------------
function drawBirds(ctx, B, t) {
  const lt = t - T0;
  for (let i = 0; i < 6; i++) {
    const x = 170 + i * 82 + 40 * lt + 12 * Math.sin(lt * 1.3 + i), y = 214 + 24 * Math.sin(i * 2.1) + 7 * Math.sin(lt * 1.9 + i * 1.7) - i * 4, s = 22 + (i % 3) * 6, fl = Math.sin(lt * (9 + i * 0.7) + i * 1.9);
    const w = fl * s * 0.55, pts = [[x - s, y + w * 0.9], [x - s * 0.5, y - s * 0.28 + w * 0.3], [x, y], [x + s * 0.5, y - s * 0.28 + w * 0.3], [x + s, y + w * 0.9]];
    line(ctx, B, pts, { c: '#24102E', w: 3.4, seed: 500 + i, amp: 0.5, passes: 1, step: 8, a: 0.95 });
  }
}

// ---------------------------------------------------------------- the caravan ----------------------------------------------------------------------
const CAR_GAP = 88, CAR_V = 34, CAR_X0 = 606;
const CAR = ['rider', 'pack', 'walk', 'pack', 'pack', 'walk', 'pack', 'pack'];
function silhouette(ctx, B, pts, seed, col = '#2A1230') {
  ctx.save(); ctx.translate(2.2, -1.6); P.fill(ctx, pts, { color: '#FFC27A', comp: 'source-over', offset: [0, 0], boil: B, amp: 0.4, seed: seed + 900, alpha: 0.9 }); ctx.restore();
  P.fill(ctx, pts, { color: col, comp: 'source-over', offset: [0, 0], boil: B, amp: 0.4, seed });
}
function drawUnit(ctx, B, t, i, kind) {
  const lt = t - T0, x = CAR_X0 + CAR_V * lt - i * CAR_GAP, gy = crestAt(L2, x) + 5, ph = lt * 5.2 + i * 1.7, bob = Math.abs(Math.sin(ph)) * 1.6;
  const wind = smooth((t - WIND_T) / 0.3), sc = kind === 'walk' ? 1.05 : 1.3;
  const dust = clamp((t - HORN_T - 0.04 * i) / 1.0);
  ctx.save(); ctx.translate(x, gy - bob); ctx.scale(sc, sc);
  if (kind === 'walk') {
    const sw = Math.sin(ph) * 5;
    silhouette(ctx, B, [[-7, -2], [7, -2], [4, -28], [-4, -28]], 1000 + i);
    silhouette(ctx, B, P.circlePts(0, -34, 5.2, 10), 1020 + i);
    silhouette(ctx, B, [[-5, -38], [5, -38], [6, -32], [-5, -31]], 1040 + i);
    line(ctx, B, [[9, -2], [11 + sw * 0.2, -46]], { c: '#2A1230', w: 2.2, seed: 1060 + i, amp: 0.4, passes: 1, a: 0.95 });
  } else {
    const sw = (k) => Math.sin(ph + k) * 0.34;
    ctx.save(); ctx.strokeStyle = '#2A1230'; ctx.lineCap = 'round'; ctx.lineWidth = 3.6;
    [[-15, 0], [-9, 2.4], [8, 1.2], [14, 3.6]].forEach(([lx, k], li) => { const a = sw(k); ctx.beginPath(); ctx.moveTo(lx, -24); ctx.lineTo(lx + Math.sin(a) * 25, -24 + Math.cos(a) * 24 - 1); ctx.stroke(); });
    ctx.restore();
    silhouette(ctx, B, P.ellipsePts(0, -29, 25, 11, 0, 16), 1100 + i);                                         // body
    silhouette(ctx, B, [[16, -34], [23, -46], [31, -58], [37, -56], [30, -42], [24, -29]], 1120 + i);          // neck
    silhouette(ctx, B, P.ellipsePts(37, -58, 7.5, 3.8, -0.25, 10), 1140 + i);                                  // head
    silhouette(ctx, B, [[-24, -30], [-30, -22], [-27, -18], [-21, -26]], 1150 + i);                           // tail
    if (kind === 'pack') {
      silhouette(ctx, B, P.rectPts(-14, -53, 28, 21, 6, 3), 1160 + i);                                      // bundle
      ctx.save(); ctx.fillStyle = '#C83A4A'; ctx.globalAlpha = 0.85; ctx.fillRect(-14, -42, 28, 4); ctx.restore();
    } else {
      silhouette(ctx, B, [[-9, -39], [9, -39], [6, -58], [-4, -58]], 1170 + i);                                // rider robe
      silhouette(ctx, B, P.circlePts(0, -64, 5.4, 10), 1180 + i);
      silhouette(ctx, B, [[-6, -66], [6, -66], [7, -60], [-6, -59]], 1190 + i);
      // HORN (12.5): brass horn raised to the lips
      const hk = outBack(clamp((t - HORN_T) / 0.18), 1.4);
      if (hk > 0.02) {
        ctx.save(); ctx.translate(5, -64); ctx.scale(hk * 1.35, hk * 1.35);
        P.fill(ctx, [[0, 0], [24, -22], [31, -17], [31, -29], [22, -32], [3, -5]], { color: '#2A1230', comp: 'source-over', offset: [0, 0], boil: B, amp: 0.3, seed: 1200 });
        P.ink(ctx, [[28, -16], [31, -17], [31, -29], [27, -31]], { closed: false, color: '#FFD04A', width: 3, boil: B, seed: 1201, amp: 0.3, passes: 1, step: 8 });
        ctx.restore();
      }
      // PENNANT: unfurls at 12.5, snaps in the wind from 13.0
      const fk = outBack(clamp((t - HORN_T - 0.06) / 0.3), 1.5);
      if (fk > 0.02) {
        const ph2 = t * (9 + 6 * wind), amp = 3 + 4 * wind, px = -9, py0 = -58, ph0 = py0 - 66 * fk, fl = 44 * fk, pts = [[px, ph0]];
        for (let q = 1; q <= 5; q++) { const u = q / 5; pts.push([px + fl * u, ph0 + 4 * u + Math.sin(ph2 - u * 5) * amp * u]); }
        pts.push([px + fl * 0.78, ph0 + 14 + Math.sin(ph2 - 4) * amp * 0.8]); pts.push([px + fl, ph0 + 22 + Math.sin(ph2 - 5) * amp]);
        for (let q = 4; q >= 0; q--) { const u = q / 5; pts.push([px + fl * u, ph0 + 22 * (0.9 + 0.1 * u) + Math.sin(ph2 - u * 5) * amp * u]); }
        line(ctx, B, [[px, py0], [px, ph0 - 4]], { c: '#2A1230', w: 2.4, seed: 1210, amp: 0.3, passes: 1, a: 0.95 });
        P.fill(ctx, pts, { color: '#F2542D', comp: 'source-over', offset: [0, 0], boil: B, amp: 0.3, seed: 1211 });
        P.ink(ctx, pts, { closed: true, color: '#7A1A10', width: 1.6, boil: B, seed: 1212, amp: 0.3, passes: 1, step: 8 });
      }
    }
  }
  // dust puffs at the feet on the horn: soft billows that rise and thin out
  if (dust > 0 && dust < 1) {
    const k = outCubic(dust);
    for (let q = 0; q < 4; q++) {
      const r = (14 + 30 * k) * (0.7 + 0.5 * hash(i, q, 5)), px = (q - 1.5) * 17 + 14 * k * (0.5 + hash(i, q, 6)), py = -4 - 22 * k * (0.5 + 0.4 * q / 3), al = 0.55 * (1 - dust) * (1 - dust * 0.4);
      const g = ctx.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(255,222,170,${al})`); g.addColorStop(0.6, `rgba(250,196,150,${al * 0.6})`); g.addColorStop(1, 'rgba(250,196,150,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}
function drawCaravan(ctx, B, t) {
  CAR.forEach((k, i) => { if (CAR_X0 + CAR_V * (t - T0) - i * CAR_GAP > -60) drawUnit(ctx, B, t, i, k); });
  // horn: sound arcs ringing out from the bell (big, so the beat reads from across the frame)
  const dt = t - HORN_T;
  if (dt > 0 && dt < 1.1) {
    const lx = CAR_X0 + CAR_V * (t - T0), ly = crestAt(L2, lx) - 118;
    for (let i = 0; i < 4; i++) {
      const d = dt - i * 0.13; if (d < 0) continue; const k = d / 0.85; if (k > 1) continue;
      const r = 24 + 190 * outCubic(k), pts = []; for (let q = 0; q <= 12; q++) { const a = -1.05 + 1.5 * (q / 12); pts.push([lx + 52 + Math.cos(a) * r, ly - 16 + Math.sin(a) * r * 0.9]); }
      ctx.save();
      line(ctx, B, pts, { c: '#8A2E6A', w: 6.5 * (1 - k * 0.6), a: 0.78 * (1 - k), seed: 1300 + i, amp: 1.2, passes: 2, taper: true });
      line(ctx, B, pts.map(([x, y]) => [x + 2, y - 2]), { c: '#FFF6D8', w: 3 * (1 - k * 0.6), a: 0.9 * (1 - k), seed: 1320 + i, amp: 1.0, passes: 1, taper: true });
      ctx.restore();
    }
    glow(ctx, lx + 40, ly - 10, 90 * (1 - dt / 1.1), '#FFF2C8', 0.5 * (1 - dt / 1.1));
  }
}

// ---------------------------------------------------------------- wind: sand streaks, spindrift, veils ---------------------------------------------------------
const G = (t) => 1100 * smooth((t - WIND_T) / 0.95);               // displacement of the gust (px at depth 1)
const gustSpeed = (t) => clamp((t - WIND_T) / 0.95, 0, 1) * (1 - clamp((t - WIND_T) / 0.95, 0, 1)) * 4;   // 0..1 bump
function drawStreaks(ctx, t) {
  const lt = t - T0, gs = clamp(gustSpeed(t), 0, 1);
  ctx.save(); ctx.lineCap = 'round';
  for (let i = 0; i < 64; i++) {
    const d = hash(i, 11, 1), depth = Math.pow(d, 0.8), y = lerp(560, 960, depth) + (hash(i, 11, 2) - 0.5) * 22;
    const len = (50 + 150 * depth) * (1 + 1.6 * gs), x0 = hash(i, 11, 3) * (1920 + 500) - 250, vx = 14 + 52 * depth, gain = 0.5 + 0.9 * depth;
    let x = x0 + vx * lt + G(t) * gain; x = ((x % 2420) + 2420) % 2420 - 360;
    const a = (0.22 + 0.26 * depth) * (0.75 + 1.1 * gs + (t > WIND_T ? 0.25 : 0)), th = 1.2 + 2.4 * depth, wob = 3 * depth * Math.sin(lt * 2 + i);
    if (y > 980 || a < 0.02) continue;
    const g = ctx.createLinearGradient(x, 0, x + len, 0); g.addColorStop(0, 'rgba(255,240,200,0)'); g.addColorStop(0.35, `rgba(255,244,214,${a})`); g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.strokeStyle = g; ctx.lineWidth = th; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + len * 0.5, y - 3 - wob, x + len, y + 1.5); ctx.stroke();
  }
  ctx.restore();
}
function drawSpindrift(ctx, t) {
  const lt = t - T0, gs = clamp(gustSpeed(t), 0, 1), base = 0.35 + 0.65 * smooth((t - WIND_T + 0.1) / 0.4);
  [[460, L3], [1450, L3], [1060, L4], [330, L5], [700, L2]].forEach(([x, h], i) => {
    const y = crestAt(h, x), L = (90 + 130 * gs + 40 * Math.sin(lt * 1.3 + i)) * base, a = (0.22 + 0.34 * gs) * base;
    const g = ctx.createLinearGradient(x, 0, x + L, 0); g.addColorStop(0, `rgba(255,232,178,${a})`); g.addColorStop(1, 'rgba(255,232,178,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - 6, y + 1); ctx.quadraticCurveTo(x + L * 0.4, y - 16 - 10 * gs, x + L, y - 7 + Math.sin(lt * 3 + i) * 2); ctx.quadraticCurveTo(x + L * 0.5, y + 4, x - 6, y + 4); ctx.closePath(); ctx.fill();
  });
}
// the GUST (13.0 - 13.95): a soft front sweeps left -> right, throwing long bright streaks and sand grains across the dunes
function drawGust(ctx, t) {
  const u = clamp((t - WIND_T) / 0.95); if (u <= 0.001 || u >= 0.999) return;
  const env = Math.pow(Math.sin(Math.PI * u), 0.75), prog = smooth(u);
  ctx.save(); ctx.lineCap = 'round';
  // the front: a skewed band of warm haze
  const fx = lerp(-380, 2300, prog);
  const gb = ctx.createLinearGradient(fx - 330, 0, fx + 330, 0); gb.addColorStop(0, 'rgba(255,226,170,0)'); gb.addColorStop(0.55, `rgba(255,232,180,${0.30 * env})`); gb.addColorStop(1, 'rgba(255,226,170,0)');
  ctx.fillStyle = gb; ctx.beginPath(); ctx.moveTo(fx - 330 - 160, 560); ctx.lineTo(fx + 330 - 160, 560); ctx.lineTo(fx + 330 + 160, 990); ctx.lineTo(fx - 330 + 160, 990); ctx.closePath(); ctx.fill();
  // streaks
  for (let i = 0; i < 96; i++) {
    const d = hash(i, 21, 1), depth = Math.pow(d, 0.85), y = lerp(566, 972, depth) + (hash(i, 21, 2) - 0.5) * 16;
    const len = 150 + 560 * depth * (0.6 + 0.8 * hash(i, 21, 3)), lag = hash(i, 21, 4) * 0.22, k = smooth(clamp((u - lag) / (1 - lag)));
    const head = lerp(-120, 2300, k) + (hash(i, 21, 5) - 0.5) * 200, a = env * (0.34 + 0.46 * depth) * (0.6 + 0.4 * hash(i, 21, 6)), th = 1.6 + 3.8 * depth;
    const g = ctx.createLinearGradient(head - len, 0, head, 0); g.addColorStop(0, 'rgba(255,244,214,0)'); g.addColorStop(0.7, `rgba(255,246,222,${a})`); g.addColorStop(1, `rgba(255,252,236,${a})`);
    ctx.strokeStyle = g; ctx.lineWidth = th; ctx.beginPath(); ctx.moveTo(head - len, y + 2); ctx.quadraticCurveTo(head - len * 0.5, y - 4 * depth, head, y); ctx.stroke();
  }
  // grains
  ctx.fillStyle = 'rgba(255,240,200,0.85)';
  for (let i = 0; i < 150; i++) {
    const d = hash(i, 22, 1), y = lerp(570, 975, Math.pow(d, 0.9)), k = smooth(clamp((u - hash(i, 22, 2) * 0.2) / 0.8)), x = lerp(-60, 2200, k) - hash(i, 22, 3) * 120;
    const r = 0.9 + 2.2 * d; ctx.globalAlpha = env * (0.4 + 0.5 * hash(i, 22, 4)); ctx.beginPath(); ctx.arc(x, y + Math.sin(t * 20 + i) * 2, r, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
function drawVeils(ctx, t) {
  const gs = clamp(gustSpeed(t), 0, 1); if (gs < 0.02) return;
  ctx.save();
  for (let i = 0; i < 4; i++) {
    const y = 600 + i * 90 + hash(i, 12, 1) * 30, x = ((hash(i, 12, 2) * 2200 + G(t) * (0.8 + 0.3 * i)) % 2600) - 500, w = 700 + 300 * hash(i, 12, 3), h = 46 + 18 * i;
    const g = ctx.createRadialGradient(x, y, 0, x, y, w / 2); g.addColorStop(0, `rgba(255,222,160,${0.30 * gs})`); g.addColorStop(1, 'rgba(255,222,160,0)');
    ctx.fillStyle = g; ctx.save(); ctx.translate(x, y); ctx.scale(1, h / (w / 2)); ctx.translate(-x, -y); ctx.beginPath(); ctx.arc(x, y, w / 2, 0, TAU); ctx.fill(); ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- Amrita: near-silhouette + rim light ---------------------------------------------------------------
function amritaArgs(t) {
  const lt = t - T0;
  const awe = smooth((t - HORN_T) / 0.1) * (1 - smooth((t - HORN_T - 0.55) / 0.3));
  const squint = smooth((t - WIND_T) / 0.2) * (1 - smooth((t - WIND_T - 0.8) / 0.3));
  const pop = t >= HORN_T ? Math.exp(-(t - HORN_T) / 0.16) * Math.cos((t - HORN_T) * 22) : 0;
  const eye = { open: 1, determined: 0.45 * (1 - awe), surprised: 0.85 * awe, squint: 0.55 * squint, lookX: 0.8, lookY: -0.5 };
  const bob = Math.sin(lt * TAU * 0.62) * 0.025 * AM.R, R = AM.R;
  const sq = 0.015 * Math.sin(lt * TAU * 0.62 + 1.6) + 0.1 * pop;
  const gust = Math.sin(t * 17) * 1.2 * squint;
  return { x: AM.x + gust, y: AM.ground - R * 1.1 * (1 + sq) - bob, size: R, yaw: 0.42, roll: -0.03 + 0.012 * Math.sin(lt * 1.7), squash: sq, eye, groundY: AM.ground, seed: 21, shadow: false, prop: null };
}
function drawAmrita(ctx, T, S) {
  const t = T.t, o = amritaArgs(t), R = o.size, cx = o.x, cy = o.y, c = tmpCanvas(S, 600, 600), g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
  g.setTransform(S.scale, 0, 0, S.scale, (300 - cx) * S.scale, (300 - cy) * S.scale);
  S.amrita2d.drawAmrita(g, T, S, o);
  g.setTransform(S.scale, 0, 0, S.scale, (300 - cx) * S.scale, (300 - cy) * S.scale);
  // near-silhouette: cool plum overlay, strongest on the shadow side (away from the sun), warm sun-lit on the sun side
  g.globalCompositeOperation = 'source-atop';
  const dir = [0.78, -0.62], gr = g.createLinearGradient(cx - dir[0] * R, cy - dir[1] * R, cx + dir[0] * R, cy + dir[1] * R);
  gr.addColorStop(0, 'rgba(30,10,46,0.74)'); gr.addColorStop(0.55, 'rgba(60,22,64,0.46)'); gr.addColorStop(1, 'rgba(150,64,48,0.16)');
  g.fillStyle = gr; g.fillRect(cx - R * 3, cy - R * 3, R * 6, R * 6);
  // bright rim of the blades on the sun side
  g.lineCap = 'round';
  const a0 = Math.atan2(dir[1], dir[0]);
  [[R * 0.96, 7, 'rgba(255,214,128,0.95)'], [R * 0.9, 3.4, 'rgba(255,248,214,0.95)']].forEach(([rr, w, col]) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.ellipse(cx, cy, rr * 0.92, rr * (1 + o.squash), 0, a0 - 1.0, a0 + 0.95); g.stroke(); });
  // sun-lit cheek on the face plate
  const fx = cx + R * 0.18, fy = cy - R * 0.02, gl = g.createRadialGradient(fx + R * 0.2, fy - R * 0.12, 0, fx + R * 0.2, fy - R * 0.12, R * 0.55);
  gl.addColorStop(0, 'rgba(255,190,100,0.55)'); gl.addColorStop(1, 'rgba(255,190,100,0)'); g.fillStyle = gl; g.fillRect(cx - R, cy - R, R * 2, R * 2);
  g.globalCompositeOperation = 'source-over';
  // outside glow on the sun side, then the figure
  glow(ctx, cx + R * 0.7, cy - R * 0.5, R * 1.6, '#FFB060', 0.28);
  ctx.drawImage(c, cx - 300, cy - 300, 600, 600);
  // contact shadow on the dune (long, cool, away from the sun)
  ctx.save(); ctx.translate(AM.x - 30, AM.ground + 6); ctx.scale(1, 0.16); const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.4); sg.addColorStop(0, 'rgba(10,2,22,0.6)'); sg.addColorStop(1, 'rgba(10,2,22,0)'); ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, R * 1.4, 0, TAU); ctx.fill(); ctx.restore();
  return o;
}

// ---------------------------------------------------------------- the viewfinder: floats up from her side, frames the epic ---------------------------------------------
const FINDER = { cx: 1112, cy: 428, size: 466 };
function drawFinder(ctx, T, S, am) {
  const t = T.t, lt = t - T0;
  const k = outCubic(clamp((t - T0) / 0.25)), e = t < T0 ? 0 : k;
  const sx = am.x + am.size * 1.95, sy = am.y - am.size * 0.12, s0 = am.size * 0.95;
  const bob = Math.sin(lt * 2.3) * 3.5 * e, wob = Math.sin(lt * 1.7) * 0.006 * e;
  const x = lerp(sx, FINDER.cx, e), y = lerp(sy, FINDER.cy, e) + bob, size = lerp(s0, FINDER.size, e);
  const rot = lerp(-0.12, 0, e) + wob + (t >= WIND_T ? 0.006 * Math.sin(t * 19) * smooth((t - WIND_T) / 0.2) * (1 - smooth((t - WIND_T - 0.9) / 0.3)) : 0);
  // little squash pop at the snap
  const snap = t >= FINDER_T ? Math.exp(-(t - FINDER_T) / 0.1) : 0, sc = 1 + 0.025 * snap * Math.cos((t - FINDER_T) * 30);
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc); ctx.translate(-x, -y);
  { const ss = size * 1.08; ctx.beginPath(); ctx.rect(x - ss * 1.1, y - ss * 0.7, ss * 2.2, ss * (0.7 + 0.532 + 0.42 * (1 - smooth(e * 1.3)))); ctx.clip(); }
  S.amrita2d.drawProp(ctx, T, S, 'viewfinder', { x, y, size, anim: { t, rec: true }, boil: T.boil, seed: 31 });
  ctx.restore();
  // corner glints
  const s = size * 1.08, W = 0.78 * s, H = 0.52 * s, corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  const glint = (cxn, cyn, a, r, sd) => { if (a < 0.02) return; ctx.save(); ctx.globalAlpha = a; glow(ctx, cxn, cyn, r * 2.4, '#FFF2C0', 0.6); P.fill(ctx, star4(cxn, cyn, r, 0.2, 0), { color: '#FFFFFF', comp: 'source-over', offset: [0, 0], boil: T.boil, seed: sd, amp: 0.3 }); ctx.restore(); };
  if (e > 0.99) {
    const d0 = t - FINDER_T;
    if (d0 >= 0 && d0 < 0.5) corners.forEach(([cx, cy], i) => glint(x + cx * W, y + cy * H, Math.exp(-d0 / 0.14), 30 * Math.min(1, d0 * 14 + 0.3), 1400 + i));
    const per = 0.62, ph = (t - FINDER_T - 0.6) / per;
    if (ph >= 0) { const q = Math.floor(ph), f = ph - q, ci = Math.floor(hash(q, 3, 5) * 4), [cx, cy] = corners[ci]; glint(x + cx * W, y + cy * H, Math.pow(Math.sin(Math.PI * clamp(f * 1.6, 0, 1)), 1.5), 24, 1420 + ci); }
  }
}

// ---------------------------------------------------------------- the frame ---------------------------------------------------------------------------------------
function shimmerBlit(ctx, src, t, S) {
  // heat shimmer: horizontal slices of the far layer drift sideways by sub-pixel-to-2px waves (not above the sun's baseline)
  const lt = t - T0, k = S.scale, y0 = HORIZON - 14, y1 = 650, h = 4;
  ctx.drawImage(src, 0, 0, src.width, Math.round(y0 * k), 0, 0, 1920, y0);
  for (let y = y0; y < y1; y += h) {
    const f = smooth((y - y0) / 24) * (1 - 0.5 * smooth((y - 600) / 50)), dx = Math.sin(y * 0.19 + lt * 3.4) * 1.9 * f + Math.sin(y * 0.071 - lt * 2.1) * 1.2 * f;
    ctx.drawImage(src, 0, Math.round(y * k), src.width, Math.max(1, Math.round(h * k)), dx, y, 1920, h);
  }
  ctx.drawImage(src, 0, Math.round(y1 * k), src.width, src.height - Math.round(y1 * k), 0, y1, 1920, 1080 - y1);
}

export default {
  id: 'e1960', kind: '2d',
  draw(ctx, T, S) {
    const B = T.boil, t = T.t;
    ctx.save();
    ctx.drawImage(layer(S, 'sky|' + B, (g) => drawSky(g, B)), 0, 0, 1920, 1080);
    drawRays(ctx, t);
    drawAnamorphic(ctx, t);
    drawBirds(ctx, B, t);
    shimmerBlit(ctx, layer(S, 'far|' + B, (g) => drawFar(g, B)), t, S);
    glow(ctx, SUN.cx, SUN.cy + 150, 640, '#FFD9A0', 0.30);
    drawCaravan(ctx, B, t);
    ctx.drawImage(layer(S, 'near|' + B, (g) => drawNear(g, B)), 0, 0, 1920, 1080);
    drawSpindrift(ctx, t);
    drawStreaks(ctx, t);
    drawVeils(ctx, t);
    drawGust(ctx, t);
    const am = drawAmrita(ctx, T, S);
    drawFinder(ctx, T, S, am);
    drawGhosts(ctx, t);
    // the sun is the very last thing painted: pristine, exactly (1100,400) r=130
    drawSunDisc(ctx, B, t, true);
    // paper grain over everything
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.34; P.paper(ctx, S, { seed: 61, base: '#F4EBDD', shade: '#E4D6BF' }); ctx.restore();
    ctx.restore();
    // redraw the lens exactly over the paper grain so nothing can dim it during the dive
    if (T.lt >= 1.4) { ctx.save(); ctx.beginPath(); ctx.arc(SUN.cx, SUN.cy, SUN.r, 0, TAU); ctx.clip(); drawSunDisc(ctx, B, t, false); ctx.restore(); }
  },
  grade: () => ({}),
  barColor: '#0b0a0d',
};
