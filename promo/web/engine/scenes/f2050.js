// =============================================================================
// f2050 — 2050 · HOLOGRAM CINEMA (42.0–44.0, 2.39).  A cozy living room at night; a family of four (abstract bean silhouettes, seen from
// behind) on the sofa; from the coffee table a HOLOGRAPHIC FILM blooms: a teal projector trumpet + a floating volumetric cinema screen
// (parallax layers + a tiny 3D diorama: moon, hills, a road, rails, a locomotive) and Amrita herself, as a hologram, directing it with her slate.
// Warm tungsten room (floor lamp, glowing book spines, city window) versus the teal hologram: complementary colour separation.
//
//   lt 0.00  HIT M year-jump: glitch-in (stepped camera, RGB split, sliced rows, scan bars), projector bloom, Amrita scans in
//   lt 0.20  pane unfolds, parallax layers fly apart into depth, content scans in bottom -> top
//   lt 0.50  GASP: family leans in (awe), the loco headlamp flares on the far horizon of the diorama and it starts to roll toward us
//   lt 1.00  POP: the miniature loco breaks through the screen plane (ring shock, flash, flare), kid points, family flinches back
//   lt 1.25  LAUGH: toot + steam puff, the parents bob, Amrita goes ^ ^ and spins her slate
//   lt 1.50  SNAP: loco dissolves into light sparks, Amrita snaps the slate (squash punch, glow, sparkle burst)
//   lt 1.75  'OH': the moon rises/glows, heads tilt up, whole hologram swells and surges into the next scene
// Everything is a pure function of T.t / T.lt (4 sub-frames per frame = motion blur). No Math.random / Date.now: seeded hashing only.
// Camera: slow dolly-in over the sofa's shoulder, 35 mm, DOF racks focus Amrita -> loco -> Amrita.  Bloom 0.5+, haze, rim on Amrita.
// =============================================================================
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCouchGroup } from '../crowd3d.js';
import { createAmrita, addPose, hover, punch, settle } from '../amrita3d.js';
import { createHaze, createBeam, glowSprite, lensFlare, roundedRectShape, pxScale } from '../fx3d.js';
import { hash, rng as mkRng } from '../rng.js';
import { spring } from '../ease.js';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const seg = (x, a, b) => clamp((x - a) / (b - a));
const outBack = (x, s = 1.70158) => { x = clamp(x) - 1; return x * x * ((s + 1) * x + s) + 1; };
const outCubic = (x) => 1 - (1 - clamp(x)) ** 3;
const env = (lt, t0, tau) => (lt < t0 ? 0 : Math.exp(-(lt - t0) / tau)); // decaying pulse
const H = (...v) => hash(...v);

// ---- events (seconds since scene start; the 120 BPM beat grid: every 0.5 s) ----------------------------------------------------------
const EV = { hit: 0, gasp: 0.5, pop: 1.0, laugh: 1.25, snap: 1.5, oh: 1.75 };

// ---- world layout (meters, +Y up, camera looks toward -Z) ----------------------------------------------------------------------------
const BACK = -4.2;                       // back wall z
const PANE = { x: 0.3, y: 1.5, z: 0.65, w: 2.3, h: 1.045, d: 0.5 }; // floating cinema screen (centre)
const TABLE = { x: 0.05, z: 0.9, top: 0.4 };
const EMIT = [0.3, TABLE.top + 0.03, 0.84];
const AMR = [-0.72, 1.06, 1.25];         // Amrita hologram centre
const SOFA = [0.0, 0.0, 2.85];          // couch group origin (family faces -Z)
const LAMP = [2.15, 0, -0.1];
const WIN = { x: 2.3, y: 1.62, w: 1.9, h: 1.55 };
const SHELF = { x: -4.0, w: 1.7, h: 2.35, d: 0.34 };

// ---- tiny canvas helpers --------------------------------------------------------------------------------------------------------------
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function tex(THREE, c, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true; return t;
}
function fbm1(x, seed) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { const xi = Math.floor(x * f), fx = x * f - xi, u = fx * fx * (3 - 2 * fx); s += a * (lerp(H(xi, seed + i), H(xi + 1, seed + i), u) * 2 - 1); f *= 2; a *= 0.5; } return s; }

