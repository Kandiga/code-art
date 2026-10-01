// =============================================================================
// e1939 — FULL COLOR (10.0-12.0, 1.37, three-strip, prop: megaphone, portal PORTHOLE @ (1300,440) r=100)
//   10.00  the dive from 1927 lands in a BLACK-AND-WHITE pencil drawing: a winding road through hills, Amrita on the road (graphite grey)
//   10.00-10.55  COLOR_BLOOM: a wobbly-edged circle of colour grows out of Amrita (cyan/magenta/yellow mis-registered rim = the three
//                records of three-strip). Inside it: a candy world — lollipop-pink sky, fat painted clouds, lilac-and-rose road, saturated
//                hills, giant poppies + daisies that pop up as the wavefront reaches them, an ORIGINAL faceted-crystal castle that sprouts
//                from the horizon, with one big round mullioned window.
//   10.20-12.0   Amrita SKIPS up the road in squash & stretch (landings 10.5 / 11.0 / 11.5 = beats, sparkle bursts + chime_run star
//                arpeggio at 10.5), megaphone swinging, sound arcs on the landings.
//   11.4-12.0    the dive: the round window (exactly (1300,440) r=100) glows, fully unoccluded; 1960 is revealed inside it.
// Pure function of T.t. All randomness = seeded hashing. Every pencil call gets T.boil (12 fps line boil).
// =============================================================================
import * as P from '../pencil.js';
import { hash, noise1 } from '../rng.js';
import { clamp, lerp, smooth, outCubic, inOutCubic, outBack } from '../ease.js';
import { ERAS } from '../../../shared/cues.js';

const ERA = ERAS[3], PT = ERA.portal;            // porthole @ (1300,440) r=100
const T0 = ERA.t0;
const TAU = Math.PI * 2;
const GRAPH = '#2A2833';

// ---------------------------------------------------------------- local layer cache (pure function of key) ------------------------------
const LAYERS = new Map();
function layer(S, key, draw) {
  const k = key + '@' + S.scale;
  let c = LAYERS.get(k);
  if (c) return c;
  c = S.mk(Math.round(1920 * S.scale), Math.round(1080 * S.scale));
  const g = c.getContext('2d'); g.setTransform(S.scale, 0, 0, S.scale, 0, 0);
  draw(g);
  LAYERS.set(k, c);
  if (LAYERS.size > 9) LAYERS.delete(LAYERS.keys().next().value);
  return c;
}
let TMP = null;
function tmpCanvas(S, w, h) {
  if (!TMP || TMP.s !== S.scale) TMP = { s: S.scale, c: S.mk(Math.round(w * S.scale), Math.round(h * S.scale)) };
  return TMP.c;
}

