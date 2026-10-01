// =============================================================================
// pencil.js — the Act I "paper & pencil" drawing toolkit.
// Look: off-white paper, FLAT OFFSET color fill (mis-registered from the outline), colored-pencil HATCHING,
// DOUBLED WOBBLY INK outline, hand lettering. Everything re-jitters at 12 fps ("boil"): pass T.boil.
// All functions are pure functions of their arguments (seeded hashing) — no state between frames.
// Coordinates are the 1920x1080 logical space (ctx is pre-scaled by the engine).
// =============================================================================
import { hash, noise1, noise2, rng, fbm2 } from './rng.js';
import { clamp, lerp } from './ease.js';

// ---------- colour helpers --------------------------------------------------
export function hex2rgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgb2hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
export function mix(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return rgb2hex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}
export const lighten = (c, t) => mix(c, '#ffffff', t);
export const darken = (c, t) => mix(c, '#000000', t);
export function rgba(c, a = 1) { const [r, g, b] = hex2rgb(c); return `rgba(${r},${g},${b},${a})`; }

// ---------- path helpers (point arrays [[x,y],...]) -------------------------
export const circlePts = (cx, cy, r, n = 40, rot = 0) => Array.from({ length: n }, (_, i) => { const a = rot + (i / n) * Math.PI * 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
export const ellipsePts = (cx, cy, rx, ry, rot = 0, n = 40) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry; return [cx + x * c - y * s, cy + x * s + y * c]; });
};
export function rectPts(x, y, w, h, rad = 0, n = 6) {
  if (rad <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  rad = Math.min(rad, w / 2, h / 2);
  const out = [], corner = (cx, cy, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * (Math.PI / 2); out.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); } };
  corner(x + w - rad, y + rad, -Math.PI / 2); corner(x + w - rad, y + h - rad, 0); corner(x + rad, y + h - rad, Math.PI / 2); corner(x + rad, y + rad, Math.PI);
  return out;
}
export function bezier(p0, p1, p2, p3, n = 16) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return out;
}
// Catmull-Rom smoothing of a control polygon into a dense polyline.
export function smoothPts(pts, { closed = false, n = 8, tension = 0.5 } = {}) {
  const N = pts.length, out = [];
  const get = (i) => (closed ? pts[((i % N) + N) % N] : pts[clamp(i, 0, N - 1)]);
  const segs = closed ? N : N - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((d) => 0.5 * ((2 * p1[d]) + (-p0[d] + p2[d]) * t * 2 * tension + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 * 2 * tension + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3 * 2 * tension)));
    }
  }
  if (!closed) out.push(pts[N - 1].slice());
  return out;
}
// Parse an SVG path string (M L H V C Q Z, absolute & relative) into [{pts, closed}].
export function svgPts(d, n = 14) {
  const tok = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const subs = []; let cur = null, x = 0, y = 0, sx = 0, sy = 0, i = 0, cmd = '';
  const num = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === 'Z') { if (cur) { cur.closed = true; x = sx; y = sy; } continue; }
    if (C === 'M') { x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); sx = x; sy = y; cur = { pts: [[x, y]], closed: false }; subs.push(cur); cmd = rel ? 'l' : 'L'; continue; }
    if (C === 'L') { x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); cur.pts.push([x, y]); continue; }
    if (C === 'H') { x = (rel ? x : 0) + num(); cur.pts.push([x, y]); continue; }
    if (C === 'V') { y = (rel ? y : 0) + num(); cur.pts.push([x, y]); continue; }
    if (C === 'C') {
      const a = [(rel ? x : 0) + num(), (rel ? y : 0) + num()], b = [(rel ? x : 0) + num(), (rel ? y : 0) + num()], e = [(rel ? x : 0) + num(), (rel ? y : 0) + num()];
      bezier([x, y], a, b, e, n).slice(1).forEach((p) => cur.pts.push(p)); x = e[0]; y = e[1]; continue;
    }
    if (C === 'Q') {
      const a = [(rel ? x : 0) + num(), (rel ? y : 0) + num()], e = [(rel ? x : 0) + num(), (rel ? y : 0) + num()];
      const c1 = [x + (2 / 3) * (a[0] - x), y + (2 / 3) * (a[1] - y)], c2 = [e[0] + (2 / 3) * (a[0] - e[0]), e[1] + (2 / 3) * (a[1] - e[1])];
      bezier([x, y], c1, c2, e, n).slice(1).forEach((p) => cur.pts.push(p)); x = e[0]; y = e[1]; continue;
    }
    i++; // unsupported command: skip token
  }
  return subs;
}
export function xform(pts, { x = 0, y = 0, sx = 1, sy = sx, rot = 0, ox = 0, oy = 0 } = {}) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return pts.map(([px, py]) => { const a = (px - ox) * sx, b = (py - oy) * sy; return [x + a * c - b * s, y + a * s + b * c]; });
}
export function bounds(pts) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
// even re-sampling so wobble is uniform along a path regardless of vertex density
export function resample(pts, step = 12, closed = false) {
  const P = closed ? [...pts, pts[0]] : pts, out = [P[0].slice()];
  let acc = 0;
  for (let i = 1; i < P.length; i++) {
    let [ax, ay] = P[i - 1]; const [bx, by] = P[i];
    let seg = Math.hypot(bx - ax, by - ay);
    while (acc + seg >= step) {
      const t = (step - acc) / seg; ax += (bx - ax) * t; ay += (by - ay) * t; out.push([ax, ay]); seg = Math.hypot(bx - ax, by - ay); acc = 0;
    }
    acc += seg;
  }
  if (!closed) out.push(P[P.length - 1].slice());
  return out;
}