function plankCanvas() {
  const W = 1024, Hh = 1024, c = cv(W, Hh), g = c.getContext('2d'), r = mkRng(7), n = 8, bw = W / n;
  for (let i = 0; i < n; i++) {
    const v = 0.8 + 0.45 * r(); let y = 0;
    while (y < Hh) {
      const len = 280 + r() * 520, k = 0.84 + 0.3 * r(), L = Math.min(len, Hh - y);
      g.fillStyle = `rgb(${(104 * v * k) | 0},${(70 * v * k) | 0},${(46 * v * k) | 0})`; g.fillRect(i * bw, y, bw, L);
      for (let q = 0; q < 30; q++) { const x = i * bw + r() * bw; g.strokeStyle = `rgba(34,18,9,${0.05 + 0.13 * r()})`; g.lineWidth = 0.6 + r() * 1.5; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + (r() - 0.5) * 7, y + L * 0.3, x + (r() - 0.5) * 7, y + L * 0.6, x + (r() - 0.5) * 5, y + L); g.stroke(); }
      g.fillStyle = 'rgba(12,7,4,0.8)'; g.fillRect(i * bw, y, bw, 2.2); y += len;
    }
    g.fillStyle = 'rgba(10,6,3,0.85)'; g.fillRect(i * bw - 1, 0, 2.6, Hh);
  }
  return c;
}
function rugCanvas() {
  const W = 1024, Hh = 760, c = cv(W, Hh), g = c.getContext('2d'), r = mkRng(5);
  g.fillStyle = '#d9c7a1'; g.fillRect(0, 0, W, Hh);
  for (let i = 0; i < 14000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,246,226' : '110,84,52'},${0.04 + 0.07 * r()})`; g.fillRect(r() * W, r() * Hh, 2 + r() * 3, 1.2); }
  const frame = (inset, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.strokeRect(inset, inset, W - 2 * inset, Hh - 2 * inset); };
  frame(16, 30, '#26414a'); frame(52, 7, '#c4572d'); frame(70, 3, '#26414a'); frame(84, 10, '#e0a93c');
  g.save(); g.beginPath(); g.rect(100, 100, W - 200, Hh - 200); g.clip();
  const s = 96, cols = ['#c4572d', '#26414a', '#e0a93c'];
  for (let yy = -1; yy < Hh / (s * 0.9) + 1; yy++) for (let xx = -1; xx < W / s + 1; xx++) {
    const cx = xx * s + (yy & 1 ? s / 2 : 0), cy = yy * s * 0.9, k = (xx + yy * 2 + 9) % 3;
    g.fillStyle = cols[k]; g.globalAlpha = 0.9; g.beginPath(); g.moveTo(cx, cy - 34); g.lineTo(cx + 28, cy); g.lineTo(cx, cy + 34); g.lineTo(cx - 28, cy); g.closePath(); g.fill();
    g.globalAlpha = 1; g.fillStyle = '#efe0bf'; g.beginPath(); g.moveTo(cx, cy - 13); g.lineTo(cx + 10, cy); g.lineTo(cx, cy + 13); g.lineTo(cx - 10, cy); g.closePath(); g.fill();
  }
  g.restore();
  for (let i = 0; i < 90; i++) { g.strokeStyle = 'rgba(235,222,190,0.8)'; g.lineWidth = 3; g.beginPath(); g.moveTo(i * (W / 90) + 4, 0); g.lineTo(i * (W / 90) + 4, 12); g.moveTo(i * (W / 90) + 4, Hh); g.lineTo(i * (W / 90) + 4, Hh - 12); g.stroke(); }
  return c;
}
function plasterCanvas() {
  const c = cv(512, 512), g = c.getContext('2d'), r = mkRng(31);
  g.fillStyle = '#7a6454'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,236,210' : '40,24,14'},${0.025 + 0.04 * r()})`; g.beginPath(); g.arc(r() * 512, r() * 512, 1 + r() * 5, 0, TAU); g.fill(); }
  return c;
}
// the city beyond the window (emissive): sky gradient, far / mid / near skyline with lit windows, signs, a flying-car lane, moon
function skylineCanvas() {
  const W = 1024, Hh = 860, c = cv(W, Hh), g = c.getContext('2d'), r = mkRng(77);
  const sky = g.createLinearGradient(0, 0, 0, Hh);
  sky.addColorStop(0, '#0b1230'); sky.addColorStop(0.28, '#1f2d62'); sky.addColorStop(0.48, '#5a3d78'); sky.addColorStop(0.66, '#c2607a'); sky.addColorStop(0.8, '#f4a265'); sky.addColorStop(1, '#ffd29a');
  g.fillStyle = sky; g.fillRect(0, 0, W, Hh);
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,245,230,${0.2 + 0.7 * r()})`; g.fillRect(r() * W, r() * Hh * 0.45, 1.3, 1.3); }
  const mg = g.createRadialGradient(150, 130, 4, 150, 130, 120); mg.addColorStop(0, 'rgba(255,248,230,1)'); mg.addColorStop(0.18, 'rgba(255,240,215,0.95)'); mg.addColorStop(0.2, 'rgba(255,230,200,0.25)'); mg.addColorStop(1, 'rgba(255,230,200,0)'); g.fillStyle = mg; g.fillRect(0, 0, 400, 300);
  const layer = (base, hMin, hMax, col, win, wcol, seed) => {
    const rr2 = mkRng(seed); let x = -10;
    while (x < W) {
      const bw = 34 + rr2() * 70, bh = hMin + rr2() * (hMax - hMin); g.fillStyle = col; g.fillRect(x, base - bh, bw, bh + 40);
      if (rr2() < 0.18) { g.fillRect(x + bw * 0.45, base - bh - 26 - rr2() * 30, 3, 40); g.fillStyle = '#ff4a3a'; g.fillRect(x + bw * 0.45 - 1, base - bh - 28, 5, 5); g.fillStyle = col; }
      for (let wy = base - bh + 8; wy < base - 6; wy += 11) for (let wx = x + 5; wx < x + bw - 6; wx += 9) if (rr2() < win) { g.fillStyle = wcol[Math.floor(rr2() * wcol.length)]; g.globalAlpha = 0.45 + 0.55 * rr2(); g.fillRect(wx, wy, 4, 5); g.globalAlpha = 1; }
      x += bw + 2 + rr2() * 8;
    }
  };
  layer(Hh * 0.82, 90, 250, '#2e2858', 0.22, ['#ffd9a0', '#ffb15a', '#ffe9c4'], 3);
  layer(Hh * 0.9, 110, 330, '#1a1840', 0.3, ['#ffd9a0', '#ffb15a', '#8ff0e5', '#ff7aa8'], 4);
  layer(Hh * 0.98, 80, 210, '#0a0c20', 0.34, ['#ffd9a0', '#ffc070', '#7ff0e0'], 5);
  for (const [x, y, col, w] of [[620, 330, '#2ff0dc', 70], [300, 410, '#ff4fa0', 54], [820, 470, '#ffb62e', 60]]) { g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 18; g.fillRect(x, y, w, 10); g.shadowBlur = 0; }
  const fg = g.createLinearGradient(0, Hh * 0.7, 0, Hh); fg.addColorStop(0, 'rgba(255,170,100,0)'); fg.addColorStop(1, 'rgba(255,170,100,0.35)'); g.fillStyle = fg; g.fillRect(0, Hh * 0.7, W, Hh * 0.3);
  return c;
}
// framed print on the wall: Amrita's aperture + play-triangle mark (a brand easter egg in the room)
function posterCanvas() {
  const W = 400, Hh = 520, c = cv(W, Hh), g = c.getContext('2d');
  g.fillStyle = '#0e0d12'; g.fillRect(0, 0, W, Hh); g.fillStyle = '#f2ebdc'; g.fillRect(16, 16, W - 32, Hh - 32); g.fillStyle = '#17202a'; g.fillRect(34, 34, W - 68, Hh - 68);
  const cx = W / 2, cy = Hh * 0.43, R = 120, cols = ['#f2542d', '#ffb62e'];
  for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; g.fillStyle = cols[i & 1]; g.beginPath(); g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.lineTo(cx + Math.cos(a + 1.0) * R, cy + Math.sin(a + 1.0) * R); g.lineTo(cx + Math.cos(a + 1.05) * R * 0.3, cy + Math.sin(a + 1.05) * R * 0.3); g.closePath(); g.fill(); }
  g.fillStyle = '#fff3d6'; g.beginPath(); g.moveTo(cx - 36, cy - 52); g.lineTo(cx + 62, cy); g.lineTo(cx - 36, cy + 52); g.closePath(); g.fill();
  g.fillStyle = '#0e0d12'; g.beginPath(); g.ellipse(cx - 16, cy - 14, 6, 11, 0, 0, TAU); g.ellipse(cx - 16, cy + 14, 6, 11, 0, 0, TAU); g.fill();
  g.fillStyle = '#f2ebdc'; g.font = '700 34px "Bebas Neue", Oswald, sans-serif'; g.textAlign = 'center'; g.fillText('DIRECTED', cx, Hh - 112); g.fillText('BY AMRITA', cx, Hh - 72);
  return c;
}

// ---- hologram pane content: 5 parallax layers painted once (seeded) ------------------------------------------------------------------
const PW = 1152, PH = 524; // pane texture size (2.2 : 1)
const MOON = { u: 0.70, v: 0.27, r: 0.10 }; // moon centre in pane uv (v from top), radius in units of pane height
function paneSkyCanvas() {
  const c = cv(PW, PH), g = c.getContext('2d'), r = mkRng(101);
  const gr = g.createLinearGradient(0, 0, 0, PH);
  gr.addColorStop(0, '#07102a'); gr.addColorStop(0.38, '#0c3052'); gr.addColorStop(0.68, '#17808f'); gr.addColorStop(0.86, '#45d6cb'); gr.addColorStop(1, '#8af5e4');
  g.fillStyle = gr; g.fillRect(0, 0, PW, PH);
  for (let k = 0; k < 3; k++) { // soft aurora ribbons
    g.save(); g.globalAlpha = 0.1 + 0.05 * k; g.fillStyle = k === 1 ? '#6b5bff' : '#2fe6c8'; g.beginPath(); g.moveTo(0, 120 + 40 * k);
    for (let x = 0; x <= PW; x += 24) g.lineTo(x, 110 + 50 * k + 40 * fbm1(x / 260 + k * 7, 5 + k) + 20 * Math.sin(x / 90 + k)); for (let x = PW; x >= 0; x -= 24) g.lineTo(x, 190 + 60 * k + 36 * fbm1(x / 300 + k * 9, 9 + k)); g.closePath(); g.fill(); g.restore();
  }
  for (let i = 0; i < 240; i++) { const s = r(); g.fillStyle = `rgba(210,245,255,${0.25 + 0.75 * r()})`; const sz = s > 0.96 ? 2.4 : s > 0.7 ? 1.6 : 1; g.fillRect(r() * PW, r() * PH * 0.7, sz, sz); }
  const mx = MOON.u * PW, my = MOON.v * PH, mr = MOON.r * PH;
  const hg = g.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 3.2); hg.addColorStop(0, 'rgba(170,255,245,0.55)'); hg.addColorStop(0.35, 'rgba(90,220,215,0.18)'); hg.addColorStop(1, 'rgba(90,220,215,0)'); g.fillStyle = hg; g.fillRect(mx - mr * 3.4, my - mr * 3.4, mr * 6.8, mr * 6.8);
  const mg = g.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr); mg.addColorStop(0, '#ffffff'); mg.addColorStop(0.7, '#dffcf6'); mg.addColorStop(1, '#9fe6dc'); g.fillStyle = mg; g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fill();
  g.save(); g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.clip(); for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(60,150,150,${0.1 + 0.12 * r()})`; g.beginPath(); g.arc(mx + (r() - 0.5) * mr * 1.6, my + (r() - 0.5) * mr * 1.6, mr * (0.06 + 0.16 * r()), 0, TAU); g.fill(); } g.restore();
  return c;
}
// silhouette ridge layer with a glowing rim line; trees: pines along the ridge, houses: tiny lit windows
function ridgeCanvas({ seed, base, amp, freq, fill, fillTop = null, rim, rimW = 3, trees = 0, treeH = 40, houses = 0, wings = false, alpha = 1 }) {
  const c = cv(PW, PH), g = c.getContext('2d'), r = mkRng(seed);
  const ys = []; for (let x = 0; x <= PW; x += 4) ys.push(base * PH + amp * PH * fbm1(x / freq, seed));
  const yAt = (x) => ys[clamp(Math.round(x / 4), 0, ys.length - 1)];
  const fg = g.createLinearGradient(0, base * PH - amp * PH * 0.6, 0, PH); fg.addColorStop(0, fillTop || fill); fg.addColorStop(1, fill);
  g.globalAlpha = alpha; g.fillStyle = fg; g.beginPath(); g.moveTo(0, PH); ys.forEach((y, i) => g.lineTo(i * 4, y)); g.lineTo(PW, PH); g.closePath(); g.fill(); g.globalAlpha = 1;
  const pine = (x, y, h, w) => { g.fillStyle = fill; for (let k = 0; k < 4; k++) { const yy = y - h * (k * 0.24), ww = w * (1 - k * 0.2); g.beginPath(); g.moveTo(x - ww, yy); g.lineTo(x, yy - h * 0.36); g.lineTo(x + ww, yy); g.closePath(); g.fill(); } g.fillRect(x - 1.5, y, 3, 8); };
  for (let i = 0; i < trees; i++) { const x = r() * PW, h = treeH * (0.6 + 0.8 * r()); pine(x, yAt(x) + 3, h, h * 0.22); }
  if (wings) for (const sx of [0.045, 0.1, 0.17, 0.83, 0.9, 0.955]) { const x = sx * PW, h = 230 + 120 * H(Math.round(sx * 100), 3); pine(x, PH + 4, h, h * 0.2); }
  g.strokeStyle = rim; g.lineWidth = rimW; g.shadowColor = rim; g.shadowBlur = 8; g.beginPath(); ys.forEach((y, i) => (i ? g.lineTo(i * 4, y) : g.moveTo(0, y))); g.stroke(); g.shadowBlur = 0;
  for (let i = 0; i < houses; i++) { const x = 90 + r() * (PW - 180), y = yAt(x) + 14 + r() * 22; g.fillStyle = '#ffc060'; g.shadowColor = '#ffb040'; g.shadowBlur = 6; g.fillRect(x, y, 4, 5); g.fillRect(x + 8, y + 1, 3, 4); g.shadowBlur = 0; }
  return c;
}
// the ground plane (tilted; v=0 far .. 1 near): ground tone, a winding road with amber dashes, and the railway the loco rides
const GW = 1536, GH = 384;
function groundCanvas() {
  const c = cv(GW, GH), g = c.getContext('2d'), r = mkRng(55);
  const gr = g.createLinearGradient(0, 0, 0, GH); gr.addColorStop(0, '#13606a'); gr.addColorStop(0.2, '#0a3d48'); gr.addColorStop(1, '#05222b'); g.fillStyle = gr; g.fillRect(0, 0, GW, GH);
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(60,200,190,${0.03 + 0.07 * r()})`; const y = r() * GH, k = 0.3 + 1.7 * (y / GH); g.fillRect(r() * GW, y, 3 * k, 1.2 * k); }
  for (let i = 1; i < 14; i++) { const y = GH * Math.pow(i / 14, 1.7); g.strokeStyle = `rgba(60,220,210,${0.05 + 0.1 * (y / GH)})`; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y); g.lineTo(GW, y); g.stroke(); }
  // road: winds from the far horizon toward the bottom-left
  const roadX = (v) => GW * (0.66 - 0.40 * v + 0.05 * Math.sin(v * 6.0 + 0.4)), roadW = (v) => 4 + 120 * v * v;
  g.fillStyle = '#1a3f4b'; g.beginPath(); for (let i = 0; i <= 60; i++) { const v = i / 60; g.lineTo(roadX(v) - roadW(v), v * GH); } for (let i = 60; i >= 0; i--) { const v = i / 60; g.lineTo(roadX(v) + roadW(v), v * GH); } g.closePath(); g.fill();
  g.strokeStyle = '#2fe0d0'; g.lineWidth = 2.4; g.shadowColor = '#2fe0d0'; g.shadowBlur = 6; for (const s of [-1, 1]) { g.beginPath(); for (let i = 0; i <= 60; i++) { const v = i / 60; if (i) g.lineTo(roadX(v) + s * roadW(v), v * GH); else g.moveTo(roadX(v) + s * roadW(v), v * GH); } g.stroke(); } g.shadowBlur = 0;
  g.strokeStyle = '#ffb62e'; g.shadowColor = '#ffb62e'; g.shadowBlur = 5; for (let k = 0; k < 14; k++) { const v0 = Math.pow(k / 14, 1.4), v1 = Math.pow((k + 0.5) / 14, 1.4); g.lineWidth = 1 + 7 * v0; g.beginPath(); g.moveTo(roadX(v0), v0 * GH); g.lineTo(roadX(v1), v1 * GH); g.stroke(); } g.shadowBlur = 0;
  // railway: straight diagonal from the far horizon (u .40) to the near edge (u .60) -- the loco rides exactly this line
  const tx = (v) => GW * (0.4 + 0.2 * v), gauge = (v) => 5 + 30 * v;
  for (let k = 0; k < 46; k++) { const v = Math.pow(k / 46, 1.5); g.strokeStyle = 'rgba(255,200,120,0.55)'; g.lineWidth = 1 + 4 * v; g.beginPath(); g.moveTo(tx(v) - gauge(v) * 1.5, v * GH); g.lineTo(tx(v) + gauge(v) * 1.5, v * GH); g.stroke(); }
  g.strokeStyle = '#8cfff0'; g.shadowColor = '#4cf0e0'; g.shadowBlur = 8; for (const s of [-1, 1]) { g.lineWidth = 2.2; g.beginPath(); g.moveTo(tx(0) + s * gauge(0), 0); g.lineTo(tx(1) + s * gauge(1), GH); g.stroke(); } g.shadowBlur = 0;
  const hz = g.createLinearGradient(0, 0, 0, 40); hz.addColorStop(0, 'rgba(110,255,240,0.5)'); hz.addColorStop(1, 'rgba(110,255,240,0)'); g.fillStyle = hz; g.fillRect(0, 0, GW, 40);
  return c;
}
// ground plane corners in pane-local space: far edge / near edge
const GR = { zf: -0.07, yf: -0.13, zn: 0.2, yn: -0.43 };
const gpos = (u, v) => [lerp(-PANE.w / 2, PANE.w / 2, u), lerp(GR.yf, GR.yn, v), lerp(GR.zf, GR.zn, v)]; // u 0..1 left->right, v 0 far .. 1 near

// =============================================================================================================================================
// shared GLSL materials (all share ONE time uniform object; every animated value is derived from it / from uniforms set in update())
// =============================================================================================================================================
const GLSL_H = `float h11(float n){ return fract(sin(n * 127.1) * 43758.5453); } float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`;

// a pane layer: painted texture + hologram scanlines + RGB-split glitch + bottom->top scan-in with a bright leading edge
function layerMaterial(THREE, uT, map, { additive = false, tint = [1, 1, 1], alpha = 1, scan = 0.18, size = [PANE.w, PANE.h] } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uT, uMap: { value: map }, uTint: { value: new THREE.Color(...tint) }, uA: { value: alpha }, uReveal: { value: 1.1 }, uGlitch: { value: 0 }, uFlick: { value: 1 }, uScan: { value: scan }, uSize: { value: new THREE.Vector2(...size) }, uPulse: { value: 0 } },
    defines: additive ? { ADD: 1 } : {}, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D uMap; uniform float uT, uA, uReveal, uGlitch, uFlick, uScan, uPulse; uniform vec3 uTint; uniform vec2 uSize; ${GLSL_H}
      void main(){
        vec2 uv = vUv; float fr = floor(uT * 30.0);
        float row = floor(uv.y * 44.0 + fr * 3.0); float gl = step(0.86, h11(row + fr * 7.13)) * uGlitch;
        uv.x += gl * 0.07 * (h11(row * 3.1 + fr) - 0.5);
        vec4 c = texture2D(uMap, uv);
        if (uGlitch > 0.02) { c.r = texture2D(uMap, uv + vec2(0.014 * uGlitch, 0.0)).r; c.b = texture2D(uMap, uv - vec2(0.014 * uGlitch, 0.0)).b; }
        float sl = uv.y * uSize.y * 82.0 - uT * 0.9;
        float scanl = 1.0 - uScan * (0.5 + 0.5 * sin(sl * 6.2831853));
        float m = 1.0 - smoothstep(uReveal - 0.025, uReveal, vUv.y);
        float lead = exp(-pow((vUv.y - uReveal) / 0.012, 2.0)) * step(vUv.y, 1.0) * step(0.001, uReveal);
        float edge = smoothstep(0.0, 0.01, vUv.x) * smoothstep(1.0, 0.99, vUv.x) * smoothstep(0.0, 0.012, vUv.y) * smoothstep(1.0, 0.985, vUv.y);
        vec3 col = c.rgb * uTint * scanl * (1.0 + uPulse * 0.8);
        col += vec3(0.55, 1.0, 0.95) * lead * (0.35 + c.a) * 2.2;
        float a = c.a * uA * m * edge * uFlick;
        #ifdef ADD
          gl_FragColor = vec4(col * a, 1.0);
        #else
          gl_FragColor = vec4(col, a);
        #endif
      }`,
  });
}