// ---------------------------------------------------------------- small drawing helpers ------------------------------------------------
const poly = (ctx, pts) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); };
function fillGrad(ctx, pts, y0, y1, stops, off = [0, 0]) {
  ctx.save(); ctx.translate(off[0], off[1]); poly(ctx, pts);
  const gr = ctx.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c));
  ctx.fillStyle = gr; ctx.fill(); ctx.restore();
}
// opaque flat fill (offset = mis-registration) + optional hatch + doubled ink
function solid(ctx, B, pts, o = {}) {
  const seed = o.seed ?? 1;
  if (o.fill) P.fill(ctx, pts, { color: o.fill, comp: 'source-over', offset: o.off ?? [3, 2], amp: o.famp ?? 1.0, boil: B, seed, alpha: o.fa ?? 1 });
  if (o.hatch) P.hatch(ctx, pts, { color: o.hatch, boil: B, seed: seed + 1, gap: o.gap ?? 8, width: o.hw ?? 1.5, alpha: o.ha ?? 0.5, angle: o.ang ?? -0.75, shade: o.shade ?? null, cross: o.cross ?? 0, comp: 'multiply', segLen: o.seg ?? 40, margin: o.margin ?? 0 });
  if (o.ink !== false) P.ink(ctx, pts, { closed: o.closed ?? true, color: o.ic ?? GRAPH, width: o.w ?? 2.8, boil: B, seed: seed + 2, amp: o.amp ?? 1.3, alpha: o.ia ?? 0.9, passes: o.passes ?? 2, step: o.step ?? 10, taper: o.taper ?? false });
}
const line = (ctx, B, pts, o = {}) => P.ink(ctx, pts, { closed: false, color: o.c ?? GRAPH, width: o.w ?? 2.4, boil: B, seed: o.seed ?? 1, amp: o.amp ?? 1.1, alpha: o.a ?? 0.9, passes: o.passes ?? 2, step: o.step ?? 10, taper: o.taper ?? false });
const star4 = (cx, cy, r, ri = 0.28, rot = 0) => { const pts = []; for (let i = 0; i < 8; i++) { const a = rot + (i * Math.PI) / 4 - Math.PI / 2, rr = i % 2 ? r * ri : r; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } return pts; };
const dk = (c, t) => P.darken(c, t), lt_ = (c, t) => P.lighten(c, t), mx = (a, b, t) => P.mix(a, b, t);
function glow(ctx, x, y, r, col, a, comp = 'lighter') {
  ctx.save(); ctx.globalCompositeOperation = comp; const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, P.rgba(col, a)); g.addColorStop(0.45, P.rgba(col, a * 0.35)); g.addColorStop(1, P.rgba(col, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
}

// ---------------------------------------------------------------- palettes (inputs to the three-strip grade) -------------------------------
const COL = {   // inputs are pre-inverted through the three-strip grade (sat 1.6, contrast 1.12, primaries push) so the OUTPUT lands on the intended candy colours
  bw: false, ink: GRAPH,
  sky0: '#FF94AE', sky1: '#FEADBE', sky2: '#E4CAD0', skyH: '#FF7696',
  far: '#8A85C5', farD: '#5B508C', farL: '#AEA8EB',
  m1: '#30AB96', m1D: '#3B7A6D', m1L: '#94CDB8',
  m2: '#96BE75', m2D: '#588855', m2L: '#CFF7A6',
  fg: '#50865C', fgD: '#315E42',
  kerb: '#BC6E91', kerbD: '#86395F', path: '#AD91EE', pathD: '#6F589D', stitch: '#FFF6E2',
};
const BW = {
  bw: true, ink: '#3A3A42',
  sky0: '#E9E9E9', sky1: '#EFEFEF', sky2: '#F4F4F4', skyH: '#9A9A9E',
  far: '#CFCFD2', farD: '#6C6C72', farL: '#DEDEDF',
  m1: '#C4C4C7', m1D: '#5A5A60', m1L: '#D8D8DA',
  m2: '#B3B3B7', m2D: '#4A4A50', m2L: '#C8C8CB',
  fg: '#9F9FA4', fgD: '#3C3C42',
  kerb: '#E4E4E6', kerbD: '#6A6A70', path: '#F2F2F2', pathD: '#9A9AA0', stitch: '#FFFFFF',
};

// ---------------------------------------------------------------- geometry ------------------------------------------------------------
const hillPoly = (ctrl, bottom = 1130) => { const crest = P.smoothPts(ctrl, { n: 10 }); return { crest, poly: crest.concat([[crest[crest.length - 1][0], bottom], [crest[0][0], bottom]]) }; };
const crestAt = (h, x) => { const c = h.crest; for (let i = 1; i < c.length; i++) if (c[i][0] >= x) { const a = c[i - 1], b = c[i]; return a[1] + (b[1] - a[1]) * ((x - a[0]) / Math.max(1e-6, b[0] - a[0])); } return c[c.length - 1][1]; };
const FAR = hillPoly([[-80, 702], [160, 668], [400, 640], [610, 664], [800, 690], [1000, 702], [1190, 718], [1480, 702], [1720, 670], [2000, 702]]);
const M1 = hillPoly([[-80, 760], [200, 738], [480, 754], [760, 744], [1020, 760], [1290, 732], [1560, 746], [2000, 724]]);
const M2 = hillPoly([[-80, 850], [160, 820], [400, 834], [620, 806], [860, 808], [1080, 836], [1330, 824], [1600, 808], [2000, 840]]);
const FGL = hillPoly([[-80, 946], [110, 922], [290, 944], [430, 996], [520, 1110]]);          // foreground bumps (mostly hidden by the HUD strip)
const FGR = hillPoly([[2000, 920], [1760, 900], [1560, 934], [1440, 996], [1380, 1110]]);

const wf = (y) => Math.max(26, 32 + (y - 706) * 0.78);
function makeRibbon(ctrl) {
  const c = P.smoothPts(ctrl, { n: 10 }), n = c.length, nrm = [], W = [];
  for (let i = 0; i < n; i++) {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l; nrm.push([-ty, tx]); W.push(wf(c[i][1]));
  }
  const side = (k, sg, i0 = 0, i1 = n - 1) => { const o = []; for (let i = i0; i <= i1; i++) o.push([c[i][0] + sg * nrm[i][0] * W[i] * 0.5 * k, c[i][1] + sg * nrm[i][1] * W[i] * 0.5 * k * 0.45]); return o; };
  return { c, W, nrm, side, poly: (k, i0 = 0, i1 = n - 1) => side(k, 1, i0, i1).concat(side(k, -1, i0, i1).reverse()) };
}
const RA = makeRibbon([[1298, 712], [1240, 732], [1130, 744], [1010, 758], [910, 776], [868, 798], [900, 824], [960, 842]]);
const RB = makeRibbon([[905, 802], [960, 826], [1070, 846], [1150, 872], [1110, 902], [960, 922], [800, 938], [660, 956], [540, 984], [430, 1024], [330, 1080]]);
// Amrita's route: feet positions at the four landings (x targets along the lower sweep of ribbon B)
const ROUTE_X = [655, 790, 925, 1040, 1135];
function sAtX(x) { const c = RB.c; for (let i = 80; i > 30; i--) if (c[i][0] <= x && c[i - 1][0] >= x) { const f = (x - c[i][0]) / Math.max(1e-6, c[i - 1][0] - c[i][0]); return i - f; } return 70; }
const ROUTE_S = ROUTE_X.map(sAtX);
const ribPos = (s) => { const c = RB.c, i = clamp(Math.floor(s), 0, c.length - 2), f = s - i; return [lerp(c[i][0], c[i + 1][0], f), lerp(c[i][1], c[i + 1][1], f)]; };
const ROUTE = ROUTE_S.map(ribPos);
const BLOOM_C = [ROUTE[0][0], ROUTE[0][1] - 150];     // the circle of colour grows out of Amrita

// ---------------------------------------------------------------- bloom ----------------------------------------------------------------
const BLOOM_T = 0.56, BLOOM_MAX = 1500;
const bloomR = (lt) => (lt <= 0 ? 0 : BLOOM_MAX * inOutCubic(lt / BLOOM_T));
function hitTime(x, y) {               // lt at which the wavefront reaches (x,y)
  const d = Math.hypot(x - BLOOM_C[0], y - BLOOM_C[1]);
  let a = 0, b = BLOOM_T; if (d >= BLOOM_MAX) return BLOOM_T;
  for (let i = 0; i < 14; i++) { const m = (a + b) / 2; if (bloomR(m) < d) a = m; else b = m; }
  return b;
}
function bloomPts(lt, B) {
  const R = bloomR(lt), n = 110, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, w = 1 + 0.05 * noise1(Math.cos(a) * 2.4 + 5, B * 3 + 1) * Math.sin(a * 3 + B) + 0.035 * noise1(a * 2.2 + 9, B * 7);
    pts.push([BLOOM_C[0] + Math.cos(a) * R * w, BLOOM_C[1] + Math.sin(a) * R * w * 0.97]);
  }
  return pts;
}

// ---------------------------------------------------------------- Amrita: hop timeline -------------------------------------------------
const LAND = [10.5, 11.0, 11.5, 12.0];
function amritaAt(t) {
  const lt = t - T0, k = clamp(Math.floor(lt / 0.5 + 1e-9), 0, 3), u = clamp((lt - k * 0.5) / 0.5, 0, 1.0);
  const airU = clamp((u - 0.4) / 0.6), ease = lerp(airU, smooth(airU), 0.35);
  const s = lerp(ROUTE_S[k], ROUTE_S[k + 1], ease), [fx, fy] = ribPos(s);
  const landSq = k >= 1 ? -0.17 * Math.exp(-u / 0.10) * Math.cos(u * 9) : 0;
  const crouch = -0.14 * smooth((u - 0.10) / 0.22) * (1 - smooth((u - 0.34) / 0.07));
  const stretch = 0.12 * smooth((u - 0.34) / 0.07) * (1 - smooth((u - 0.46) / 0.34)) + 0.04 * smooth((u - 0.88) / 0.1);
  const squash = (lt <= 0 ? 0 : 1) * (landSq + crouch + stretch);
  const R = 50 + (fy - 700) * 0.40;
  const h = 4 * airU * (1 - airU) * 120 * (R / 120);
  return { fx, fy, R, h, squash, airU, k, u, lean: 0.12 * Math.sin(airU * Math.PI), s };
}
const PAST = (t) => amritaAt(t);

// ---------------------------------------------------------------- sky ----------------------------------------------------------------
function drawSky(ctx, B, S, pal) {
  if (pal.bw) {
    P.paper(ctx, S, { seed: 39, base: '#ECECEA', shade: '#DCDCDA' });
  } else {
    const gr = ctx.createLinearGradient(0, 0, 0, 760); gr.addColorStop(0, pal.sky0); gr.addColorStop(0.62, pal.sky1); gr.addColorStop(1, pal.sky2);
    ctx.fillStyle = gr; ctx.fillRect(-10, -10, 1940, 1100);
  }
  // pencil hatching in the sky: long soft diagonal strokes, denser at the top
  const topPoly = [[-40, -20], [1960, -20], [1960, 460], [-40, 560]];
  P.hatch(ctx, topPoly, { color: pal.bw ? '#8F8F94' : pal.skyH, boil: B, seed: 11, gap: 15, width: 1.6, alpha: pal.bw ? 0.30 : 0.38, angle: -0.62, shade: (x, y) => clamp(1 - y / 520, 0, 1), margin: 0.1, segLen: 70, jitter: 1.6 });
  if (!pal.bw) {
    drawRainbow(ctx, B);
    // warm pearl glow where the castle stands
    glow(ctx, 1300, 520, 620, '#FFF2F8', 0.55, 'source-over');
    // twinkles in the sky
    for (let i = 0; i < 14; i++) {
      const x = 260 + hash(i, 3, 1) * 1400, y = 40 + hash(i, 3, 2) * 360, r = 7 + hash(i, 3, 3) * 9;
      if (Math.hypot(x - 1300, y - 440) < 230) continue;
      P.fill(ctx, star4(x, y, r, 0.3, 0), { color: '#FFFFFF', comp: 'source-over', offset: [0, 0], boil: B, seed: 50 + i, amp: 0.4, alpha: 0.9 });
    }
  }
}

