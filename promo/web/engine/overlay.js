// overlay.js — 2D finishing: letterbox, vignette, film grain, safe-area helpers. Logical 1920x1080 space.
import { hash } from './rng.js';

export const W = 1920, H = 1080;
export const SAFE = { x: 96, y: 54, w: 1728, h: 972 }; // 90% safe area

// Largest rect of aspect `ratio` centred in 1920x1080
export function matteRect(ratio) {
  let w = W, h = W / ratio;
  if (h > H) { h = H; w = H * ratio; }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h, ratio };
}
export function drawBars(ctx, rect, color = '#000') {
  ctx.save(); ctx.fillStyle = color;
  if (rect.y > 0.5) { ctx.fillRect(0, 0, W, rect.y); ctx.fillRect(0, rect.y + rect.h, W, H - rect.y - rect.h); }
  if (rect.x > 0.5) { ctx.fillRect(0, 0, rect.x, H); ctx.fillRect(rect.x + rect.w, 0, W - rect.x - rect.w, H); }
  ctx.restore();
}
export function drawVignette(ctx, amount = 0.35, rect = { x: 0, y: 0, w: W, h: H }) {
  if (amount <= 0) return;
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, r = Math.hypot(rect.w, rect.h) * 0.5;
  const g = ctx.createRadialGradient(cx, cy, r * 0.45, cx, cy, r * 1.02);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${amount})`);
  ctx.save(); ctx.fillStyle = g; ctx.fillRect(rect.x, rect.y, rect.w, rect.h); ctx.restore();
}

// Grain: pre-generated noise tiles (seeded), picked/offset per frame by hash. amount 0..1
const grainTiles = new Map();
function grainTile(size, k) {
  const key = size + ':' + k;
  if (grainTiles.has(key)) return grainTiles.get(key);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), id = g.createImageData(size, size), d = id.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const x = p % size, y = (p / size) | 0;
    const n = (hash(x, y, k * 31 + 7) + hash(x + 1, y * 3, k * 17 + 3) + hash(x * 5, y + 2, k * 13 + 1)) / 3;
    const v = Math.max(0, Math.min(255, 128 + (n - 0.5) * 255));
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  grainTiles.set(key, c);
  return c;
}
export function drawGrain(ctx, S, frame, amount = 0.05, rect = { x: 0, y: 0, w: W, h: H }) {
  if (amount <= 0) return;
  const size = Math.max(256, Math.round(512 * S.scale)), tile = grainTile(size, frame % 6);
  const ox = Math.floor(hash(frame, 1) * size), oy = Math.floor(hash(frame, 2) * size);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath(); ctx.rect(rect.x * S.scale, rect.y * S.scale, rect.w * S.scale, rect.h * S.scale); ctx.clip();
  ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = Math.min(1, amount * 5);
  const x1 = (rect.x + rect.w) * S.scale, y1 = (rect.y + rect.h) * S.scale;
  for (let y = oy - size; y < y1; y += size) for (let x = ox - size; x < x1; x += size) ctx.drawImage(tile, x, y);
  ctx.restore();
}
// subtle screen-wide flash on hits (white), amount 0..1
export function drawFlash(ctx, amount, color = '255,244,214') {
  if (amount <= 0.003) return;
  ctx.save(); ctx.fillStyle = `rgba(${color},${Math.min(1, amount)})`; ctx.globalCompositeOperation = 'lighter'; ctx.fillRect(0, 0, W, H); ctx.restore();
}
// micro camera shake offset (pure function of time + impact): returns [dx, dy, rot]
export function shakeOffset(t, impact, amp = 6) {
  const a = impact * amp, f = Math.floor(t * 60);
  return [(hash(f, 11) - 0.5) * 2 * a, (hash(f, 12) - 0.5) * 2 * a, (hash(f, 13) - 0.5) * 2 * a * 0.002];
}