// the locomotive: lit hologram solid (lambert + fresnel + scanlines), vertex colours = albedo, aEmit = self-lit parts (lamp, windows), pixel dissolve
function trainMaterial(THREE, uT) {
  return new THREE.ShaderMaterial({
    uniforms: { uT, uAlpha: { value: 1 }, uDissolve: { value: 0 }, uRim: { value: new THREE.Color('#7ffff0') }, uFlick: { value: 1 }, uGlow: { value: 1 } },
    transparent: true, depthWrite: true, side: THREE.DoubleSide, toneMapped: false, fog: false,
    vertexShader: `attribute vec3 color; attribute float aEmit; varying vec3 vN, vW, vC, vL; varying float vE;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vC = color; vE = aEmit; vL = position; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `precision highp float; varying vec3 vN, vW, vC, vL; varying float vE; uniform float uT, uAlpha, uDissolve, uFlick, uGlow; uniform vec3 uRim; ${GLSL_H}
      void main(){
        vec3 q = floor(vL * 9.0); float n = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        if (n < uDissolve) discard;
        float edgeD = 1.0 - smoothstep(0.0, 0.1, n - uDissolve) ;
        vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N; vec3 V = normalize(cameraPosition - vW);
        float fr = pow(1.0 - abs(dot(N, V)), 2.2);
        float lam = 0.30 + 0.70 * max(dot(N, normalize(vec3(-0.35, 0.8, 0.5))), 0.0);
        float scan = 0.84 + 0.16 * sin(vW.y * 260.0 - uT * 7.0);
        vec3 col = vC * lam * 1.35 + uRim * fr * 1.5;
        col = mix(col, vC * (1.6 + 0.6 * uGlow), vE);
        col += uRim * edgeD * uDissolve * 6.0;
        col *= scan * uFlick;
        gl_FragColor = vec4(col, uAlpha * (0.92 + 0.08 * fr));
      }`,
  });
}

// the projector "trumpet": additive fan of light from the table emitter to the screen's lower edge (stylised volume: fresnel body, rising bands, streaks)
function coneMaterial(THREE, uT) {
  return new THREE.ShaderMaterial({
    uniforms: { uT, uInt: { value: 1 }, uReveal: { value: 1 }, uFlick: { value: 1 }, uCol: { value: new THREE.Color('#22d8c8') }, uCol2: { value: new THREE.Color('#c8fff6') }, uH: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false,
    vertexShader: 'varying vec3 vW, vN; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `precision highp float; varying vec3 vW, vN; varying vec2 vUv; uniform float uT, uInt, uReveal, uFlick; uniform vec3 uCol, uCol2;
      void main(){
        vec3 V = normalize(cameraPosition - vW); vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
        float fr = pow(1.0 - abs(dot(N, V)), 1.3);
        float hgt = vUv.y;
        float a = vUv.x * 6.2831853;
        float stream = 0.5 + 0.5 * sin(a * 11.0 + sin(a * 3.0 + uT * 0.8) * 2.4 + uT * 1.3 - hgt * 8.0);
        float stream2 = 0.5 + 0.5 * sin(a * 23.0 - uT * 1.9 + hgt * 5.0);
        float rise = pow(0.5 + 0.5 * sin(hgt * 36.0 - uT * 6.0), 6.0);
        float fall = pow(1.0 - hgt, 1.15);
        float rev = smoothstep(uReveal, uReveal - 0.12, hgt);
        float lead = exp(-pow((hgt - uReveal) / 0.035, 2.0)) * step(0.001, uReveal) * step(hgt, 0.999);
        float base = (0.07 + 0.55 * fr) * (0.45 + 0.35 * stream + 0.2 * stream2) * (0.25 + 0.75 * fall) + rise * (0.06 + 0.35 * fr) + lead * 0.9 + 0.35 * fall * fall * fall;
        vec3 col = mix(uCol, uCol2, clamp(fall * 0.55 + rise * 0.5 + lead, 0.0, 1.0)) * base * uInt * rev * uFlick;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}
function trumpetGeometry(THREE, { h = 0.6, r0 = [0.16, 0.1], r1 = [1.02, 0.22], pw = 1.9, n = 72, m = 18 } = {}) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= m; j++) { const t = j / m, k = Math.pow(t, pw); for (let i = 0; i <= n; i++) { const a = (i / n) * TAU; pos.push(Math.cos(a) * lerp(r0[0], r1[0], k), t * h, Math.sin(a) * lerp(r0[1], r1[1], k)); uv.push(i / n, t); } }
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + n + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

// flat additive rings / pools / sweeps on a quad (table shock rings, emitter glow, glass sheen)
function ringMaterial(THREE, uT, kind = 'ring') {
  return new THREE.ShaderMaterial({
    uniforms: { uT, uCol: { value: new THREE.Color('#37f0e0') }, uInt: { value: 0 }, uR: { value: 0.5 }, uW: { value: 0.05 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `precision highp float; varying vec2 vUv; uniform vec3 uCol; uniform float uInt, uR, uW, uT;
      void main(){ vec2 p = (vUv - 0.5) * 2.0; float r = length(p);
        #if ${kind === 'ring' ? 1 : 0}
          float a = exp(-pow((r - uR) / uW, 2.0)) + 0.25 * exp(-pow((r - uR) / (uW * 3.0), 2.0)); a *= smoothstep(1.0, 0.85, r);
        #else
          float a = pow(max(0.0, 1.0 - r), 2.2) * (0.8 + 0.2 * sin(r * 40.0 - uT * 3.0));
        #endif
        gl_FragColor = vec4(uCol * a * uInt, 1.0); }`,
  });
}

// soft glow points (sparks, steam puffs, motes): CPU-driven from a pure function each update; size in METERS, additive
function makeGlowPoints(THREE, N, { soft = 1, depthTest = true } = {}) {
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), siz = new Float32Array(N);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  const U = { uPx: { value: 1000 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, depthTest, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    vertexShader: `attribute vec3 aCol; attribute float aSize; uniform float uPx; varying vec3 vC; void main(){ vC = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(aSize * uPx / max(-mv.z, 0.1), 0.0, 90.0); }`,
    fragmentShader: `precision highp float; varying vec3 vC; void main(){ vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c); if (r2 > 1.0) discard; float k = exp(-r2 * ${soft > 0.5 ? '3.0' : '6.0'}) * (1.0 - r2); gl_FragColor = vec4(vC * (k + ${soft > 0.5 ? '0.0' : '0.5 * exp(-r2 * 30.0)'}), 1.0); }`,
  });
  const points = new THREE.Points(g, mat); points.frustumCulled = false; points.renderOrder = 40;
  points.onBeforeRender = (r, sc, cam) => { U.uPx.value = pxScale(r, cam); };
  return { points, pos, col, siz, N, set(i, x, y, z, r_, g_, b_, s) { pos[3 * i] = x; pos[3 * i + 1] = y; pos[3 * i + 2] = z; col[3 * i] = r_; col[3 * i + 1] = g_; col[3 * i + 2] = b_; siz[i] = s; }, hide(i) { siz[i] = 0; col[3 * i] = col[3 * i + 1] = col[3 * i + 2] = 0; }, commit() { g.attributes.position.needsUpdate = true; g.attributes.aCol.needsUpdate = true; g.attributes.aSize.needsUpdate = true; } };
}

// =============================================================================================================================================
// geometry kit
// =============================================================================================================================================
function item(THREE, g, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], c = '#ffffff', e = 0 } = {}) {
  const o = new THREE.Object3D(); o.position.set(p[0], p[1], p[2]); o.rotation.set(r[0], r[1], r[2]); o.scale.set(s[0], s[1], s[2]); o.updateMatrix();
  return { g, m: o.matrix.clone(), c, e };
}
function mergeItems(THREE, items, { emit = false } = {}) {
  const gs = items.map(({ g, m, c, e }) => {
    const gg = g.index ? g.toNonIndexed() : g.clone(); gg.applyMatrix4(m); const col = Array.isArray(c) ? new THREE.Color().setRGB(c[0], c[1], c[2]) : new THREE.Color(c), n = gg.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[3 * i] = col.r; a[3 * i + 1] = col.g; a[3 * i + 2] = col.b; }
    gg.setAttribute('color', new THREE.BufferAttribute(a, 3));
    if (emit) gg.setAttribute('aEmit', new THREE.BufferAttribute(new Float32Array(n).fill(e), 1));
    return gg;
  });
  return mergeGeometries(gs, false);
}
const BOX = (THREE, w, h, d) => new THREE.BoxGeometry(w, h, d);
const CYL = (THREE, rt, rb, h, seg = 20) => new THREE.CylinderGeometry(rt, rb, h, seg);
const SPH = (THREE, r, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);

function radialAlphaTexture(THREE, stops, size = 128) {
  const c = cv(size, size), g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, a]) => gr.addColorStop(o, `rgba(255,255,255,${a})`)); g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}