function drawRainbow(ctx, B) {
  const cx = 760, cy = 800, R0 = 560, bw = 23, cols = ['#FA6869', '#C79562', '#FECE80', '#71B67F', '#668BFF', '#8869C3'];
  cols.forEach((c, i) => {
    const r = R0 - i * bw, pts = []; for (let a = Math.PI * 1.02; a <= Math.PI * 1.98; a += 0.05) pts.push([cx + Math.cos(a) * r * 1.12, cy + Math.sin(a) * r * 0.86]);
    const out = pts.concat(pts.map(([x, y]) => { const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy); return [x - dx / l * bw * 0.96, y - dy / l * bw * 0.96]; }).reverse());
    P.fill(ctx, out, { color: c, comp: 'source-over', offset: [3, 2], boil: B, amp: 0.8, seed: 60 + i, alpha: 0.92 });
  });
  const outer = []; for (let a = Math.PI * 1.02; a <= Math.PI * 1.98; a += 0.05) outer.push([cx + Math.cos(a) * R0 * 1.12, cy + Math.sin(a) * R0 * 0.86]);
  P.ink(ctx, outer, { closed: false, color: '#7A3A8C', width: 2.4, boil: B, seed: 70, amp: 1.4, alpha: 0.7, passes: 2, step: 12 });
}

// ---------------------------------------------------------------- clouds ---------------------------------------------------------------
function cloudPoly(cx, cy, w, seed) {
  const n = 5, yb = cy + w * 0.13, bumps = [];
  for (let i = 0; i < n; i++) {
    const mid = 1 - Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
    const r = w * (0.13 + 0.09 * mid + 0.025 * hash(i, seed, 1));
    const x = cx - w / 2 + r * 0.9 + (w - r * 1.8) * (i / (n - 1));
    bumps.push({ x, r, y: yb - r * 0.9 - (i % 2 ? 0 : r * 0.1) });
  }
  const top = (x) => { let y = yb; for (const b of bumps) { const d = x - b.x; if (Math.abs(d) < b.r) y = Math.min(y, b.y - Math.sqrt(b.r * b.r - d * d)); } return y; };
  const L = bumps[0], Rr = bumps[n - 1], pts = [];
  for (let a = 2.02; a <= Math.PI; a += 0.12) pts.push([L.x + Math.cos(a) * L.r, L.y + Math.sin(a) * L.r]);
  for (let x = L.x - L.r + 4; x <= Rr.x + Rr.r - 4; x += 7) pts.push([x, top(x)]);
  for (let a = 0; a <= 1.12; a += 0.12) pts.push([Rr.x + Math.cos(a) * Rr.r, Rr.y + Math.sin(a) * Rr.r]);
  for (let i = 0; i <= 8; i++) { const u = i / 8; pts.push([lerp(Rr.x + 0.43 * Rr.r, L.x - 0.43 * L.r, u), yb + Math.sin(u * Math.PI) * 7]); }
  return { pts, yb, cy };
}
const CLOUDS = [{ x: 330, y: 250, w: 410, s: 1, v: 16 }, { x: 860, y: 168, w: 330, s: 2, v: 11 }, { x: 1560, y: 170, w: 270, s: 3, v: 9 }, { x: 740, y: 470, w: 250, s: 4, v: 7 }];
function drawClouds(ctx, B, pal, t) {
  const lt = t - T0;
  CLOUDS.forEach((c) => {
    const x = c.x + c.v * lt, cp = cloudPoly(x, c.y, c.w, c.s);
    const body = pal.bw ? '#FAFAFA' : '#FFFFFF', shade = pal.bw ? '#B9B9BE' : '#C7A3FF';
    ctx.save(); ctx.translate(3, 2); poly(ctx, cp.pts);
    const gr = ctx.createLinearGradient(0, cp.yb - c.w * 0.38, 0, cp.yb + 8); gr.addColorStop(0, body); gr.addColorStop(0.55, body); gr.addColorStop(1, shade);
    ctx.fillStyle = gr; ctx.fill(); ctx.restore();
    P.hatch(ctx, cp.pts, { color: pal.bw ? '#7A7A80' : '#9A6BE8', boil: B, seed: 70 + c.s, gap: 7, width: 1.2, alpha: pal.bw ? 0.4 : 0.42, angle: -0.8, shade: (px, py) => clamp((py - (cp.yb - c.w * 0.16)) / (c.w * 0.16), 0, 1), margin: 0.1, segLen: 22, jitter: 1 });
    P.ink(ctx, cp.pts, { closed: true, color: pal.bw ? '#4A4A52' : '#5B3A8C', width: 3.2, boil: B, seed: 80 + c.s, amp: 1.5, alpha: 0.92, passes: 2, step: 9 });
  });
}