// ---------- the boil --------------------------------------------------------
// Offsets re-randomise every `boil` step (12 per second) but are coherent along the line.
export function wobble(pts, { boil = 0, amp = 1.5, seed = 0, scale = 0.28, closed = false } = {}) {
  const N = pts.length, out = new Array(N);
  for (let i = 0; i < N; i++) {
    const u = closed ? (i / N) * (N * scale) : i * scale;
    const s = seed * 7919 + boil * 131;
    const dx = noise1(u, s) * amp + noise1(i * 1.9, s + 17) * amp * 0.25;
    const dy = noise1(u, s + 555) * amp + noise1(i * 1.9, s + 911) * amp * 0.25;
    out[i] = [pts[i][0] + dx, pts[i][1] + dy];
  }
  return out;
}
function trace(ctx, pts, closed) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (closed) ctx.closePath();
}

// ---------- core drawing ----------------------------------------------------
// Doubled wobbly ink outline with pressure-varying width.
export function ink(ctx, pts, { closed = true, color = '#2A2833', width = 3, passes = 2, amp = 1.6, boil = 0, seed = 1, alpha = 0.95, step = 9, taper = false } = {}) {
  const base = resample(pts, step, closed);
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color;
  for (let p = 0; p < passes; p++) {
    const w = wobble(base, { boil, amp: amp * (p === 0 ? 1 : 1.35), seed: seed + p * 31, closed });
    const n = w.length, chunk = 4;
    for (let i = 0; i < n - 1 + (closed ? 1 : 0); i += chunk) {
      const pr = 0.65 + 0.6 * (noise1(i * 0.17, seed * 13 + p * 97 + boil * 3) * 0.5 + 0.5);
      let tp = 1;
      if (taper && !closed) { const u = i / n; tp = clamp(Math.min(u, 1 - u) * 6, 0.25, 1); }
      ctx.globalAlpha = alpha * (p === 0 ? 1 : 0.7);
      ctx.lineWidth = Math.max(0.6, width * pr * tp * (p === 0 ? 1 : 0.78));
      ctx.beginPath(); ctx.moveTo(w[i][0], w[i][1]);
      for (let k = 1; k <= chunk + 1 && i + k < n + (closed ? 1 : 0); k++) { const q = w[(i + k) % n]; ctx.lineTo(q[0], q[1]); }
      ctx.stroke();
    }
  }
  ctx.restore();
}
// Flat colour fill, offset from the outline (mis-registration), pigment-on-paper via multiply.
export function fill(ctx, pts, { color = '#F2542D', offset = [4, 3], boil = 0, amp = 1.4, alpha = 1, seed = 2, comp = 'multiply', closed = true } = {}) {
  const w = wobble(resample(pts, 14, closed), { boil, amp, seed: seed + 3, closed });
  ctx.save(); ctx.globalCompositeOperation = comp; ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.translate(offset[0], offset[1]); trace(ctx, w, true); ctx.fill(); ctx.restore();
}
// Colored-pencil hatching clipped to the shape. shade(x,y)->0..1 optionally modulates density (gradient hatching).
export function hatch(ctx, pts, { color = '#C0431F', angle = -0.75, gap = 7, width = 1.3, alpha = 0.65, boil = 0, seed = 3, jitter = 1.2, cross = 0, shade = null, comp = 'multiply', margin = 0, segLen = 38 } = {}) {
  const b = bounds(pts), R = Math.hypot(b.w, b.h) / 2 + 6;
  ctx.save(); trace(ctx, pts, true); ctx.clip();
  ctx.globalCompositeOperation = comp; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineWidth = width;
  const dirs = cross ? [angle, angle + Math.PI / 2 + 0.25] : [angle];
  dirs.forEach((ang, di) => {
    const c = Math.cos(ang), s = Math.sin(ang), nx = -s, ny = c;
    const lines = Math.ceil((R * 2) / gap);
    for (let li = 0; li < lines; li++) {
      const off = -R + li * gap + (hash(li, seed, di) - 0.5) * gap * 0.5 + noise1(li * 0.31, seed + boil * 7) * jitter;
      const ox = b.cx + nx * off, oy = b.cy + ny * off;
      let t0 = -R, guard = 0;
      while (t0 < R && guard++ < 400) {
        const len = segLen * (0.6 + hash(li, Math.floor((t0 + R) / segLen), seed + 5 * di) * 0.9);
        const t1 = Math.min(R, t0 + len);
        const mx = ox + c * (t0 + t1) / 2, my = oy + s * (t0 + t1) / 2;
        const dens = shade ? shade(mx, my) : 1;
        if (hash(li, Math.floor(t0), seed + 11) < dens * (0.55 + margin) || (shade == null)) {
          const j = (k) => noise1(li * 0.7 + k, seed * 3 + boil * 5) * jitter;
          ctx.globalAlpha = alpha * (0.6 + 0.4 * hash(li, Math.floor(t0), seed + 7));
          ctx.beginPath();
          ctx.moveTo(ox + c * t0 + nx * j(0), oy + s * t0 + ny * j(0));
          ctx.quadraticCurveTo(ox + c * (t0 + t1) / 2 + nx * j(1) * 1.5, oy + s * (t0 + t1) / 2 + ny * j(1) * 1.5, ox + c * t1 + nx * j(2), oy + s * t1 + ny * j(2));
          ctx.stroke();
        }
        t0 = t1 + gap * (0.15 + hash(li, Math.floor(t0), seed + 13) * 0.6);
      }
    }
  });
  ctx.restore();
}
// Everything at once: fill + hatch + ink. o.fill / o.hatch / o.ink are option objects or false.
export function shape(ctx, pts, o = {}) {
  const common = { boil: o.boil ?? 0, seed: o.seed ?? 1 };
  if (o.fill !== false && o.fill) fill(ctx, pts, { ...common, ...(typeof o.fill === 'string' ? { color: o.fill } : o.fill) });
  if (o.hatch) hatch(ctx, pts, { ...common, ...(typeof o.hatch === 'string' ? { color: o.hatch } : o.hatch) });
  if (o.ink !== false) ink(ctx, pts, { ...common, closed: o.closed ?? true, ...(typeof o.ink === 'string' ? { color: o.ink } : o.ink || {}) });
}
// Pencil line between two (or more) points.
export function line(ctx, pts, o = {}) { ink(ctx, pts, { closed: false, passes: 2, width: 2.2, amp: 1.2, taper: true, ...o }); }
// Soft graphite / colored smudge (radial).
export function smudge(ctx, x, y, r, { color = '#2A2833', alpha = 0.18, comp = 'multiply' } = {}) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha)); g.addColorStop(1, rgba(color, 0));
  ctx.save(); ctx.globalCompositeOperation = comp; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