// =============================================================================================================================================
// the room
// =============================================================================================================================================
function buildRoom(THREE, st) {
  const { scene } = st, add = (o) => { scene.add(o); return o; };
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...o });
  // floor (planks run toward the window), rug, walls, ceiling
  const floorG = new THREE.PlaneGeometry(14, 16); floorG.rotateX(-Math.PI / 2);
  st.floor = add(new THREE.Mesh(floorG, std({ map: tex(THREE, plankCanvas(), { repeat: [7, 8] }), roughness: 0.46, color: '#ffffff' }))); st.floor.position.set(0, 0, 1.5);
  const rugG = new THREE.PlaneGeometry(3.9, 2.9); rugG.rotateX(-Math.PI / 2);
  st.rug = add(new THREE.Mesh(rugG, std({ map: tex(THREE, rugCanvas()), roughness: 0.97 }))); st.rug.position.set(0.0, 0.008, 1.3);
  const plaster = tex(THREE, plasterCanvas(), { repeat: [5, 1.5] });
  const wallM = std({ map: plaster, color: '#cdbfae', roughness: 0.95 });
  const back = add(new THREE.Mesh(new THREE.PlaneGeometry(13, 3.4), wallM)); back.position.set(0, 1.7, BACK);
  const wl = add(new THREE.Mesh(new THREE.PlaneGeometry(14, 3.4), wallM)); wl.rotation.y = Math.PI / 2; wl.position.set(-6.5, 1.7, 1.5);
  const wr = add(new THREE.Mesh(new THREE.PlaneGeometry(14, 3.4), wallM)); wr.rotation.y = -Math.PI / 2; wr.position.set(6.5, 1.7, 1.5);
  const ceil = add(new THREE.Mesh(new THREE.PlaneGeometry(13, 14), std({ color: '#3a322e', roughness: 1 }))); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 3.4, 1.5);
  st.walls = [back, wl, wr, ceil];

  // the window with the night city (emissive picture) + frame, sill, mullions, curtains
  const sky = tex(THREE, skylineCanvas(), { aniso: 4 });
  st.city = add(new THREE.Mesh(new THREE.PlaneGeometry(WIN.w, WIN.h), new THREE.MeshBasicMaterial({ map: sky, toneMapped: false, color: new THREE.Color(1.7, 1.6, 1.6), fog: false })));
  st.city.position.set(WIN.x, WIN.y, BACK + 0.03);
  const F = [], fc = '#1b1716', ft = 0.07, fd = 0.13;
  F.push(item(THREE, BOX(THREE, WIN.w + 2 * ft, ft, fd), { p: [WIN.x, WIN.y + WIN.h / 2 + ft / 2, BACK + fd / 2], c: fc }), item(THREE, BOX(THREE, WIN.w + 2 * ft, ft, fd), { p: [WIN.x, WIN.y - WIN.h / 2 - ft / 2, BACK + fd / 2], c: fc }));
  F.push(item(THREE, BOX(THREE, ft, WIN.h, fd), { p: [WIN.x - WIN.w / 2 - ft / 2, WIN.y, BACK + fd / 2], c: fc }), item(THREE, BOX(THREE, ft, WIN.h, fd), { p: [WIN.x + WIN.w / 2 + ft / 2, WIN.y, BACK + fd / 2], c: fc }));
  F.push(item(THREE, BOX(THREE, 0.035, WIN.h, 0.05), { p: [WIN.x, WIN.y, BACK + 0.06], c: fc }), item(THREE, BOX(THREE, WIN.w, 0.035, 0.05), { p: [WIN.x, WIN.y + 0.15, BACK + 0.06], c: fc }));
  F.push(item(THREE, BOX(THREE, WIN.w + 0.34, 0.05, 0.24), { p: [WIN.x, WIN.y - WIN.h / 2 - ft - 0.02, BACK + 0.12], c: '#4a3426' }));
  // baseboards + a picture rail glow strip (warm LED cove along the top of the back wall)
  F.push(item(THREE, BOX(THREE, 13, 0.14, 0.03), { p: [0, 0.07, BACK + 0.015], c: '#2b221d' }));
  // coffee table: rounded top, brass legs, lower shelf, books, mug, emitter pedestal
  const topG = new THREE.ExtrudeGeometry(roundedRectShape(THREE, 1.9, 0.86, 0.32), { depth: 0.045, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 14 }); topG.rotateX(-Math.PI / 2);
  F.push(item(THREE, topG, { p: [TABLE.x, TABLE.top - 0.045, TABLE.z], c: '#5a3a28' }));
  for (const [x, z] of [[-0.82, -0.3], [0.82, -0.3], [-0.82, 0.3], [0.82, 0.3]]) F.push(item(THREE, CYL(THREE, 0.02, 0.016, 0.34, 10), { p: [TABLE.x + x, 0.19, TABLE.z + z], c: '#c09a58' }));
  F.push(item(THREE, BOX(THREE, 1.6, 0.025, 0.64), { p: [TABLE.x, 0.14, TABLE.z], c: '#3a261b' }));
  F.push(item(THREE, BOX(THREE, 0.34, 0.035, 0.24), { p: [TABLE.x + 0.7, TABLE.top + 0.018, TABLE.z + 0.14], c: '#2a4e5a', r: [0, 0.3, 0] }), item(THREE, BOX(THREE, 0.3, 0.03, 0.22), { p: [TABLE.x + 0.7, TABLE.top + 0.052, TABLE.z + 0.14], c: '#8c3b2a', r: [0, 0.1, 0] }), item(THREE, CYL(THREE, 0.04, 0.034, 0.085, 18), { p: [TABLE.x + 0.68, TABLE.top + 0.1, TABLE.z + 0.1], c: '#e8dcc6' }));
  F.push(item(THREE, BOX(THREE, 0.28, 0.03, 0.2), { p: [TABLE.x - 0.5, 0.17, TABLE.z], c: '#d8c9a6', r: [0, -0.2, 0] }));
  F.push(item(THREE, CYL(THREE, 0.2, 0.23, 0.028, 40), { p: [EMIT[0], TABLE.top + 0.014, EMIT[2]], c: '#0b1215' }));
  // floor lamp (pole, base)
  F.push(item(THREE, CYL(THREE, 0.17, 0.19, 0.03, 28), { p: [LAMP[0], 0.015, LAMP[2]], c: '#3a2c20' }), item(THREE, CYL(THREE, 0.011, 0.011, 1.35, 8), { p: [LAMP[0], 0.7, LAMP[2]], c: '#b88a4c' }));
  // plant pot + low side table next to the sofa
  const PL = [-2.75, -3.45];
  F.push(item(THREE, CYL(THREE, 0.26, 0.19, 0.42, 26), { p: [PL[0], 0.21, PL[1]], c: '#d9cbb2' }), item(THREE, CYL(THREE, 0.255, 0.255, 0.02, 26), { p: [PL[0], 0.43, PL[1]], c: '#2b1e16' }));
  // bookshelf carcass
  const S0 = SHELF, bx = S0.x, bz = BACK + 0.02 + S0.d / 2, shelfC = '#3b2a20';
  F.push(item(THREE, BOX(THREE, 0.04, S0.h, S0.d), { p: [bx - S0.w / 2 + 0.02, S0.h / 2, bz], c: shelfC }), item(THREE, BOX(THREE, 0.04, S0.h, S0.d), { p: [bx + S0.w / 2 - 0.02, S0.h / 2, bz], c: shelfC }));
  F.push(item(THREE, BOX(THREE, S0.w, 0.12, S0.d), { p: [bx, 0.06, bz], c: '#2b1f18' }), item(THREE, BOX(THREE, S0.w, 0.04, S0.d), { p: [bx, S0.h - 0.02, bz], c: shelfC }), item(THREE, BOX(THREE, S0.w - 0.08, S0.h, 0.02), { p: [bx, S0.h / 2, BACK + 0.03], c: '#1c1410' }));
  const bay = (S0.h - 0.14) / 5, bays = []; for (let k = 0; k < 6; k++) { const y = 0.12 + k * bay; if (k > 0 && k < 6) F.push(item(THREE, BOX(THREE, S0.w - 0.08, 0.03, S0.d - 0.02), { p: [bx, y, bz], c: shelfC })); bays.push(y); }
  st.furn = add(new THREE.Mesh(mergeItems(THREE, F), std({ vertexColors: true, roughness: 0.6 })));

  // books (instanced) + glowing spines (instanced, self-lit) on 5 bays; a few gaps hold small objects
  const books = [], spines = []; let bi = 0;
  const bookCols = ['#7a2e2a', '#2c4a5a', '#c89a3c', '#3a5a44', '#5c3a64', '#d8cdb4', '#a24a2c', '#26363f', '#8c6a3a'];
  const glowCols = [[0.25, 1.9, 1.7], [2.2, 1.35, 0.35], [1.1, 0.7, 2.4], [0.3, 1.6, 2.0], [2.2, 0.55, 0.6]];
  for (let b = 0; b < 5; b++) {
    let x = bx - S0.w / 2 + 0.07; const xEnd = bx + S0.w / 2 - 0.07, yb = bays[b] + 0.015;
    while (x < xEnd - 0.05) {
      const k = bi++, w = 0.03 + 0.045 * H(k, 1, 9), h = 0.22 + 0.17 * H(k, 2, 9), d = 0.2 + 0.05 * H(k, 3, 9);
      if (H(k, 4, 9) < 0.07) { x += 0.12; continue; }
      const lean = H(k, 5, 9) < 0.06 ? 0.12 : 0, glow = H(k, 6, 9) < 0.34;
      books.push({ x: x + w / 2, y: yb + h / 2, z: BACK + 0.3 - d / 2, w, h, d, c: bookCols[Math.floor(H(k, 7, 9) * bookCols.length)], lean });
      if (glow) spines.push({ x: x + w / 2, y: yb + h * (0.35 + 0.25 * H(k, 8, 9)), z: BACK + 0.302, w: w * 0.7, h: h * (0.4 + 0.3 * H(k, 9, 9)), c: glowCols[Math.floor(H(k, 10, 9) * glowCols.length)] });
      x += w + 0.004;
    }
  }
  const bm = new THREE.InstancedMesh(BOX(THREE, 1, 1, 1), std({ roughness: 0.7 }), books.length), sp = new THREE.InstancedMesh(BOX(THREE, 1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }), spines.length);
  const o = new THREE.Object3D(), cc = new THREE.Color();
  books.forEach((b, i) => { o.position.set(b.x, b.y, b.z); o.rotation.set(0, 0, b.lean); o.scale.set(b.w, b.h, b.d); o.updateMatrix(); bm.setMatrixAt(i, o.matrix); bm.setColorAt(i, cc.set(b.c).multiplyScalar(0.75 + 0.4 * H(i, 11, 9))); });
  spines.forEach((b, i) => { o.position.set(b.x, b.y, b.z); o.rotation.set(0, 0, 0); o.scale.set(b.w, b.h, 0.004); o.updateMatrix(); sp.setMatrixAt(i, o.matrix); sp.setColorAt(i, cc.setRGB(b.c[0], b.c[1], b.c[2])); });
  add(bm); add(sp); st.books = bm; st.spines = sp;

  // plant: stems + broad leaves (merged, vertex colours, double sided)
  const L = [], gcols = ['#2f6b3a', '#3c7d44', '#245a34', '#4a8a4a']; 
  for (let i = 0; i < 26; i++) {
    const a = i * 2.399 + 0.4, tilt = 0.5 + 0.7 * H(i, 1, 4), hh = 0.55 + 0.75 * H(i, 2, 4), rr = 0.1 + 0.35 * H(i, 3, 4) * (hh);
    const px = Math.cos(a) * rr, pz = Math.sin(a) * rr, py = 0.44 + hh;
    L.push(item(THREE, CYL(THREE, 0.006, 0.01, hh + 0.02, 5), { p: [px * 0.5, 0.44 + hh * 0.5, pz * 0.5], r: [-Math.sin(a) * 0.35 * rr * 2, 0, Math.cos(a) * 0.35 * rr * 2], c: '#3a5a30' }));
    L.push(item(THREE, SPH(THREE, 1, 10, 6), { p: [px, py, pz], r: [-tilt * Math.cos(a) * 0.6, -a + Math.PI / 2, tilt * 0.45], s: [0.13, 0.014, 0.27], c: gcols[i % 4] }));
  }
  st.plant = add(new THREE.Mesh(mergeItems(THREE, L), std({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }))); st.plant.position.set(PL[0], 0, PL[1]);

  // curtains: pleated planes either side of the window
  const cur = (x) => { const g = new THREE.PlaneGeometry(0.7, 2.9, 30, 1), p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, 0.07 * Math.sin(p.getX(i) * 34)); g.computeVertexNormals(); return item(THREE, g, { p: [x, 1.55, BACK + 0.14], c: '#a68660' }); };
  st.curtains = add(new THREE.Mesh(mergeItems(THREE, [cur(WIN.x - WIN.w / 2 - 0.52), cur(WIN.x + WIN.w / 2 + 0.52)]), std({ vertexColors: true, roughness: 1, side: THREE.DoubleSide })));
  // framed print: Amrita's mark on the wall
  const pg = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.6), std({ map: tex(THREE, posterCanvas()), roughness: 0.5 })); pg.position.set(-2.1, 1.72, BACK + 0.032); add(pg);
  const pf = new THREE.Mesh(mergeItems(THREE, [item(THREE, BOX(THREE, 0.5, 0.64, 0.02), { p: [0, 0, 0], c: '#171210' })]), std({ vertexColors: true })); pf.position.set(-2.1, 1.72, BACK + 0.02); add(pf);

  // floor lamp shade (self-lit) + glow
  const shadeG = new THREE.CylinderGeometry(0.15, 0.24, 0.34, 28, 1, true);
  st.lampShade = add(new THREE.Mesh(shadeG, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.45, 0.62), side: THREE.DoubleSide, toneMapped: false, fog: false }))); st.lampShade.position.set(LAMP[0], 1.5, LAMP[2]);
  st.lampCap = add(new THREE.Mesh(new THREE.CircleGeometry(0.15, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 2.0, 1.0), toneMapped: false, fog: false }))); st.lampCap.rotation.x = -Math.PI / 2; st.lampCap.position.set(LAMP[0], 1.5 - 0.1, LAMP[2]);
  st.lampGlow = glowSprite(THREE, { color: '#ffa860', size: 1.9, intensity: 0.9 }); st.lampGlow.position.set(LAMP[0], 1.5, LAMP[2]); add(st.lampGlow);

  // contact shadows (soft dark blobs): table, sofa, shelf, plant, lamp
  const blob = radialAlphaTexture(THREE, [[0, 0.95], [0.5, 0.55], [1, 0]]);
  const sh = (x, z, w, d, a) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: blob, color: '#000000', transparent: true, opacity: a, depthWrite: false, fog: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.014, z); m.renderOrder = 1; return add(m); };
  sh(TABLE.x, TABLE.z + 0.05, 2.5, 1.5, 0.6); sh(SOFA[0], SOFA[2] + 0.05, 4.4, 1.9, 0.7); sh(SHELF.x, BACK + 0.45, 2.3, 0.9, 0.7); sh(PL[0], PL[1], 0.9, 0.9, 0.6); sh(LAMP[0], LAMP[2], 0.6, 0.6, 0.6);
  return { PL };
}

// =============================================================================================================================================
// the locomotive (a tiny head-on-readable toy: round boiler face, one big headlamp, chimney, cowcatcher, two lit cars)
// =============================================================================================================================================
function buildTrainGeometry(THREE) {
  const I = [], rotZ = (g) => g.rotateX(Math.PI / 2); // axis y -> z (top -> +z = front)
  const CylZ = (rt, rb, h, seg = 22) => rotZ(new THREE.CylinderGeometry(rt, rb, h, seg));
  const col = { chassis: '#0f3a46', boiler: '#2cc4bb', dark: '#0a2a33', amber: '#ffb62e', cab: '#dff8f2', roof: '#124a58', wheel: '#c98a22', verm: '#f2542d', car: '#1f9aa0' };
  const lamp = [3.4, 3.0, 2.2], win = [2.4, 1.5, 0.55];
  I.push(item(THREE, BOX(THREE, 0.66, 0.12, 1.6), { p: [0, 0.2, 0.05], c: col.chassis }));
  I.push(item(THREE, CylZ(0.3, 0.3, 1.0), { p: [0, 0.55, 0.12], c: col.boiler }));
  I.push(item(THREE, CylZ(0.315, 0.315, 0.16), { p: [0, 0.55, 0.68], c: col.dark }));
  I.push(item(THREE, CylZ(0.2, 0.2, 0.02), { p: [0, 0.55, 0.77], c: '#e8fff9' }));            // pale front plate
  I.push(item(THREE, SPH(THREE, 0.1, 16, 12), { p: [0, 0.55, 0.78], c: lamp, e: 1 }));           // the headlamp: the star of the shot
  I.push(item(THREE, CYL(THREE, 0.06, 0.085, 0.3, 14), { p: [0, 0.99, 0.5], c: col.chassis }), item(THREE, CYL(THREE, 0.13, 0.08, 0.06, 18), { p: [0, 1.15, 0.5], c: col.amber }));
  I.push(item(THREE, SPH(THREE, 0.105, 14, 10), { p: [0, 0.86, 0.02], c: col.amber, s: [1, 0.8, 1] }));
  I.push(item(THREE, BOX(THREE, 0.66, 0.6, 0.48), { p: [0, 0.62, -0.5], c: col.cab }), item(THREE, BOX(THREE, 0.76, 0.05, 0.6), { p: [0, 0.95, -0.5], c: col.roof }));
  for (const sx of [-1, 1]) I.push(item(THREE, BOX(THREE, 0.012, 0.2, 0.22), { p: [sx * 0.336, 0.7, -0.5], c: win, e: 1 }));
  const cow = new THREE.ConeGeometry(0.34, 0.42, 4, 1).rotateY(Math.PI / 4); rotZ(cow);
  I.push(item(THREE, cow, { p: [0, 0.2, 0.98], s: [1, 0.42, 1], c: col.verm }));
  for (const sx of [-1, 1]) for (const z of [-0.5, -0.05, 0.42]) I.push(item(THREE, CYL(THREE, 0.17, 0.17, 0.06, 14), { p: [sx * 0.35, 0.17, z], r: [0, 0, Math.PI / 2], c: col.wheel }));
  for (const [cz, cc] of [[-1.55, col.car], [-2.5, '#1a7f86']]) {
    I.push(item(THREE, BOX(THREE, 0.64, 0.12, 0.84), { p: [0, 0.2, cz], c: col.chassis }), item(THREE, BOX(THREE, 0.64, 0.5, 0.8), { p: [0, 0.52, cz], c: cc }), item(THREE, BOX(THREE, 0.7, 0.05, 0.86), { p: [0, 0.8, cz], c: col.roof }));
    for (const sx of [-1, 1]) for (const dz of [-0.24, 0, 0.24]) I.push(item(THREE, BOX(THREE, 0.012, 0.14, 0.14), { p: [sx * 0.326, 0.58, cz + dz], c: win, e: 1 }));
    for (const sx of [-1, 1]) for (const dz of [-0.26, 0.26]) I.push(item(THREE, CYL(THREE, 0.15, 0.15, 0.055, 12), { p: [sx * 0.34, 0.15, cz + dz], r: [0, 0, Math.PI / 2], c: col.wheel }));
    I.push(item(THREE, BOX(THREE, 0.08, 0.05, 0.2), { p: [0, 0.22, cz + 0.5], c: col.dark }));
  }
  return mergeItems(THREE, I, { emit: true });
}