// ---------------------------------------------------------------- hills + road ----------------------------------------------------------
function hatchStrip(ctx, B, crest, thick, col, o = {}) {
  const chunk = o.chunk ?? 7, seed = o.seed ?? 1;
  for (let i = 0; i < crest.length - 1; i += chunk) {
    const seg = crest.slice(i, Math.min(crest.length, i + chunk + 1)); if (seg.length < 2) continue;
    const dn = seg.map(([x, y], j) => [x, y + thick * (0.7 + 0.5 * hash(Math.round(x / 30), seed, 3))]).reverse();
    P.hatch(ctx, seg.concat(dn), { color: col, boil: B, seed: seed + i, gap: o.gap ?? 8, width: o.hw ?? 1.5, alpha: o.alpha ?? 0.5, angle: o.angle ?? -1.05, segLen: o.seg ?? 26, jitter: 1.2, shade: o.shade ?? null, margin: o.margin ?? 0.15 });
  }
}
function drawHill(ctx, B, h, pal, c, cD, cL, o = {}) {
  fillGrad(ctx, h.poly, o.y0 ?? 600, o.y1 ?? 1100, [[0, cL], [0.22, c], [1, mx(c, cD, 0.55)]], [3, 2]);
  hatchStrip(ctx, B, h.crest, o.thick ?? 78, cD, { seed: o.seed ?? 5, alpha: pal.bw ? 0.55 : 0.46, gap: o.gap ?? 8 });
  line(ctx, B, h.crest, { c: pal.bw ? pal.ink : dk(c, 0.62), w: 3.4, seed: (o.seed ?? 5) + 40, amp: 1.5, step: 10 });
}
function drawRibbon(ctx, B, rb, pal, o = {}) {
  const n = rb.c.length;
  const outer = rb.poly(1.0), inner = rb.poly(0.64);
  P.fill(ctx, outer, { color: pal.kerb, comp: 'source-over', offset: [3, 2], boil: B, amp: 1.0, seed: 101 });
  P.fill(ctx, inner, { color: pal.path, comp: 'source-over', offset: [4, 3], boil: B, amp: 1.0, seed: 102 });
  // pencil hatch on the lilac, in slices (cheap): diagonal strokes
  for (let i = 0; i < n - 8; i += 9) {
    const sl = rb.poly(0.70, i, Math.min(n - 1, i + 9));
    P.hatch(ctx, sl, { color: pal.pathD, boil: B, seed: 110 + i, gap: 7, width: 1.4, alpha: pal.bw ? 0.35 : 0.42, angle: -0.9, segLen: 20, jitter: 1, shade: null });
    const sk = rb.poly(1.0, i, Math.min(n - 1, i + 9));
    P.hatch(ctx, sk, { color: pal.kerbD, boil: B, seed: 140 + i, gap: 6, width: 1.3, alpha: pal.bw ? 0.30 : 0.38, angle: 0.8, segLen: 16, jitter: 1, shade: null });
  }
  // candy stitches down the middle
  for (let i = 4; i < n - 2; i += 5) {
    const [x, y] = rb.c[i], w = rb.W[i];
    P.fill(ctx, P.ellipsePts(x, y, w * 0.07, w * 0.035, 0, 10), { color: pal.stitch, comp: 'source-over', offset: [0, 0], boil: B, amp: 0.4, seed: 160 + i });
  }
  const ic = pal.bw ? pal.ink : dk(pal.kerb, 0.62);
  line(ctx, B, rb.side(1.0, 1), { c: ic, w: 3.2, seed: 170 });
  line(ctx, B, rb.side(1.0, -1), { c: ic, w: 3.2, seed: 171 });
  line(ctx, B, rb.side(0.70, 1), { c: pal.bw ? pal.pathD : dk(pal.path, 0.4), w: 1.8, seed: 172, a: 0.6, passes: 1 });
  line(ctx, B, rb.side(0.70, -1), { c: pal.bw ? pal.pathD : dk(pal.path, 0.4), w: 1.8, seed: 173, a: 0.6, passes: 1 });
}

function drawFar(ctx, B, pal) { drawHill(ctx, B, FAR, pal, pal.far, pal.farD, pal.farL, { y0: 620, y1: 900, seed: 5, thick: 62 }); }
function drawMid(ctx, B, pal) {
  drawHill(ctx, B, M1, pal, pal.m1, pal.m1D, pal.m1L, { y0: 700, y1: 1000, seed: 15, thick: 54 });
  drawRibbon(ctx, B, RA, pal);
  drawHill(ctx, B, M2, pal, pal.m2, pal.m2D, pal.m2L, { y0: 780, y1: 1100, seed: 25, thick: 70 });
  // the road re-emerges on the near slope: clipped to the near hill so it "comes over the ridge"
  ctx.save(); poly(ctx, M2.poly); ctx.clip(); drawRibbon(ctx, B, RB, pal); ctx.restore();
  line(ctx, B, M2.crest, { c: pal.bw ? pal.ink : dk(pal.m2, 0.62), w: 3.4, seed: 66, amp: 1.5 });
  drawHill(ctx, B, FGL, pal, pal.fg, pal.fgD, pal.m2, { y0: 900, y1: 1100, seed: 35, thick: 40 });
  drawHill(ctx, B, FGR, pal, pal.fg, pal.fgD, pal.m2, { y0: 900, y1: 1100, seed: 45, thick: 40 });
}