// Scribbled filled region (back and forth), for dark masses.
export function scribbleFill(ctx, pts, o = {}) { hatch(ctx, pts, { gap: 4, width: 1.6, alpha: 0.8, cross: 1, ...o }); }

// ---------- hand lettering --------------------------------------------------
// reveal 0..1 writes the text on left-to-right (per glyph, with pen-pressure fade on the leading glyph).
export function text(ctx, str, x, y, { font = '60px Caveat', color = '#2A2833', align = 'left', baseline = 'alphabetic', boil = 0, amp = 1.3, reveal = 1, rotate = 0, seed = 5, alpha = 1, stroke = 0, strokeColor = '#F2EBDC', comp = 'source-over', spacing = 0, doubled = true } = {}) {
  ctx.save(); ctx.font = font; ctx.textBaseline = baseline; ctx.textAlign = 'left'; ctx.globalCompositeOperation = comp;
  const chars = [...str]; const widths = chars.map((c) => ctx.measureText(c).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const shown = reveal * chars.length;
  ctx.translate(0, 0);
  for (let i = 0; i < chars.length; i++) {
    const a = clamp(shown - i, 0, 1);
    if (a > 0 && chars[i] !== ' ') {
      const jx = noise1(i * 0.9, seed + boil * 17) * amp, jy = noise1(i * 0.9, seed + 99 + boil * 17) * amp, jr = noise1(i * 0.7, seed + 7 + boil * 11) * 0.035;
      ctx.save(); ctx.translate(cx + widths[i] / 2 + jx, y + jy); ctx.rotate(rotate + jr);
      ctx.globalAlpha = alpha * a;
      if (stroke) { ctx.lineWidth = stroke; ctx.strokeStyle = strokeColor; ctx.lineJoin = 'round'; ctx.strokeText(chars[i], -widths[i] / 2, 0); }
      ctx.fillStyle = color; ctx.fillText(chars[i], -widths[i] / 2, 0);
      if (doubled) { ctx.globalAlpha = alpha * a * 0.35; ctx.fillText(chars[i], -widths[i] / 2 + 0.9, 0.7); }
      ctx.restore();
    }
    cx += widths[i];
  }
  ctx.restore();
  return { width: total, x: align === 'center' ? x - total / 2 : align === 'right' ? x - total : x };
}
export function measure(ctx, str, font, spacing = 0) { ctx.save(); ctx.font = font; const w = [...str].reduce((a, c) => a + ctx.measureText(c).width + spacing, 0); ctx.restore(); return w; }
// hand-drawn underline stroke (animated by reveal)
export function underline(ctx, x0, x1, y, { color = '#F2542D', width = 4, boil = 0, seed = 9, reveal = 1 } = {}) {
  const n = 14, pts = [];
  for (let i = 0; i <= n * reveal; i++) { const u = i / n; pts.push([lerp(x0, x1, u), y + Math.sin(u * 5 + seed) * 2.5 + noise1(i * 0.6, seed) * 1.5]); }
  if (pts.length > 1) ink(ctx, pts, { closed: false, color, width, amp: 1.3, boil, seed, passes: 2, taper: true });
}

// ---------- paper -----------------------------------------------------------
const paperCache = new Map();
export function paperCanvas(w, h, { seed = 1, base = '#F2EBDC', shade = '#E6DCC6', creases = false } = {}) {
  const key = [w, h, seed, base, shade, creases].join('|');
  if (paperCache.has(key)) return paperCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), r = rng(seed * 101 + 7), k = w / 1920;
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  // large soft mottling
  for (let i = 0; i < 46; i++) {
    const x = r() * w, y = r() * h, rad = (160 + r() * 380) * k, a = 0.025 + r() * 0.05;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, rgba(r() < 0.5 ? shade : '#FFFFFF', a)); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // fibres
  g.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const x = r() * w, y = r() * h, a = r() * Math.PI * 2, l = (6 + r() * 26) * k;
    g.strokeStyle = r() < 0.5 ? 'rgba(120,100,70,0.07)' : 'rgba(255,255,255,0.18)'; g.lineWidth = Math.max(0.5, (0.5 + r() * 0.8) * k);
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.5) * l * 0.5, y + Math.sin(a + 0.5) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  // grain
  const id = g.getImageData(0, 0, w, h), d = id.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const x = p % w, y = (p / w) | 0, n = (hash(x, y, seed) - 0.5) * 16 + (hash(x >> 2, y >> 2, seed + 1) - 0.5) * 7;
    d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.95;
  }
  g.putImageData(id, 0, 0);
  if (creases) {
    g.strokeStyle = 'rgba(90,70,40,0.10)'; g.lineWidth = 2 * k;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(r() * w, 0); g.lineTo(r() * w, h); g.stroke(); }
  }
  // edge darkening
  const vg = g.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, w * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(70,50,20,0.18)');
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
  paperCache.set(key, c);
  return c;
}
// Draw the paper full-bleed into the 1920x1080 logical space.
export function paper(ctx, S, o = {}) {
  const c = paperCanvas(Math.round(1920 * S.scale), Math.round(1080 * S.scale), o);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(c, 0, 0); ctx.restore();
}

export default {
  hex2rgb, rgb2hex, mix, lighten, darken, rgba,
  circlePts, ellipsePts, rectPts, bezier, smoothPts, svgPts, xform, bounds, resample,
  wobble, ink, fill, hatch, shape, line, smudge, scribbleFill, text, measure, underline, paperCanvas, paper,
};