// path of the loco in PANE-LOCAL space: q in [0,1] along the rails on the ground (far -> near edge), q in [1,2] lifts off the screen toward the family
const RAIL = (v) => { const g = gpos(0.4 + 0.2 * v, v); return [g[0], g[1] + 0.012, g[2]]; };
function makeExitCurve(THREE) {
  const f = RAIL(1), pts = [[f[0], f[1], f[2]], [f[0] + 0.05, f[1] + 0.13, f[2] + 0.35], [f[0] + 0.13, f[1] + 0.24, f[2] + 0.78], [f[0] + 0.17, f[1] + 0.2, f[2] + 1.2]].map((p) => new THREE.Vector3(...p));
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}
const qOf = (lt) => (lt < EV.pop ? Math.pow(seg(lt, 0.3, EV.pop), 1.5) : 1 + Math.pow(seg(lt, EV.pop, EV.snap), 1.15));
const kOf = (q) => (q <= 1 ? lerp(0.04, 0.105, Math.pow(q, 1.2)) : 0.105 + (0.3 - 0.105) * Math.pow(q - 1, 1.3));
function trainPose(st, lt, out) { // pure: position (pane-local), forward tangent, scale for scene time lt
  const q = qOf(lt); let p, tan;
  if (q <= 1) { const a = RAIL(clamp(q, 0, 1)), b = RAIL(clamp(q + 0.01, 0, 1.0)); p = a; tan = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; }
  else { const u = clamp(q - 1, 0, 1); const P = st.exitCurve.getPointAt(u), T = st.exitCurve.getTangentAt(u); p = [P.x, P.y, P.z]; tan = [T.x, T.y, T.z]; }
  out.q = q; out.k = kOf(q); out.p = p; out.t = tan; return out;
}

// =============================================================================================================================================
// the hologram: projector trumpet, floating pane (parallax layers + diorama), loco, Amrita
// =============================================================================================================================================
function buildHolo(THREE, st) {
  const { scene, uT } = st, add = (o, p = scene) => { p.add(o); return o; };
  // ---- the pane group (origin = pane centre)
  const pane = st.pane = new THREE.Group(); pane.position.set(PANE.x, PANE.y, PANE.z); scene.add(pane);
  const sk = tex(THREE, paneSkyCanvas(), { aniso: 4 });
  const far = tex(THREE, ridgeCanvas({ seed: 11, base: 0.58, amp: 0.34, freq: 150, fill: '#0c4a5c', fillTop: '#26a0a8', rim: '#8ffff0', rimW: 2.4, houses: 0 }), { aniso: 4 });
  const mid = tex(THREE, ridgeCanvas({ seed: 23, base: 0.66, amp: 0.3, freq: 120, fill: '#073746', fillTop: '#157c88', rim: '#4defe2', rimW: 2.6, trees: 34, treeH: 46, houses: 9 }), { aniso: 4 });
  const near = tex(THREE, ridgeCanvas({ seed: 37, base: 0.78, amp: 0.2, freq: 90, fill: '#05222d', fillTop: '#0d5a66', rim: '#36d6cc', rimW: 2.8, trees: 22, treeH: 58 }), { aniso: 4 });
  const wings = tex(THREE, ridgeCanvas({ seed: 41, base: 2, amp: 0, freq: 100, fill: '#031319', fillTop: '#0a3c46', rim: '#2fc4ba', rimW: 2.4, wings: true }), { aniso: 4 });
  const ground = tex(THREE, groundCanvas(), { aniso: 8 });
  const mkPlane = (map, z, order, o = {}) => {
    const mat = layerMaterial(THREE, uT, map, o), m = new THREE.Mesh(new THREE.PlaneGeometry(PANE.w, PANE.h), mat); m.position.z = z; m.renderOrder = order; m.frustumCulled = false; pane.add(m); return { m, mat, z };
  };
  st.layers = [mkPlane(sk, -0.21, 10, { alpha: 0.95, scan: 0.14 }), mkPlane(far, -0.15, 11, { alpha: 0.9 }), mkPlane(mid, -0.095, 12, { alpha: 0.95 }), mkPlane(near, -0.045, 13, { alpha: 1 })];
  // ground: tilted quad (own geometry; z spreads with the layers)
  const gg = new THREE.BufferGeometry(), c4 = [gpos(0, 0), gpos(1, 0), gpos(0, 1), gpos(1, 1)];
  gg.setAttribute('position', new THREE.Float32BufferAttribute(c4.flat(), 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2)); gg.setIndex([0, 2, 1, 1, 2, 3]);
  const gm = layerMaterial(THREE, uT, ground, { alpha: 1, scan: 0.1, size: [PANE.w, 0.4] }), gmesh = new THREE.Mesh(gg, gm); gmesh.renderOrder = 14; gmesh.frustumCulled = false; pane.add(gmesh);
  st.ground = { m: gmesh, mat: gm };
  st.wings = mkPlane(wings, 0.16, 16, { alpha: 1, scan: 0.1 });
  // frame: front rectangle (bright), back rectangle + 4 depth edges (dim), corner brackets (hot)
  const FR = [], hw = PANE.w / 2, hh = PANE.h / 2, hd = PANE.d / 2, bar = (x, y, z, w, h, d, c) => FR.push(item(THREE, BOX(THREE, w, h, d), { p: [x, y, z], c }));
  const cF = [0.35, 2.4, 2.1], cB = [0.12, 0.8, 0.75], cH = [1.4, 3.2, 3.0];
  bar(0, hh, hd, PANE.w + 0.012, 0.012, 0.012, cF); bar(0, -hh, hd, PANE.w + 0.012, 0.012, 0.012, cF); bar(-hw, 0, hd, 0.012, PANE.h, 0.012, cF); bar(hw, 0, hd, 0.012, PANE.h, 0.012, cF);
  bar(0, hh, -hd, PANE.w, 0.006, 0.006, cB); bar(0, -hh, -hd, PANE.w, 0.006, 0.006, cB); bar(-hw, 0, -hd, 0.006, PANE.h, 0.006, cB); bar(hw, 0, -hd, 0.006, PANE.h, 0.006, cB);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) bar(sx * hw, sy * hh, 0, 0.006, 0.006, PANE.d, cB);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) { bar(sx * (hw - 0.07), sy * hh, hd, 0.15, 0.024, 0.016, cH); bar(sx * hw, sy * (hh - 0.07), hd, 0.024, 0.15, 0.016, cH); }
  st.frame = add(new THREE.Mesh(mergeItems(THREE, FR), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false, transparent: true, depthWrite: false })), pane); st.frame.renderOrder = 25; st.frame.frustumCulled = false;
  // glass sheen
  st.sheen = add(new THREE.Mesh(new THREE.PlaneGeometry(PANE.w, PANE.h), new THREE.ShaderMaterial({
    uniforms: { uT, uI: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'precision highp float; varying vec2 vUv; uniform float uT, uI; void main(){ float d = vUv.x * 0.8 + vUv.y * 0.55 - fract(uT * 0.17) * 2.4 + 0.5; float band = exp(-d * d * 60.0) * 0.5 + exp(-(d - 0.22) * (d - 0.22) * 400.0) * 0.35; float vg = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x) * 0.6 + 0.4; gl_FragColor = vec4(vec3(0.3, 1.0, 0.95) * band * 0.12 * uI * vg + vec3(0.1, 0.6, 0.6) * 0.012 * uI, 1.0); }',
  })), pane); st.sheen.position.z = hd + 0.004; st.sheen.renderOrder = 26;
  // moon halo (pulses at the 'oh')
  st.moonGlow = glowSprite(THREE, { color: '#9ffcf0', size: 0.5, intensity: 0.0, depthTest: false }); st.moonGlow.position.set((MOON.u - 0.5) * PANE.w, (0.5 - MOON.v) * PANE.h, -0.19); st.moonGlow.renderOrder = 18; pane.add(st.moonGlow);

  // ---- the loco (pane child)
  st.exitCurve = makeExitCurve(THREE);
  const tmat = trainMaterial(THREE, uT); st.trainMat = tmat;
  const train = st.train = new THREE.Group(); const tm = new THREE.Mesh(buildTrainGeometry(THREE), tmat); tm.renderOrder = 20; tm.frustumCulled = false; train.add(tm); pane.add(train);
  train.userData.mesh = tm;
  st.lampLocal = new THREE.Vector3(0, 0.55, 0.9);
  st.headGlow = glowSprite(THREE, { color: '#ffe9c0', size: 0.9, intensity: 1.0, depthTest: true }); st.headGlow.position.copy(st.lampLocal); st.headGlow.renderOrder = 22; train.add(st.headGlow);
  const bg = trumpetGeometry(THREE, { h: 4.2, r0: [0.06, 0.06], r1: [0.9, 0.9], pw: 1.0, n: 36, m: 8 }); bg.rotateX(Math.PI / 2);
  st.lampBeamMat = coneMaterial(THREE, uT); st.lampBeamMat.uniforms.uCol.value.set('#ffd9a0'); st.lampBeamMat.uniforms.uCol2.value.set('#fff4dc'); st.lampBeamMat.uniforms.uInt.value = 0.5;
  const lb = new THREE.Mesh(bg, st.lampBeamMat); lb.position.copy(st.lampLocal); lb.renderOrder = 21; lb.frustumCulled = false; train.add(lb); st.lampBeam = lb;
  st.flare = lensFlare(THREE, { color: '#d6fbff', size: 0.55, intensity: 0, streak: true, ghosts: 4, ring: true, visibility: 1, ghostDist: 3 }); scene.add(st.flare);

  // ---- projector: trumpet + emitter + rings + pool
  st.coneMat = coneMaterial(THREE, uT);
  const trump = st.trumpet = new THREE.Mesh(trumpetGeometry(THREE, { h: PANE.y - PANE.h / 2 - EMIT[1] + 0.06, r0: [0.17, 0.11], r1: [PANE.w * 0.47, 0.2], pw: 1.9 }), st.coneMat); trump.position.set(EMIT[0], EMIT[1], EMIT[2]); trump.renderOrder = 5; trump.frustumCulled = false; scene.add(trump);
  // small trumpet under Amrita
  st.coneMat2 = coneMaterial(THREE, uT); st.coneMat2.uniforms.uInt.value = 0.8;
  const t2 = st.trumpet2 = new THREE.Mesh(trumpetGeometry(THREE, { h: AMR[1] - 0.34 - EMIT[1], r0: [0.1, 0.1], r1: [0.3, 0.3], pw: 1.5, n: 40, m: 8 }), st.coneMat2); t2.position.set(AMR[0], EMIT[1], AMR[2]); t2.renderOrder = 5; t2.frustumCulled = false; scene.add(t2);
  // second small pedestal under Amrita
  const ped = new THREE.Mesh(CYL(THREE, 0.13, 0.15, 0.022, 32), new THREE.MeshStandardMaterial({ color: '#0b1215', roughness: 0.3, metalness: 0.4 })); ped.position.set(AMR[0], TABLE.top + 0.011, AMR[2]); scene.add(ped);
  const ringG = new THREE.TorusGeometry(0.17, 0.006, 8, 56); ringG.rotateX(Math.PI / 2);
  st.emitRing = add(new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 3.2, 2.9), toneMapped: false, fog: false }))); st.emitRing.position.set(EMIT[0], TABLE.top + 0.03, EMIT[2]);
  const ringG2 = new THREE.TorusGeometry(0.11, 0.005, 8, 40); ringG2.rotateX(Math.PI / 2);
  st.emitRing2 = add(new THREE.Mesh(ringG2, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 3.2, 2.9), toneMapped: false, fog: false }))); st.emitRing2.position.set(AMR[0], TABLE.top + 0.025, AMR[2]);
  const flat = (w, mat, y) => { const g = new THREE.PlaneGeometry(w, w); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, mat); m.position.set(EMIT[0], y, EMIT[2]); m.renderOrder = 6; m.frustumCulled = false; return add(m); };
  st.poolMat = ringMaterial(THREE, uT, 'pool'); st.pool = flat(1.5, st.poolMat, TABLE.top + 0.034);
  st.shockMat = ringMaterial(THREE, uT, 'ring'); st.shock = flat(2.6, st.shockMat, TABLE.top + 0.036);
  st.floorMat = ringMaterial(THREE, uT, 'ring'); st.floorShock = flat(7.5, st.floorMat, 0.02); st.floorShock.position.y = 0.022;
  st.floorGlowMat = ringMaterial(THREE, uT, 'pool'); st.floorGlow = flat(5.2, st.floorGlowMat, 0.021);
  st.emitGlow = glowSprite(THREE, { color: '#6cfff0', size: 1.0, intensity: 1.0, depthTest: false }); st.emitGlow.position.set(EMIT[0], EMIT[1] + 0.12, EMIT[2]); st.emitGlow.renderOrder = 28; scene.add(st.emitGlow);
  // volumetric beam straight up the middle (ray-marched, dusty) - adds real depth inside the trumpet
  st.beam = createBeam(THREE, { from: [EMIT[0], EMIT[1] + 0.02, EMIT[2]], to: [EMIT[0], 2.5, EMIT[2]], color: '#33e8d8', angle: 0.2, intensity: 0.7, steps: 8, noise: 1.0, pool: false, glow: false, floorY: -5, falloff: 0.9, streak: 0.4, soft: 0.6 });
  st.beam.mesh.renderOrder = 6; scene.add(st.beam.object);
  st.haze = createHaze(THREE, { count: 520, bounds: { min: [-4.5, 0.2, -3.8], max: [4.5, 2.7, 4.8] }, size: 0.016, color: '#8fb0d8', ambient: 0.1, boost: 3.0, seed: 3, twinkle: 0.7 }); st.haze.attachBeams([st.beam]); scene.add(st.haze.points);

  // ---- depth proxies: invisible quads drawn LAST that write depth so the DOF sees the hologram (additive layers write none)
  const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, side: THREE.DoubleSide });
  const pp = new THREE.Mesh(new THREE.PlaneGeometry(PANE.w * 1.04, PANE.h * 1.06), proxyMat); pp.position.set(0, 0, 0.0); pp.renderOrder = 100; pp.frustumCulled = false; pane.add(pp); st.paneProxy = pp;
  const ap = new THREE.Mesh(new THREE.CircleGeometry(0.62, 24), proxyMat); ap.renderOrder = 100; ap.frustumCulled = false; scene.add(ap); st.ampProxy = ap;
  const tp = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), proxyMat); tp.renderOrder = 100; tp.frustumCulled = false; scene.add(tp); st.trumpProxy = tp;

  // ---- sparks / puffs / motes
  st.sparks = makeGlowPoints(THREE, 320, { soft: 0 }); scene.add(st.sparks.points);
  st.puffs = makeGlowPoints(THREE, 40, { soft: 1 }); scene.add(st.puffs.points); st.puffs.points.renderOrder = 38;
  st.motes = makeGlowPoints(THREE, 90, { soft: 0 }); pane.add(st.motes.points);
}