// ---------------------------------------------------------------- the crystal castle (ORIGINAL design) --------------------------------------
const SAPH = { l: '#7DB6FF', m: '#2F6EFF', d: '#1B3FC8' }, MAG = { l: '#FF8BDE', m: '#E2339F', d: '#A81482' }, VIO = { l: '#BCA2FF', m: '#7B55F0', d: '#4C2FB8' }, ICE = { l: '#E2F4FF', m: '#97D4FF', d: '#4F9DEA' };
const BASEY = 724;
const CASTLE = [
  { k: 'prism', cx: 996, w: 54, top: 470, apex: 392, tn: VIO },
  { k: 'prism', cx: 1596, w: 56, top: 462, apex: 372, tn: VIO },
  { k: 'wall', x0: 1030, x1: 1180, top: 585, tn: MAG },
  { k: 'wall', x0: 1420, x1: 1565, top: 580, tn: MAG },
  { k: 'prism', cx: 1108, w: 86, top: 392, apex: 262, tn: MAG },
  { k: 'prism', cx: 1498, w: 90, top: 380, apex: 236, tn: MAG },
  { k: 'prism', cx: 1048, w: 52, top: 520, apex: 450, tn: SAPH },
  { k: 'prism', cx: 1556, w: 54, top: 512, apex: 436, tn: ICE },
  { k: 'prism', cx: 1300, w: 276, top: 305, apex: 96, tn: SAPH, keep: true },
  { k: 'prism', cx: 1300, w: 232, top: 612, apex: 556, tn: ICE, gate: true },
];
function drawPrism(ctx, B, c, i, ink) {
  const x0 = c.cx - c.w / 2, x1 = c.cx - c.w / 4, x2 = c.cx + c.w / 4, x3 = c.cx + c.w / 2, T = c.tn, ay = c.apex, ty = c.top, by = BASEY + 6, sd = 200 + i * 17;
  const faces = [
    [[x0, ty], [x1, ty], [x1, by], [x0, by]], [[x1, ty], [x2, ty], [x2, by], [x1, by]], [[x2, ty], [x3, ty], [x3, by], [x2, by]],
  ];
  const caps = [[[x0, ty], [x1, ty], [c.cx, ay]], [[x1, ty], [x2, ty], [c.cx, ay]], [[x2, ty], [x3, ty], [c.cx, ay]]];
  const cols = [T.l, T.m, T.d];
  faces.forEach((f, j) => {
    fillGrad(ctx, f, ty, by, [[0, cols[j]], [1, mx(cols[j], T.d, 0.45)]], [2, 1]);
    P.hatch(ctx, f, { color: dk(cols[j], 0.5), boil: B, seed: sd + j, gap: 9, width: 1.3, alpha: j === 0 ? 0.18 : 0.34, angle: 1.15 - j * 0.15, segLen: 34, jitter: 1, shade: (x, y) => clamp(0.15 + (y - ty) / (by - ty) * 0.9, 0, 1), margin: 0.2 });
  });
  caps.forEach((f, j) => {
    fillGrad(ctx, f, ay, ty, [[0, lt_(cols[j], 0.25)], [1, cols[j]]], [2, 1]);
    P.hatch(ctx, f, { color: dk(cols[j], 0.45), boil: B, seed: sd + 9 + j, gap: 8, width: 1.2, alpha: j === 0 ? 0.15 : 0.3, angle: 1.2, segLen: 28, jitter: 1, shade: null });
  });
  const ic = dk(T.d, 0.5);
  caps.forEach((f, j) => P.ink(ctx, f, { closed: true, color: ic, width: 2.6, boil: B, seed: sd + 20 + j, amp: 1.0, alpha: 0.9, passes: 2, step: 10 }));
  faces.forEach((f, j) => P.ink(ctx, f, { closed: true, color: ic, width: 2.8, boil: B, seed: sd + 30 + j, amp: 1.0, alpha: 0.9, passes: 2, step: 12 }));
  // glint slivers on the lit facets
  ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#FFFFFF';
  poly(ctx, [[x0 + c.w * 0.05, ty + (by - ty) * 0.08], [x0 + c.w * 0.12, ty + (by - ty) * 0.08], [x0 + c.w * 0.12, ty + (by - ty) * 0.5], [x0 + c.w * 0.05, ty + (by - ty) * 0.56]]); ctx.fill(); ctx.restore();
  if (c.gate) {
    // arched door, warm light inside
    const dx = c.cx, dw = 24, dtop = BASEY - 52;
    const arch = [[dx - dw, BASEY + 6], [dx - dw, dtop + 16]]; for (let a = 0; a <= 6; a++) { const th = Math.PI + (a / 6) * Math.PI; arch.push([dx + Math.cos(th) * dw, dtop + 16 + Math.sin(th) * 24]); } arch.push([dx + dw, BASEY + 6]);
    ctx.save(); poly(ctx, arch); const g = ctx.createLinearGradient(0, dtop, 0, BASEY); g.addColorStop(0, '#FFF2A8'); g.addColorStop(1, '#FF9D2E'); ctx.fillStyle = g; ctx.fill(); ctx.restore();
    P.ink(ctx, arch, { closed: true, color: '#241A5C', width: 3.2, boil: B, seed: sd + 60, amp: 0.9, passes: 2 });
  }
}
function drawWall(ctx, B, c, i) {
  const T = c.tn, by = BASEY + 6, pts = [[c.x0, c.top], [c.x1, c.top], [c.x1, by], [c.x0, by]];
  fillGrad(ctx, pts, c.top, by, [[0, T.m], [1, T.d]], [2, 1]);
  P.hatch(ctx, pts, { color: dk(T.d, 0.5), boil: B, seed: 300 + i, gap: 8, width: 1.3, alpha: 0.35, angle: 1.1, segLen: 30, jitter: 1 });
  // crystal crenellations
  const n = Math.round((c.x1 - c.x0) / 26);
  for (let j = 0; j < n; j++) { const x = c.x0 + ((j + 0.5) / n) * (c.x1 - c.x0), w = (c.x1 - c.x0) / n * 0.8, h = 24 + 18 * hash(j, i, 7); const sp = [[x - w / 2, c.top], [x, c.top - h], [x + w / 2, c.top]]; fillGrad(ctx, sp, c.top - h, c.top, [[0, T.l], [1, T.m]], [1, 1]); P.ink(ctx, sp, { closed: true, color: dk(T.d, 0.5), width: 2.2, boil: B, seed: 320 + i * 9 + j, amp: 0.8, passes: 2, step: 12 }); }
  P.ink(ctx, pts, { closed: true, color: dk(T.d, 0.5), width: 2.8, boil: B, seed: 310 + i, amp: 1.0, passes: 2, step: 12 });
}
// growth factors per component (1 = settled). Pieces sprout from the ground line when the wavefront reaches them.
function castleK(lt) { return CASTLE.map((c, i) => { const cx = c.cx ?? (c.x0 + c.x1) / 2; const th = hitTime(cx, 560) + 0.02 * (i % 3); return outBack(clamp((lt - th) / 0.34), 1.5); }); }
function drawCastle(ctx, B, ks, S) {
  CASTLE.forEach((c, i) => {
    const k = ks ? ks[i] : 1; if (k <= 0.001) return;
    const cx = c.cx ?? (c.x0 + c.x1) / 2;
    ctx.save(); ctx.translate(cx, BASEY + 6); ctx.scale(1 + (k - 1) * 0.12, k); ctx.translate(-cx, -(BASEY + 6));
    if (c.k === 'wall') drawWall(ctx, B, c, i); else drawPrism(ctx, B, c, i);
    ctx.restore();
  });
}
function castleSketch(ctx, B, S) {   // the B&W beat: a faint unfinished pencil outline where the castle will be
  CASTLE.forEach((c, i) => {
    if (c.k === 'wall') return;
    const x0 = c.cx - c.w / 2, x3 = c.cx + c.w / 2, ay = c.apex, ty = c.top, by = BASEY + 6;
    const o = [[x0, by], [x0, ty], [c.cx, ay], [x3, ty], [x3, by]];
    P.ink(ctx, o, { closed: false, color: '#6A6A72', width: 1.8, boil: B, seed: 400 + i, amp: 1.2, alpha: 0.5, passes: 2, step: 12 });
    P.ink(ctx, [[c.cx - c.w / 4, ty], [c.cx, ay], [c.cx + c.w / 4, ty]], { closed: false, color: '#8A8A92', width: 1.2, boil: B, seed: 420 + i, amp: 1, alpha: 0.4, passes: 1, step: 12 });
  });
}
// tip glints (animated twinkles) — never inside the portal circle
function drawGlints(ctx, B, t, ks) {
  CASTLE.forEach((c, i) => {
    if (c.k !== 'prism' || c.gate) return;
    const k = ks ? ks[i] : 1; if (k < 0.9) return;
    const ph = (t * 1.7 + hash(i, 5, 1) * 3) % 1, a = Math.pow(Math.sin(Math.PI * ph), 2), r = (c.keep ? 30 : 18) * a;
    if (r < 2) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(ctx, c.cx, c.apex, r * 2.4, '#FFFFFF', 0.55);
    ctx.restore();
    P.fill(ctx, star4(c.cx, c.apex, r, 0.2, 0), { color: '#FFFFFF', comp: 'source-over', offset: [0, 0], boil: B, seed: 450 + i, amp: 0.3 });
  });
}