// =============================================================================================================================================
// Amrita (hologram, slate), the family, lights
// =============================================================================================================================================
function buildCast(THREE, st, renderer) {
  const { scene } = st;
  const A = st.A = createAmrita(THREE, { style: 'solid' });
  A.setStyle('hologram', { hue: 0.5, alpha: 0.0 }); A.contactShadow(false); A.setShadows({ cast: false, receive: false });
  A.setProp('slate', { t: 0, glow: 0.2 }); A.root.scale.setScalar(0.9); A.root.position.set(...AMR);
  A.root.traverse((o) => { if (o.isMesh) o.renderOrder = 30; });
  scene.add(A.root);
  st.ampGlow = glowSprite(THREE, { color: '#41f0e0', size: 1.7, intensity: 0.0, depthTest: false }); st.ampGlow.renderOrder = 29; scene.add(st.ampGlow);
  // family
  const fam = st.fam = createCouchGroup(THREE, { people: 4, seed: 11, style: 'rim', sofaColor: '#5b3a2c' });
  fam.group.position.set(...SOFA); fam.group.scale.setScalar(0.92); fam.setLightColor('#52f0ff', 0.6); scene.add(fam.group);
  // lights: tungsten lamp, hologram key (teal), table fill, cool city, hemisphere
  st.lamp = new THREE.PointLight('#ffa65c', 16, 0, 2); st.lamp.position.set(LAMP[0] - 0.1, 1.45, LAMP[2] + 0.12); scene.add(st.lamp);
  st.holoL = new THREE.PointLight('#2fe6d4', 7, 0, 2); st.holoL.position.set(0.2, 1.3, 1.5); scene.add(st.holoL);
  st.tableL = new THREE.PointLight('#38f0e0', 2.6, 0, 2); st.tableL.position.set(0.2, 0.72, 1.3); scene.add(st.tableL);
  st.cityL = new THREE.PointLight('#8aa8ff', 5, 0, 2); st.cityL.position.set(WIN.x, WIN.y + 0.2, BACK + 0.9); scene.add(st.cityL);
  st.hemi = new THREE.HemisphereLight('#3a4668', '#4a3424', 0.5);
  st.warmL = new THREE.PointLight('#ffb272', 9, 0, 2); st.warmL.position.set(1.6, 2.5, 5.2); scene.add(st.warmL); scene.add(st.hemi);
  st.shelfL = new THREE.PointLight('#ffb878', 2.2, 0, 2); st.shelfL.position.set(SHELF.x + 0.4, 2.0, BACK + 1.2); scene.add(st.shelfL);
}

// =============================================================================================================================================
// the family: lib animation (idle, awe) + a choreography layer applied on top (lean, bob, head, pointing arm). Pure functions of lt.
// =============================================================================================================================================
const LEAN_A = [0.05, 0.13, 0.12, 0.06], LEAN_F = [0.09, 0.11, 0.07, 0.1], LEAN_O = [0.04, 0.03, 0.03, 0.05];
function choreo(i, lt, c) {
  const awe = sm(0.42, 0.85, lt) * (1 - 0.35 * sm(1.0, 1.2, lt)), flinch = env(lt, EV.pop, 0.2), oh = sm(1.7, 1.95, lt);
  c.lean = LEAN_A[i] * awe - LEAN_F[i] * flinch + LEAN_O[i] * oh;
  const lg = Math.max(0, lt - EV.laugh), pp = Math.max(0, lt - EV.pop);
  c.bob = 0; c.roll = 0;
  if (i === 3) { c.bob = 0.045 * env(lt, EV.laugh, 0.45) * Math.abs(Math.sin(TAU * 5.5 * lg)) * (lt > EV.laugh ? 1 : 0); c.roll = 0.045 * env(lt, EV.laugh, 0.5) * Math.sin(TAU * 3.5 * lg); }
  if (i === 0) { const l2 = Math.max(0, lt - EV.laugh - 0.08); c.bob = 0.028 * env(lt, EV.laugh + 0.08, 0.45) * Math.abs(Math.sin(TAU * 5 * l2)) * (lt > EV.laugh + 0.08 ? 1 : 0); c.roll = -0.03 * env(lt, EV.laugh + 0.08, 0.5) * Math.sin(TAU * 3.2 * l2); }
  if (i === 1) { c.bob = 0.07 * env(lt, EV.pop, 0.35) * Math.abs(Math.sin(TAU * 4 * pp)) * (lt > EV.pop ? 1 : 0); c.roll = -0.06 * sm(0.45, 0.7, lt) * (1 - sm(1.0, 1.3, lt)); }
  if (i === 2) { c.bob = 0.05 * env(lt, EV.laugh, 0.4) * Math.abs(Math.sin(TAU * 6 * lg)) * (lt > EV.laugh ? 1 : 0); c.roll = 0.05 * sm(0.45, 0.7, lt) * (1 - sm(1.0, 1.3, lt)); }
  const kid = i === 1 || i === 2 ? 1 : 0.6, follow = sm(0.85, 1.1, lt) * (1 - sm(1.5, 1.8, lt));
  c.hp = (0.2 + 0.1 * kid) * follow + (0.1 + 0.06 * kid) * oh; c.hy = -(0.1 + 0.12 * kid) * follow * (i < 2 ? 1 : 0.7); c.hr = 0.12 * oh * (i % 2 ? 1 : -1) + 0.1 * env(lt, EV.laugh, 0.5) * Math.sin(TAU * 3 * lg) * (i === 3 ? 1 : 0);
  // arms: phi = raise forward/up (0 hang, pi/2 forward, pi up), theta = outward splay; point = blend toward the pointing target
  c.a0 = [0.05, 0.1]; c.a1 = [0.05, 0.1]; c.point = 0;
  if (i === 0) { const k = spring(lt - EV.oh, 3.2, 0.4) * (lt > EV.oh ? 1 : 0); c.a1 = [lerp(0.05, 2.0, k), lerp(0.1, 0.35, k)]; }
  if (i === 1) { const k = spring(lt - EV.pop, 3.0, 0.38) * (1 - sm(1.3, 1.6, lt)) * (lt > EV.pop ? 1 : 0), k2 = env(lt, EV.snap, 0.3); c.a0 = [lerp(0.05, 2.9, Math.max(k, k2 * 0.6)), lerp(0.1, 0.5, k)]; c.a1 = [lerp(0.05, 2.7, Math.max(k, k2 * 0.6)), lerp(0.1, 0.45, k)]; }
  if (i === 2) { c.point = sm(0.8, 1.0, lt) * (1 - sm(1.5, 1.72, lt)); c.a0 = [0.45 * c.point + 0.05, 0.5 * c.point + 0.1]; }
  if (i === 3) { const k = env(lt, EV.laugh - 0.05, 0.9) * sm(EV.laugh - 0.05, EV.laugh + 0.1, lt); c.a0 = [lerp(0.05, 0.95, k), lerp(0.1, -0.1, k)]; c.a1 = [lerp(0.05, 0.9, k), lerp(0.1, -0.12, k)]; }
  return c;
}
function applyFamily(st, lt) {
  const { fam, k: K } = st, M = fam.meshes, c = st.choreoScratch;
  for (let i = 0; i < 4; i++) {
    choreo(i, lt, c); const px = (i - 1.5) * 0.72, hipY = 0.5;
    K.eul.set(-c.lean, 0, c.roll, 'XYZ'); K.q1.setFromEuler(K.eul);
    K.Mp.compose(K.v1.set(px, hipY + c.bob, 0), K.q1, K.one).multiply(K.m1.makeTranslation(-px, -hipY, 0));
    M.body.getMatrixAt(i, K.m2); K.m2.premultiply(K.Mp); M.body.setMatrixAt(i, K.m2); K.m2.decompose(K.p, K.qB, K.s);
    // head (+ hair): rotate about the neck, then the body transform
    M.head.getMatrixAt(i, K.m2); K.m2.decompose(K.p, K.q2, K.s); K.v2.set(K.p.x, K.p.y - K.s.x * 0.8, K.p.z);
    K.eul.set(c.hp, c.hy, c.hr, 'YXZ'); K.q2.setFromEuler(K.eul);
    K.Rn.compose(K.v2, K.q2, K.one).multiply(K.m1.makeTranslation(-K.v2.x, -K.v2.y, -K.v2.z));
    M.head.getMatrixAt(i, K.m2); K.m2.premultiply(K.Rn).premultiply(K.Mp); M.head.setMatrixAt(i, K.m2);
    M.hair.getMatrixAt(i, K.m2); K.m2.premultiply(K.Rn).premultiply(K.Mp); M.hair.setMatrixAt(i, K.m2);
    for (let s = 0; s < 2; s++) {
      const idx = 2 * i + s, side = s === 0 ? -1 : 1, ang = s === 0 ? c.a0 : c.a1;
      M.arms.getMatrixAt(idx, K.m2); K.m2.decompose(K.p, K.q2, K.s);
      K.sh.set(0, K.s.y, 0).applyQuaternion(K.q2).add(K.p).applyMatrix4(K.Mp);                 // shoulder after the body transform
      const al = side * ang[1], cp = Math.cos(ang[0]);
      K.dir.set(cp * Math.sin(al), -cp * Math.cos(al), -Math.sin(ang[0])).applyQuaternion(K.qB).normalize();
      if (i === 2 && s === 1 && c.point > 0.001) { K.tgt.copy(st.locoWorld).sub(fam.group.position).divideScalar(0.92).sub(K.sh).normalize(); K.dir.lerp(K.tgt, c.point).normalize(); }
      K.q2.setFromUnitVectors(K.down, K.dir);
      K.m2.compose(K.v1.copy(K.sh).addScaledVector(K.dir, K.s.y), K.q2, K.s); M.arms.setMatrixAt(idx, K.m2);
    }
  }
  for (const k of ['body', 'head', 'hair', 'arms']) M[k].instanceMatrix.needsUpdate = true;
}

// =============================================================================================================================================
// the scene module
// =============================================================================================================================================
const lensVFov = (mm, ratio = 2.39, gate = 36) => (2 * Math.atan(Math.tan(Math.atan(gate / (2 * mm))) / ratio) * 180) / Math.PI;
const TIMES = [[0, 'neutral'], [0.35, 'determined'], [0.95, 'surprised'], [1.12, 'happy'], [1.5, 'determined'], [1.64, 'happy'], [1.78, 'surprised'], [1.92, 'happy']];