// ---------------------------------------------------------------- THE PORTAL: the round mullioned window ----------------------------------------
function drawWindow(ctx, B, t, k = 1) {
  const { cx, cy, r } = PT, pulse = 0.5 + 0.5 * Math.sin(t * 5.2);
  ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
  // halo outside the circle
  glow(ctx, cx, cy, r * 2.1, '#FFE98A', 0.40 + 0.1 * pulse);
  // frame ring (cream-gold) r 100 .. 84, with gem studs
  ctx.fillStyle = '#FFF0BE'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, rr = r * 0.92; ctx.fillStyle = i % 2 ? '#E2339F' : '#2F6EFF'; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 4.6, 0, TAU); ctx.fill(); }
  const gR = r * 0.84;
  // leaded background, then the glass: a hot glowing disc with 8 petal panes (rose window)
  ctx.fillStyle = '#B8650E'; ctx.beginPath(); ctx.arc(cx, cy, gR, 0, TAU); ctx.fill();
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, gR); bg.addColorStop(0, '#FFFFFF'); bg.addColorStop(0.5, '#FFF2A0'); bg.addColorStop(1, '#FFB52E');
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(cx, cy, gR - 4, 0, TAU); ctx.fill();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8, ca = Math.cos(a), sa = Math.sin(a), r0 = r * 0.27, r1 = r * 0.77, rm = (r0 + r1) / 2, hw = r * 0.15;
    const pts = [[ca * r0, sa * r0]]; for (let q = 1; q < 8; q++) { const u = q / 8, rr = lerp(r0, r1, u), w = Math.sin(u * Math.PI) ** 0.8 * hw; pts.push([ca * rr - sa * w, sa * rr + ca * w]); }
    pts.push([ca * r1, sa * r1]); for (let q = 7; q >= 1; q--) { const u = q / 8, rr = lerp(r0, r1, u), w = Math.sin(u * Math.PI) ** 0.8 * hw; pts.push([ca * rr + sa * w, sa * rr - ca * w]); }
    const g2 = ctx.createRadialGradient(cx + ca * rm, cy + sa * rm, 0, cx + ca * rm, cy + sa * rm, r * 0.3);
    if (i % 2) { g2.addColorStop(0, '#FFFFFF'); g2.addColorStop(1, '#FFD84A'); } else { g2.addColorStop(0, '#FFF8D0'); g2.addColorStop(1, '#FF9F2E'); }
    ctx.save(); ctx.translate(cx, cy); poly(ctx, pts); ctx.restore();
    ctx.save(); ctx.beginPath(); pts.forEach((p, j) => (j ? ctx.lineTo(cx + p[0], cy + p[1]) : ctx.moveTo(cx + p[0], cy + p[1]))); ctx.closePath(); ctx.fillStyle = g2; ctx.fill(); ctx.lineWidth = 6.5; ctx.strokeStyle = '#7A3E08'; ctx.stroke(); ctx.lineWidth = 3; ctx.strokeStyle = '#FFF6D6'; ctx.stroke(); ctx.restore();
  }
  // slow-turning light rays inside the glass
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, gR, 0, TAU); ctx.clip(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + t * 0.6; ctx.fillStyle = `rgba(255,255,255,${0.09 + 0.05 * pulse})`; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a + 0.24); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  // mullion ring + rosette hub
  ctx.lineWidth = 11; ctx.strokeStyle = '#7A3E08'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, 0, TAU); ctx.stroke();
  ctx.lineWidth = 5.5; ctx.strokeStyle = '#FFF6D6'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#7A3E08'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.25, 0, TAU); ctx.fill();
  ctx.fillStyle = '#FFF6D6'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.2, 0, TAU); ctx.fill();
  ctx.fillStyle = '#E2339F'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.12, 0, TAU); ctx.fill();
  ctx.fillStyle = '#FFE08A'; ctx.beginPath(); ctx.arc(cx - 3, cy - 3, r * 0.05, 0, TAU); ctx.fill();
  // inked frame: outer edge exactly at r, inner edge at the glass
  P.ink(ctx, P.circlePts(cx, cy, r - 3, 64), { closed: true, color: '#1B1550', width: 6, boil: B, seed: 900, amp: 0.7, passes: 2, step: 8, alpha: 0.95 });
  P.ink(ctx, P.circlePts(cx, cy, gR, 56), { closed: true, color: '#7A3A08', width: 4, boil: B, seed: 901, amp: 0.7, passes: 2, step: 8, alpha: 0.9 });
  ctx.restore();
}

// ---------------------------------------------------------------- flowers ----------------------------------------------------------------
function buildFlowers() {
  const L = [];
  // hand-placed giants framing the shot
  [[300, 928, 84, 'p', 250], [420, 990, 56, 'd', 190], [1612, 902, 80, 'p', 240], [1500, 962, 60, 'd', 180], [1690, 1000, 74, 'd', 250], [236, 1000, 66, 'd', 200]].forEach(([x, y, r, kd, st], i) => L.push({ x, y, r, kd, st, ph: i * 1.7, seed: 500 + i }));
  // scattered mid-ground flowers (seeded), kept off the road and off Amrita's route
  let n = 0;
  for (let i = 0; i < 160 && n < 46; i++) {
    const x = 235 + hash(i, 7, 1) * 1450, y = 764 + hash(i, 7, 2) * 186;
    const rbDist = (rb) => { let m = 1e9; for (let j = 0; j < rb.c.length; j += 2) { const dx = x - rb.c[j][0], dy = (y - rb.c[j][1]) * 2.2; m = Math.min(m, Math.hypot(dx, dy) - rb.W[j] * 0.78); } return m; };
    const c1 = crestAt(M1, x), c2 = crestAt(M2, x), inM1 = y > c1 + 14 && y < c2 - 6, inM2 = y > c2 + 6;
    if (!inM1 && !inM2) continue;
    if (rbDist(RB) < 24 || (y < 826 && rbDist(RA) < 18)) continue;
    if (x > 480 && x < 1290 && y > 790) continue;
    if (x > 1180 && x < 1420 && y < 790) continue;
    const near = clamp((y - 764) / 186, 0, 1), r = 12 + near * 30 + 6 * hash(i, 7, 3);
    L.push({ x, y, r, kd: hash(i, 7, 4) < 0.5 ? 'p' : 'd', st: r * (2.0 + 1.2 * hash(i, 7, 5)), ph: hash(i, 7, 6) * 6, seed: 600 + n });
    n++;
  }
  L.sort((a, b) => a.y - b.y);
  return L;
}
const FLOWERS = buildFlowers();
function drawFlower(ctx, B, f, t, k, pal) {
  const sway = Math.sin(t * 2.3 + f.ph) * 0.055 + Math.sin(t * 0.9 + f.x * 0.01) * 0.03;
  const sd = f.seed, r = f.r, st = f.st * 0.9;
  ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(sway); ctx.scale(k, k);
  const bx = Math.sin(f.ph) * r * 0.25, by = -st;
  // stem + leaf
  const stem = [[0, 8], [bx * 0.3, -st * 0.35], [bx * 0.8, -st * 0.7], [bx, by]];
  const sm = P.smoothPts(stem, { n: 5 });
  P.ink(ctx, sm, { closed: false, color: '#0E6B2C', width: Math.max(3.4, r * 0.1) + 3, boil: B, seed: sd, amp: 0.7, passes: 1, step: 10, alpha: 1 });
  P.ink(ctx, sm, { closed: false, color: '#3FC85A', width: Math.max(3.4, r * 0.1), boil: B, seed: sd + 1, amp: 0.7, passes: 1, step: 10, alpha: 1 });
  const lf = [[0, -st * 0.28], [r * 0.55, -st * 0.28 - r * 0.38], [r * 0.95, -st * 0.28 - r * 0.2], [r * 0.5, -st * 0.28 + r * 0.02]];
  solid(ctx, B, P.smoothPts(lf, { closed: true, n: 4 }), { fill: '#3FC85A', ic: '#0E6B2C', w: 2.2, seed: sd + 3, off: [2, 1], hatch: '#0E6B2C', ha: 0.3, gap: 6, passes: 1, amp: 0.8 });
  ctx.translate(bx, by);
  if (f.kd === 'p') {            // poppy: five cup petals, dark heart
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.62 + (i === 2 ? 0 : 0), px = Math.cos(a) * r * 0.46, py = Math.sin(a) * r * 0.3 - (i === 2 ? 0 : 0);
      const pts = P.ellipsePts(px, py, r * 0.52, r * 0.6, a + Math.PI / 2, 18);
      solid(ctx, B, pts, { fill: i % 2 ? '#FF3B2E' : '#FF5238', ic: '#7A0F1C', w: 2.2, seed: sd + 10 + i, off: [2, 2], hatch: '#B5121E', ha: 0.42, gap: 5.5, ang: a, shade: (x, y) => clamp(0.3 + (y - py) / (r * 0.7), 0.1, 1), amp: 0.9, passes: 1, step: 8 });
    }
    solid(ctx, B, P.circlePts(0, r * 0.02, r * 0.24, 14), { fill: '#241A33', ic: '#0E0D12', w: 2, seed: sd + 20, off: [1, 1], amp: 0.6, passes: 1 });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; ctx.fillStyle = '#FFE24A'; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.3, r * 0.02 + Math.sin(a) * r * 0.3, Math.max(1.6, r * 0.04), 0, TAU); ctx.fill(); }
  } else {                       // daisy: 12 slim white petals, yellow eye
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + 0.1, pts = P.ellipsePts(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.4, r * 0.16, a, 12);
      solid(ctx, B, pts, { fill: '#FFFFFF', ic: '#7A5BC8', w: 1.9, seed: sd + 30 + i, off: [1.5, 1.5], amp: 0.7, passes: 1, step: 8, ia: 0.85 });
    }
    solid(ctx, B, P.circlePts(0, 0, r * 0.3, 16), { fill: '#FFD21F', ic: '#9A5A08', w: 2.2, seed: sd + 50, off: [1.5, 1], hatch: '#E08A12', ha: 0.5, gap: 4.5, amp: 0.7, passes: 1 });
  }
  ctx.restore();
}

// ---------------------------------------------------------------- sparkles + FX ----------------------------------------------------------
function drawStar(ctx, B, x, y, r, col, a, seed) {
  if (r < 1.2 || a <= 0.01) return;
  glow(ctx, x, y, r * 2.2, col, 0.5 * a);
  ctx.save(); ctx.globalAlpha = Math.min(1, a);
  P.fill(ctx, star4(x, y, r, 0.27, hash(seed, 1, 1) * 0.4), { color: '#FFFFFF', comp: 'source-over', offset: [0, 0], boil: B, seed, amp: 0.4 });
  P.ink(ctx, star4(x, y, r, 0.27, hash(seed, 1, 1) * 0.4), { closed: true, color: mx(col, '#B05A00', 0.45), width: 1.8, boil: B, seed: seed + 1, amp: 0.4, passes: 1, step: 8, alpha: 0.9 });
  ctx.restore();
}
const SPARK_COLS = ['#FFD93A', '#FF7AC8', '#7AD7FF', '#FFFFFF', '#FFB02E'];
function drawSparkles(ctx, B, t) {
  const lt = t - T0;
  // landing bursts: radial stars + dust ring
  [10.5, 11.0, 11.5].forEach((tl, k) => {
    const dt = t - tl; if (dt < 0 || dt > 0.75) return;
    const [fx, fy] = ROUTE[k + 1], Rr = 50 + (fy - 700) * 0.40, kk = dt / 0.75, N = k === 0 ? 11 : 8;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU + hash(i, k, 21) * 0.6 - 1.57 * 0, d = Rr * (1.0 + outCubic(kk) * (0.5 + 1.1 * hash(i, k, 22))), x = fx + Math.cos(a) * d * 1.2, y = fy - Rr * 0.9 + Math.sin(a) * d * 0.95 - kk * 18;
      drawStar(ctx, B, x, y, Rr * (0.12 + 0.12 * hash(i, k, 23)) * (1 - kk * 0.8), SPARK_COLS[(i + k) % 5], 1 - kk * kk, 700 + k * 40 + i);
    }
    // ground ripple
    ctx.save(); ctx.translate(fx, fy); ctx.scale(1, 0.22); ctx.strokeStyle = P.rgba('#FFFFFF', 0.8 * (1 - kk)); ctx.lineWidth = 6 * (1 - kk) + 1; ctx.beginPath(); ctx.arc(0, 0, Rr * (0.5 + 2.2 * outCubic(kk)), 0, TAU); ctx.stroke(); ctx.restore();
  });
  // chime run: an ascending arpeggio of stars arcing from the first landing toward the sky (10.5 .. 11.15)
  for (let j = 0; j < 10; j++) {
    const tj = 10.5 + j * 0.065, dt = t - tj; if (dt < 0 || dt > 0.55) continue;
    const u = j / 9, [fx, fy] = ROUTE[1];
    const x = fx + 40 + u * 330 + Math.sin(u * 5) * 20, y = fy - 190 - u * 250 + Math.sin(u * 3.2) * 36;
    if (Math.hypot(x - PT.cx, y - PT.cy) < 175) continue;
    const kk = dt / 0.55;
    drawStar(ctx, B, x, y - kk * 22, (22 - 8 * u) * Math.sin(Math.min(1, kk * 2.2) * Math.PI / 2) * (1 - kk * 0.6), SPARK_COLS[j % 5], 1 - kk * kk, 800 + j);
  }
}
function drawTrail(ctx, B, t) {
  // sparkle shed behind her during flight: positions of her past self
  for (let j = 1; j <= 9; j++) {
    const tj = t - j * 0.028; if (tj < T0 + 0.15) continue;
    const a = amritaAt(tj); if (a.h < 6) continue;
    const age = j / 9, ox = (hash(j, Math.floor(t * 12), 31) - 0.5) * 50, oy = (hash(j, Math.floor(t * 12), 32) - 0.5) * 50;
    drawStar(ctx, B, a.fx - a.R * 0.5 + ox, a.fy - a.R * 1.15 - a.h + oy, a.R * (0.16 - 0.1 * age), SPARK_COLS[(j + 2) % 5], 1 - age, 900 + j);
  }
}

// ---------------------------------------------------------------- Amrita --------------------------------------------------------------------
function amritaArgs(t, S, T) {
  const a = amritaAt(t), lt = t - T0;
  const sound = Math.max(0, ...[10.5, 11.0, 11.5].map((tl) => (t >= tl ? Math.exp(-(t - tl) / 0.3) : 0)));
  const surprise = clamp((lt - 0.06) / 0.08) * (1 - smooth((lt - 0.30) / 0.1));
  const happy = smooth((lt - 0.28) / 0.12);
  const eye = { open: 1 - 0.0, happy: happy * 0.9, surprised: surprise * 0.9, lookX: 0.35, lookY: -0.2 + 0.0 };
  const sy = 1 + a.squash;
  const yc = a.fy - a.R * 1.12 * sy - a.h;
  return {
    a, x: a.fx, y: yc, size: a.R, yaw: 0.36, roll: a.lean - 0.02, squash: a.squash, eye, prop: 'megaphone', propSide: 1, propScale: 0.82, propDx: -a.R * 0.15, propRot: -0.28 + a.lean * 0.8 - a.squash * 0.2,
    propAnim: { t, sound: lt > 0.5 ? sound : 0 }, groundY: a.fy, seed: 14, shadow: { a: 0.9 },
  };
}
function drawAmritaColor(ctx, T, S) { const o = amritaArgs(T.t, S, T); glow(ctx, o.x, o.y, o.size * 2.4, '#FFFFFF', 0.55, 'source-over'); S.amrita2d.drawAmrita(ctx, T, S, o); return o; }
function drawAmritaGray(ctx, T, S) {
  const o = amritaArgs(T.t, S, T), c = tmpCanvas(S, 1000, 760), g = c.getContext('2d'), cx = o.x + 100, cy = o.y;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
  g.setTransform(S.scale, 0, 0, S.scale, (500 - cx) * S.scale, (380 - cy) * S.scale);
  S.amrita2d.drawAmrita(g, T, S, { ...o, eye: { open: 1, lookX: 0.35, lookY: -0.2 }, propAnim: { t: T.t } });
  ctx.save(); ctx.filter = 'grayscale(1) contrast(0.95) brightness(1.04)'; ctx.drawImage(c, cx - 500, cy - 380, 1000, 760); ctx.restore();
}