export default {
  id: 'f2050', kind: '3d', ratio: 2.39,
  async setup({ THREE, S, renderer }) {
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#04060c'); scene.fog = new THREE.FogExp2('#0c141f', 0.028);
    const camera = new THREE.PerspectiveCamera(lensVFov(35), 2.39, 0.1, 60);
    const st = { THREE, S, scene, camera, uT: { value: 0 } };
    st.roomInfo = buildRoom(THREE, st); buildHolo(THREE, st); buildCast(THREE, st, renderer);
    st.pane.add(st.puffs.points, st.sparks.points);
    st.k = { m1: new THREE.Matrix4(), m2: new THREE.Matrix4(), Mp: new THREE.Matrix4(), Rn: new THREE.Matrix4(), q1: new THREE.Quaternion(), q2: new THREE.Quaternion(), qB: new THREE.Quaternion(), eul: new THREE.Euler(), one: new THREE.Vector3(1, 1, 1), v1: new THREE.Vector3(), v2: new THREE.Vector3(), p: new THREE.Vector3(), s: new THREE.Vector3(), sh: new THREE.Vector3(), dir: new THREE.Vector3(), tgt: new THREE.Vector3(), down: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 1, 0), zero: new THREE.Vector3(), lm: new THREE.Matrix4(), tq: new THREE.Quaternion() };
    st.choreoScratch = {}; st.locoWorld = new THREE.Vector3(); st.tpose = { q: 0, k: 0, p: [0, 0, 0], t: [0, 0, 1] }; st.tpose2 = { q: 0, k: 0, p: [0, 0, 0], t: [0, 0, 1] };
    st.cam = { fwd: new THREE.Vector3(), pos: new THREE.Vector3(), look: new THREE.Vector3() };
    return st;
  },

  update(st, T, S) {
    const { THREE, scene, camera, A, fam, k: K, pane } = st, uT = st.uT, lt = clamp(T.lt, 0, 2), t = T.t, gf = Math.round(t * 30);
    uT.value = t;
    if (globalThis.__hide) for (const k of globalThis.__hide) { const o = st[k]; if (o) (o.points || o.object || o.mesh || o).visible = false; }
    // ---- global timeline scalars --------------------------------------------------------------------------------------------------------
    const g0 = lt < 0.34 ? Math.exp(-lt / 0.1) : 0;
    const glitch = clamp(g0 + 0.3 * env(lt, EV.pop, 0.07) + 0.2 * env(lt, EV.snap, 0.06), 0, 1);
    const pw = lt < 0.4 ? (H(gf, 3) < sm(0.0, 0.4, lt) * 1.25 ? 1 : 0.14) : 1;       // power-on flicker (frame-quantised)
    const micro = 1 - 0.2 * (H(gf, 8) > 0.978 ? 1 : 0);
    const flick = pw * micro;
    const surge = sm(1.78, 2.0, lt);
    const hitK = env(lt, 0, 0.22), popK = env(lt, EV.pop, 0.22), snapK = env(lt, EV.snap, 0.18), ohK = sm(EV.oh, EV.oh + 0.25, lt);

    // ---- camera: slow dolly-in over the sofa's shoulder (35 mm), a stepped glitch jitter on the cut -------------------------------------
    const u = lt / 2, e = 0.55 * u + 0.45 * sm(0, 1, u), jit = g0 > 0.04 ? g0 : 0;
    const cx = lerp(1.1, 0.55, e) + 0.02 * Math.sin(t * 1.3) + jit * (H(gf, 21) - 0.5) * 0.22, cy = lerp(1.55, 1.4, e) + 0.012 * Math.sin(t * 1.9 + 1) + jit * (H(gf, 22) - 0.5) * 0.08, cz = lerp(6.3, 5.15, e);
    camera.position.set(cx, cy, cz);
    K.v1.set(lerp(-0.05, 0.1, e) + 0.01 * Math.sin(t * 0.9), lerp(1.4, 1.46, e), 0.4); camera.lookAt(K.v1); camera.updateMatrixWorld(true);
    st.cam.fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);

    // ---- loco pose (pane-local) -----------------------------------------------------------------------------------------------------------
    const tp = trainPose(st, lt, st.tpose);
    const tr = st.train; tr.position.set(tp.p[0], tp.p[1], tp.p[2]); tr.scale.setScalar(tp.k);
    K.v1.set(tp.t[0], tp.t[1], tp.t[2]).normalize(); K.lm.lookAt(K.v1, K.zero, K.up); tr.quaternion.setFromRotationMatrix(K.lm);
    const trVis = lt > 0.3 && lt < 1.64;
    tr.visible = trVis; st.trainMat.uniforms.uDissolve.value = Math.max(1 - seg(lt, 0.3, 0.5), seg(lt, 1.46, 1.62)); st.trainMat.uniforms.uFlick.value = pw * (lt < 0.4 ? 0 : 1) + (lt >= 0.4 ? 0 : 0);
    st.trainMat.uniforms.uFlick.value = micro;
    st.headGlow.scale.setScalar(lerp(3.2, 1.9, clamp(tp.k / 0.3))); st.headGlow.userData.set({ intensity: (0.5 + 0.35 * popK + 0.25 * env(lt, EV.laugh, 0.2)) * (trVis ? 1 : 0) });
    st.lampBeamMat.uniforms.uInt.value = (0.1 + 0.18 * popK) * (trVis ? 1 : 0) * micro;
    tr.updateMatrixWorld(true); st.locoWorld.copy(st.lampLocal); tr.localToWorld(st.locoWorld);
    // lens flare at the headlamp (only while it faces the camera)
    K.v2.set(tp.t[0], tp.t[1], tp.t[2]).normalize(); const facing = clamp(-K.v2.dot(st.cam.fwd) * 1.4, 0, 1);
    st.flare.position.copy(st.locoWorld); st.flare.userData.set({ intensity: (trVis ? 1 : 0) * facing * (0.06 + 0.28 * popK + 0.1 * sm(0.5, 1.0, lt)) * (lt > 1.5 ? 1 - seg(lt, 1.5, 1.64) : 1), visibility: 1 });

    // ---- projector trumpet, emitter, rings, lights ---------------------------------------------------------------------------------------
    const coneR = outBack(seg(lt, 0.02, 0.32), 1.1) * 1.04;
    st.coneMat.uniforms.uReveal.value = coneR; st.coneMat.uniforms.uInt.value = (1.35 + 1.6 * hitK + 0.25 * popK + 1.0 * surge) * flick; st.coneMat.uniforms.uFlick.value = 1;
    st.coneMat2.uniforms.uReveal.value = outBack(seg(lt, 0.06, 0.34), 1.0) * 1.04; st.coneMat2.uniforms.uInt.value = (0.9 + 1.0 * hitK + 0.6 * snapK) * flick;
    st.emitRing.scale.setScalar(1 + 0.3 * hitK); st.emitRing2.scale.setScalar(1 + 0.3 * snapK + 0.2 * hitK);
    st.emitRing.material.color.setRGB(0.6, 3.2, 2.9).multiplyScalar(0.25 + 0.75 * flick * sm(0, 0.1, lt) + hitK * 0.8);
    st.emitRing2.material.color.setRGB(0.6, 3.2, 2.9).multiplyScalar(0.25 + 0.75 * flick * sm(0.05, 0.15, lt));
    st.poolMat.uniforms.uInt.value = (0.55 + 1.6 * hitK + 0.4 * popK) * flick * sm(0, 0.08, lt);
    const shk = lt < 0.9 ? seg(lt, 0.0, 0.5) : seg(lt, EV.pop, EV.pop + 0.5);
    st.shockMat.uniforms.uR.value = 0.04 + 0.96 * shk; st.shockMat.uniforms.uW.value = 0.05; st.shockMat.uniforms.uInt.value = 1.6 * (1 - shk) * (lt < 0.55 || (lt > EV.pop && lt < EV.pop + 0.55) ? 1 : 0);
    const fsh = lt < 0.9 ? seg(lt, 0.0, 0.75) : seg(lt, EV.pop, EV.pop + 0.7);
    st.floorMat.uniforms.uR.value = 0.03 + 0.97 * fsh; st.floorMat.uniforms.uW.value = 0.035; st.floorMat.uniforms.uInt.value = 0.8 * (1 - fsh) * (lt < 0.8 || (lt > EV.pop && lt < EV.pop + 0.75) ? 1 : 0);
    st.floorGlowMat.uniforms.uInt.value = (0.28 + 0.5 * hitK + 0.25 * popK + 0.3 * surge) * flick * sm(0, 0.15, lt);
    st.emitGlow.userData.set({ intensity: (0.45 + 1.6 * hitK + 0.4 * popK) * flick * sm(0, 0.05, lt), size: 1.0 + 0.8 * hitK });
    st.beam.set({ intensity: (0.5 + 0.9 * hitK + 0.3 * surge) * flick * coneR }); st.beam.update(t);
    st.haze.update(t);
    // lights
    const holo = sm(0.0, 0.2, lt) * flick;
    st.holoL.intensity = 7 * (0.12 + 0.88 * holo) * (1 + 1.0 * hitK + 0.35 * popK + 0.3 * snapK + 0.8 * surge);
    st.tableL.intensity = 2.6 * holo * (1 + hitK);
    st.lamp.intensity = 16 * (1 + 0.012 * Math.sin(t * 7.3)); st.lampGlow.userData.set({ intensity: 0.85 });
    st.cityL.intensity = 5; fam.setLightColor('#52f0ff', 0.62 * (0.35 + 0.65 * holo) * (1 + 0.5 * hitK + 0.4 * surge));

    // ---- pane: unfold, parallax spread, scan-in, pulses -----------------------------------------------------------------------------------
    const unf = outBack(seg(lt, 0.14, 0.5), 1.15), sY = Math.max(0.02, unf);
    pane.scale.set(1, sY, 1); pane.position.set(PANE.x, PANE.y - (1 - sY) * PANE.h / 2, PANE.z);
    const spread = outBack(seg(lt, 0.26, 0.78), 1.3);
    const pulseP = 0.7 * popK + 0.35 * snapK + 0.5 * ohK;
    st.layers.forEach((L, k) => { L.m.position.z = L.z * spread; const U = L.mat.uniforms; U.uReveal.value = seg(lt, 0.2 + 0.05 * k, 0.6 + 0.05 * k) * 1.08; U.uGlitch.value = glitch; U.uFlick.value = pw; U.uPulse.value = pulseP * (k === 0 ? 0.4 : 1); });
    { const U = st.ground.mat.uniforms; st.ground.m.scale.z = spread; U.uReveal.value = seg(lt, 0.4, 0.8) * 1.08; U.uGlitch.value = glitch; U.uFlick.value = pw; U.uPulse.value = pulseP; }
    { const L = st.wings, U = L.mat.uniforms; L.m.position.z = L.z * spread; U.uReveal.value = seg(lt, 0.46, 0.86) * 1.08; U.uGlitch.value = glitch; U.uFlick.value = pw; }
    st.frame.material.opacity = clamp(0.25 + 0.75 * sm(0.05, 0.3, lt), 0, 1) * (0.55 + 0.45 * pw) * (1 + 0.0); st.sheen.material.uniforms.uI.value = (0.7 + 1.5 * pulseP) * sm(0.3, 0.7, lt);
    st.moonGlow.userData.set({ intensity: (0.12 + 0.9 * ohK + 0.25 * env(lt, EV.laugh, 0.3)) * sm(0.5, 0.9, lt), size: 0.5 + 0.35 * ohK });
    st.paneProxy.visible = lt > 0.3;

    // ---- sparks / puffs / motes (pane-local) ---------------------------------------------------------------------------------------------
    const SP = st.sparks; let si = 0;
    const burst = (n, origin, t0, speed, life, cols, size, seed, bias) => {
      for (let j = 0; j < n; j++, si++) {
        const age = lt - t0; if (age < 0 || age > life || si >= SP.N) { SP.hide(si); continue; }
        const a = H(seed, j, 1) * TAU, b = H(seed, j, 2) * 2 - 1, r = Math.sqrt(1 - b * b), sp = speed * (0.35 + 0.65 * H(seed, j, 3)), k = 1 - Math.exp(-4 * age), fall = 0.35 * age * age;
        const dx = r * Math.cos(a) + bias[0], dy = b + bias[1], dz = r * Math.sin(a) + bias[2], c = cols[j % cols.length], f = Math.pow(1 - age / life, 2) * (0.6 + 0.8 * H(seed, j, 4));
        SP.set(si, origin[0] + dx * sp * k / 4, origin[1] + dy * sp * k / 4 - fall, origin[2] + dz * sp * k / 4, c[0] * f, c[1] * f, c[2] * f, size * (0.6 + 0.8 * H(seed, j, 5)) * (0.5 + 0.5 * f));
      }
    };
    const front = RAIL(1), exitEnd = st.exitCurve.getPointAt(1), snapO = [exitEnd.x, exitEnd.y, exitEnd.z];
    A.propAnchor(K.v1, 'slate'); const slateO = [K.v1.x - pane.position.x, K.v1.y - pane.position.y, K.v1.z - pane.position.z];
    const TEAL = [[1.0, 3.0, 2.8], [2.6, 3.2, 3.0], [0.5, 2.2, 2.4]], AMB = [[3.2, 2.2, 0.7], [1.0, 3.0, 2.8], [3.0, 1.0, 0.7], [2.0, 2.4, 3.2]];
    burst(80, [front[0], front[1] + 0.05, front[2]], EV.pop, 2.4, 0.75, TEAL, 0.034, 7, [0, 0.2, 0.7]);
    burst(120, snapO, EV.snap, 3.2, 1.0, AMB, 0.04, 9, [0, 0.0, 0.0]);
    burst(60, slateO, EV.snap, 1.6, 0.8, AMB, 0.028, 13, [0, 0.4, 0.2]);
    burst(60, [0, -0.45, 0.1], 0.05, 2.0, 0.7, TEAL, 0.03, 17, [0, 0.9, 0.3]);
    for (; si < SP.N; si++) SP.hide(si); SP.commit();
    const PF = st.puffs;
    for (let i = 0; i < 28; i++) {
      const te = 0.46 + i * 0.075, age = lt - te;
      if (age < 0 || age > 1.0 || te > 1.5) { PF.hide(i); continue; }
      const q = trainPose(st, te, st.tpose2); K.v1.set(q.t[0], q.t[1], q.t[2]).normalize(); K.lm.lookAt(K.v1, K.zero, K.up); K.tq.setFromRotationMatrix(K.lm);
      K.v2.set(0, 1.2, 0.5).multiplyScalar(q.k).applyQuaternion(K.tq); const cxp = q.p[0] + K.v2.x, cyp = q.p[1] + K.v2.y, czp = q.p[2] + K.v2.z;
      const f = Math.pow(1 - age, 1.4) * sm(0, 0.08, age) * 0.5, sz = (0.04 + 0.2 * age) * Math.pow(q.k / 0.105, 0.6);
      PF.set(i, cxp + 0.03 * age, cyp + 0.11 * age + 0.02 * Math.sin(age * 5 + i), czp + 0.04 * age, 0.55 * f, 1.0 * f, 1.0 * f, sz);
    }
    for (let i = 0; i < 6; i++) { // the big TOOT puffs at the laugh
      const age = lt - EV.laugh - i * 0.05, idx = 28 + i; if (age < 0 || age > 1.0) { PF.hide(idx); continue; }
      const q = trainPose(st, EV.laugh, st.tpose2); K.v1.set(q.t[0], q.t[1], q.t[2]).normalize(); K.lm.lookAt(K.v1, K.zero, K.up); K.tq.setFromRotationMatrix(K.lm);
      K.v2.set(0, 1.2, 0.5).multiplyScalar(q.k).applyQuaternion(K.tq); const f = Math.pow(1 - age, 1.3) * sm(0, 0.05, age) * 0.7;
      PF.set(idx, q.p[0] + K.v2.x + (H(i, 3, 5) - 0.5) * 0.12 * age, q.p[1] + K.v2.y + 0.25 * age, q.p[2] + K.v2.z + 0.2 * age + (H(i, 4, 5) - 0.5) * 0.1, 0.8 * f, 1.15 * f, 1.15 * f, 0.1 + 0.55 * age + 0.03 * i);
    }
    for (let i = 34; i < PF.N; i++) PF.hide(i); PF.commit();
    const MO = st.motes, mvis = sm(0.4, 0.9, lt) * pw;
    for (let i = 0; i < MO.N; i++) {
      const bx = (H(i, 1, 6) - 0.5) * PANE.w * 0.94, by = (H(i, 2, 6) - 0.5) * PANE.h * 0.9, bz = (H(i, 3, 6) - 0.5) * PANE.d * 0.9, ph = H(i, 4, 6) * TAU, tw = 0.55 + 0.45 * Math.sin(t * (1.3 + 2 * H(i, 5, 6)) + ph), warm = H(i, 7, 6) < 0.3;
      MO.set(i, bx + 0.03 * Math.sin(t * 0.5 + ph), by + 0.035 * Math.sin(t * 0.43 + ph * 1.7), bz, (warm ? 2.4 : 0.6) * tw * mvis, (warm ? 1.5 : 2.4) * tw * mvis, (warm ? 0.5 : 2.2) * tw * mvis, 0.007 + 0.009 * H(i, 6, 6));
    }
    MO.commit();

    // ---- Amrita (hologram): scan-in, directing, slate --------------------------------------------------------------------------------------
    const ap = sm(0.0, 0.42, lt), as = 0.9 * (0.35 + 0.65 * outBack(seg(lt, 0.0, 0.45), 1.7));
    const apw = lt < 0.4 ? (H(gf, 4) < sm(0.02, 0.4, lt) * 1.2 ? 1 : 0.1) : 1;
    A.setStyle('hologram', { hue: 0.5 + 0.015 * Math.sin(t * 2.1), alpha: 0.86 * ap * apw * micro + 0.12 * hitK, t });
    A.time(t);
    const yawT = lerp(0.42, 0.88, sm(0.45, 0.8, lt)) + 0.12 * sm(0.85, 1.05, lt) - 0.78 * sm(EV.laugh - 0.05, EV.laugh + 0.15, lt) + 0.7 * sm(EV.snap, EV.snap + 0.2, lt) + 0.0;
    const yaw = clamp(yawT, 0.1, 1.1);
    const stretch = 0.38 * (1 - seg(lt, 0, 0.3)) * ap;
    const P = addPose(hover(t, { amp: 0.032, seed: 5 }), { squash: stretch + punch(lt, EV.pop, { amp: -0.2 }) + punch(lt, EV.laugh, { amp: 0.16, freq: 5 }) + punch(lt, EV.snap, { amp: -0.3, freq: 4.5 }) + punch(lt, EV.oh, { amp: 0.12, freq: 4 }), pivot: -1 });
    A.pose({ yaw, squash: P.squash, roll: P.roll + 0.05 * Math.sin(TAU * 3.5 * Math.max(0, lt - EV.laugh)) * env(lt, EV.laugh, 0.5), bob: P.bob + 0.04 * env(lt, EV.laugh, 0.3) + 0.03 * env(lt, EV.pop, 0.25), yawD: P.yawD, pivot: P.pivot });
    A.root.scale.setScalar(as); A.root.position.set(AMR[0], AMR[1], AMR[2]);
    // expression sequence
    let from = TIMES[0][1], to = from, amt = 1;
    for (let i = 0; i < TIMES.length; i++) { if (lt >= TIMES[i][0]) { to = TIMES[i][1]; from = i ? TIMES[i - 1][1] : TIMES[0][1]; amt = sm(TIMES[i][0], TIMES[i][0] + 0.1, lt); } }
    A.expression(to, amt, from);
    const aim = lt < 0.9 ? K.v1.set(PANE.x + 0.2, PANE.y - 0.1, PANE.z) : lt < EV.laugh ? K.v1.copy(st.locoWorld) : lt < EV.snap ? K.v1.set(0.2, 1.4, 2.6) : K.v1.set(0.3, 1.3, 1.2);
    A.lookAt(aim, { gain: 2.4 }); A.eyes({ open: A.eyesState.open * (1 - A.blinkAt(T, 3)) });
    const sg = 0.55 + 0.25 * Math.sin(t * 3.0) + 1.5 * env(lt, EV.pop, 0.22) + 1.1 * env(lt, EV.snap, 0.2) + 0.5 * env(lt, 0.0, 0.3);
    A.setProp('slate', { t, glow: clamp(sg, 0, 3), pos: [0.05 * env(lt, EV.snap, 0.2) - 0.04 * env(lt, EV.pop, 0.2), 0.07 * env(lt, EV.pop, 0.25) - 0.08 * env(lt, EV.snap, 0.12) + 0.02 * Math.sin(t * 2.4), 0], rotY: -0.3 - 0.4 * env(lt, EV.laugh, 0.5) * Math.sin(TAU * 2.5 * Math.max(0, lt - EV.laugh)), float: 0.03 });
    A.glow(0.35 + 0.8 * snapK + 0.5 * popK);
    st.ampGlow.position.set(AMR[0], AMR[1], AMR[2] - 0.12); st.ampGlow.userData.set({ intensity: 0.28 * ap * apw + 0.5 * hitK + 0.4 * snapK, size: 2.0 * as / 0.9 });
    st.ampProxy.position.set(AMR[0], AMR[1] + 0.02, AMR[2] - 0.05); st.ampProxy.scale.setScalar(as / 0.74 * 0.9);
    st.trumpProxy.position.set(0, (EMIT[1] + PANE.y - PANE.h / 2) / 2, EMIT[2]); st.trumpProxy.scale.set(1.6, 0.6, 1);
    st.ampProxy.lookAt(camera.position); st.trumpProxy.lookAt(camera.position.x, st.trumpProxy.position.y, camera.position.z);

    // ---- the family ----------------------------------------------------------------------------------------------------------------------
    fam.update(T, { awe: (tt) => 0.3 * sm(42.45, 42.8, tt) * (1 - sm(43.2, 43.5, tt)) });
    applyFamily(st, lt);

    // ---- focus, bloom, exposure ----------------------------------------------------------------------------------------------------------
    const dA = K.v1.set(AMR[0] * 0.5 + PANE.x * 0.5, 1.2, AMR[2] * 0.4 + PANE.z * 0.6).sub(camera.position).dot(st.cam.fwd);
    const dL = K.v2.copy(st.locoWorld).sub(camera.position).dot(st.cam.fwd), ft = sm(0.75, 1.05, lt) * (1 - sm(1.5, 1.78, lt)) * (trVis ? 1 : 0);
    const focus = lerp(dA, Math.max(2, dL), ft * 0.8);
    return { dof: globalThis.__nodof ? { enabled: false } : { focus, strength: 0.24, maxPx: 9, bokeh: 1.5 }, bloom: { strength: globalThis.__nobloom ? 0 : 0.5 + 0.3 * T.impact + 0.3 * surge + 0.1 * popK, radius: 0.5, threshold: 1.15 }, exposure: 1.0 + 0.16 * T.impact + 0.28 * surge, shake: 4 };
  },

  // digital glitch pop on the cut (first ~0.3 s), micro-glitches on the pop and the snap: sliced rows, RGB split, scan bars, blocks
  overlay2d(ctx, T, S, st) {
    const lt = clamp(T.lt, 0, 2), gf = Math.round(T.t * 30);
    const g = clamp((lt < 0.34 ? Math.exp(-lt / 0.1) : 0) + 0.3 * env(lt, EV.pop, 0.05) + 0.15 * env(lt, EV.snap, 0.05), 0, 1);
    if (g < 0.05 || globalThis.__noGlitch) return;
    const M = S.overlay.matteRect(2.39), cv0 = ctx.canvas, sc = S.scale, w = cv0.width, h = cv0.height;
    if (!st.g2 || st.g2.width !== w || st.g2.height !== h) { st.g2 = document.createElement('canvas'); st.g2.width = w; st.g2.height = h; }
    const gx = st.g2.getContext('2d'), rx = M.x * sc, ry = M.y * sc, rw = M.w * sc, rh = M.h * sc;
    ctx.save();
    ctx.beginPath(); ctx.rect(M.x, M.y, M.w, M.h); ctx.clip();
    { // RGB split: re-compose the picture from its three colour channels with the red / blue ones displaced
      if (!st.g3 || st.g3.width !== w || st.g3.height !== h) { st.g3 = document.createElement('canvas'); st.g3.width = w; st.g3.height = h; }
      const g3 = st.g3.getContext('2d'); g3.globalCompositeOperation = 'source-over'; g3.clearRect(0, 0, w, h); g3.drawImage(cv0, rx, ry, rw, rh, rx, ry, rw, rh);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(M.x, M.y, M.w, M.h);
      for (const [tint, off] of [['#ff0000', 1], ['#00ff00', 0], ['#0000ff', -1]]) {
        gx.globalCompositeOperation = 'source-over'; gx.clearRect(0, 0, w, h); gx.drawImage(st.g3, rx, ry, rw, rh, rx, ry, rw, rh);
        gx.globalCompositeOperation = 'multiply'; gx.fillStyle = tint; gx.fillRect(rx, ry, rw, rh);
        ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(st.g2, rx, ry, rw, rh, M.x + off * (3 + 22 * g), M.y, M.w, M.h);
      }
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    const n = 3 + Math.floor(10 * g);
    for (let k = 0; k < n; k++) { // sliced rows displaced sideways
      const y0 = M.y + H(gf, k, 1) * M.h * 0.96, hh = 6 + H(gf, k, 2) * 70 * g, dx = (H(gf, k, 3) - 0.5) * 300 * g;
      ctx.drawImage(cv0, rx, y0 * sc, rw, hh * sc, M.x + dx, y0, M.w, hh);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 4; k++) { const y0 = M.y + H(gf, k, 10) * M.h, hh = 2 + H(gf, k, 11) * 14; ctx.fillStyle = `rgba(60,255,235,${0.22 * g * H(gf, k, 12)})`; ctx.fillRect(M.x, y0, M.w, hh); }
    for (let k = 0; k < 5; k++) { const bx = M.x + H(gf, k, 13) * M.w, by = M.y + H(gf, k, 14) * M.h, bw = 30 + H(gf, k, 15) * 160, bh = 6 + H(gf, k, 16) * 26; ctx.fillStyle = `rgba(${H(gf, k, 17) < 0.5 ? '255,70,120' : '60,255,235'},${0.3 * g})`; ctx.fillRect(bx, by, bw, bh); }
    ctx.restore();
  },
};