// ---------------------------------------------------------------- the two worlds ---------------------------------------------------------------
function drawBwWorld(ctx, T, S) {
  const B = T.boil;
  ctx.drawImage(layer(S, 'bwsky|' + B, (g) => drawSky(g, B, S, BW)), 0, 0, 1920, 1080);
  drawClouds(ctx, B, BW, T.t);
  ctx.drawImage(layer(S, 'bwfar|' + B, (g) => { drawFar(g, B, BW); castleSketch(g, B, S); }), 0, 0, 1920, 1080);
  ctx.drawImage(layer(S, 'bwmid|' + B, (g) => drawMid(g, B, BW)), 0, 0, 1920, 1080);
  // a few graphite tufts of grass along the road
  for (let i = 0; i < 14; i++) {
    const x = 240 + hash(i, 9, 1) * 1440, y = 850 + hash(i, 9, 2) * 90; if (Math.abs(x - 880) < 330 && y > 860) continue;
    const g1 = [[x, y], [x - 5, y - 16], [x - 1, y - 4], [x + 4, y - 20], [x + 3, y - 4], [x + 11, y - 15], [x + 8, y]];
    P.ink(ctx, g1, { closed: false, color: '#4A4A52', width: 2, boil: B, seed: 1200 + i, amp: 0.6, passes: 1, step: 8, alpha: 0.8 });
  }
  drawAmritaGray(ctx, T, S);
}
function drawColorWorld(ctx, T, S) {
  const B = T.boil, lt = T.lt, t = T.t, settled = lt > 0.95;
  ctx.drawImage(layer(S, 'sky|' + B, (g) => drawSky(g, B, S, COL)), 0, 0, 1920, 1080);
  drawClouds(ctx, B, COL, t);
  ctx.drawImage(layer(S, 'far|' + B, (g) => drawFar(g, B, COL)), 0, 0, 1920, 1080);
  // castle: sprouts as the wavefront arrives, cached once settled
  const ks = settled ? null : castleK(lt);
  if (settled) ctx.drawImage(layer(S, 'castle|' + B, (g) => drawCastle(g, B, null, S)), 0, 0, 1920, 1080);
  else drawCastle(ctx, B, ks, S);
  const wk = settled ? 1 : outBack(clamp((lt - hitTime(PT.cx, PT.cy) - 0.08) / 0.3), 1.4);
  if (wk > 0.001) drawWindow(ctx, B, t, wk);
  drawGlints(ctx, B, t, ks);
  ctx.drawImage(layer(S, 'mid|' + B, (g) => drawMid(g, B, COL)), 0, 0, 1920, 1080);
  FLOWERS.forEach((f) => { const k = settled ? 1 : outBack(clamp((lt - hitTime(f.x, f.y - f.st) - 0.02) / 0.34), 1.7); if (k > 0.01) drawFlower(ctx, B, f, t, k, COL); });
  drawTrail(ctx, B, t);
  drawAmritaColor(ctx, T, S);
  drawSparkles(ctx, B, t);
}
function drawBloomRim(ctx, T) {
  const lt = T.lt, B = T.boil; if (lt <= 0 || lt > BLOOM_T + 0.04) return;
  const pts = bloomPts(lt, B), R = bloomR(lt), fade = 1 - smooth((lt - BLOOM_T * 0.82) / (BLOOM_T * 0.2));
  if (fade <= 0.01) return;
  ctx.save(); ctx.globalAlpha = fade;
  // three mis-registered records: cyan / magenta / yellow
  [['#22D6FF', 14, 11], ['#FF3BA8', 0, 8], ['#FFE53A', -12, 7]].forEach(([c, dr, w], i) => {
    const sc = (R + dr) / R, pp = pts.map(([x, y]) => [BLOOM_C[0] + (x - BLOOM_C[0]) * sc, BLOOM_C[1] + (y - BLOOM_C[1]) * sc]);
    P.ink(ctx, pp, { closed: true, color: c, width: w, boil: T.boil + i, seed: 1500 + i * 7, amp: 2.0, passes: 2, step: 12, alpha: 0.92 });
  });
  const pp = pts.map(([x, y]) => [BLOOM_C[0] + (x - BLOOM_C[0]) * (R - 22) / R, BLOOM_C[1] + (y - BLOOM_C[1]) * (R - 22) / R]);
  P.ink(ctx, pp, { closed: true, color: '#FFFFFF', width: 5, boil: B, seed: 1520, amp: 1.5, passes: 2, step: 12, alpha: 0.9 });
  // star glints riding the wavefront
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * TAU + hash(i, 4, 1) * 0.3, rr = R * (1 + 0.02 * Math.sin(a * 3 + B)), x = BLOOM_C[0] + Math.cos(a) * rr, y = BLOOM_C[1] + Math.sin(a) * rr * 0.97;
    if (x < 200 || x > 1720 || y < -20 || y > 1100) continue;
    if (hash(i, B, 41) < 0.4) continue;
    drawStar(ctx, B, x, y, 10 + 12 * hash(i, 4, 2), SPARK_COLS[i % 5], 0.95, 1600 + i);
  }
  ctx.restore();
}

export default {
  id: 'e1939', kind: '2d',
  draw(ctx, T, S) {
    const lt = T.lt, R = bloomR(lt);
    ctx.save();
    if (R > 1) drawColorWorld(ctx, T, S);
    if (R < BLOOM_MAX * 0.98) {
      ctx.save();
      if (R > 1) { const pts = bloomPts(lt, T.boil); ctx.beginPath(); ctx.rect(-50, -50, 2020, 1180); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.clip('evenodd'); }
      drawBwWorld(ctx, T, S);
      ctx.restore();
    }
    drawBloomRim(ctx, T);
    // paper grain over everything: the whole film is a drawing
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.42; P.paper(ctx, S, { seed: 39, base: '#F2EEE6', shade: '#E2DACB' }); ctx.restore();
    ctx.restore();
    // the portal must be pristine for the dive
    if (lt >= 1.4) { ctx.save(); ctx.beginPath(); ctx.arc(PT.cx, PT.cy, PT.r, 0, TAU); ctx.clip(); drawWindow(ctx, T.boil, T.t, 1); ctx.restore(); }
  },
  grade: () => ({}),
  barColor: '#0b0a0d',
};
