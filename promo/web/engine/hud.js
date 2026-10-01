// =============================================================================
// hud.js — the era HUD (v0): film-strip timeline along the bottom with a running YEAR counter, era caption top-left.
//   draw(ctx, T, S, mode)   mode 'paper' (Act I, drawn, part of the paper world) | 'digital' (the future, teal)
// Driven only by cues (ERAS, FUTURES, yearAt). Logical 1920x1080 space.
// =============================================================================
import { ERAS, FUTURES, yearAt, BRAND, NOW_T } from '../../shared/cues.js';
import { F } from './fonts.js';
import * as P from './pencil.js';
import { clamp, lerp, smooth, outBack } from './ease.js';

const pal = BRAND.palette;
export const HUD_ZONES = { caption: { x: 96, y: 54, w: 900, h: 110 }, strip: { x: 0, y: 958, w: 1920, h: 100 } };

export function draw(ctx, T, S, mode = 'paper') {
  const y = yearAt(T.t); if (!y.show) return;
  const digital = mode === 'digital', t = T.t;
  const e = T.era || null, fut = FUTURES.find((f) => t >= f.t0 && t < f.t1);
  // ---- caption (top-left)
  const cap = digital ? (fut && fut.caption) : e && e.caption;
  if (cap) {
    const lt = digital ? t - fut.t0 : t - e.t0, a = smooth(lt / 0.25);
    ctx.save(); ctx.globalAlpha = a; ctx.translate((1 - a) * -30, 0);
    if (digital) {
      ctx.font = F.condensed(40, 500); ctx.letterSpacing = '8px'; ctx.fillStyle = pal.teal; ctx.textBaseline = 'alphabetic'; ctx.fillText(cap, 100, 100);
      ctx.fillStyle = pal.teal; ctx.fillRect(100, 114, 120, 3);
    } else {
      ctx.globalCompositeOperation = 'multiply';
      P.text(ctx, cap, 100, 112, { font: F.hand(68, 700), color: pal.graphite, boil: T.boil, reveal: clamp(lt / 0.4), seed: 77, amp: 1.2 });
      P.underline(ctx, 100, 100 + P.measure(ctx, cap, F.hand(68, 700)), 128, { color: pal.vermilion, width: 4, boil: T.boil, reveal: clamp((lt - 0.2) / 0.3) });
    }
    ctx.restore();
  }
  // ---- bottom film strip
  const S0 = HUD_ZONES.strip;
  ctx.save();
  const stripCol = digital ? 'rgba(10,14,22,0.85)' : '#2A2833';
  ctx.fillStyle = stripCol; ctx.fillRect(0, S0.y + 14, 1920, 78);
  const yearVal = y.year, px = 7.2; // px per year
  const off = 960 - (yearVal - 1895) * px * 0 - 0; // playhead fixed at the centre-right
  const scroll = -((yearVal) * 14); // sprockets scroll with the running year
  ctx.fillStyle = digital ? '#0b1018' : P.mix('#F2EBDC', '#2A2833', 0.12);
  for (let x = ((scroll % 36) + 36) % 36 - 36; x < 1960; x += 36) { ctx.fillRect(x, S0.y + 20, 16, 11); ctx.fillRect(x, S0.y + 75, 16, 11); }
  // era frames along the strip: each era is a "frame" cell, current one lit
  const cell = 150, headX = 1280;
  const list = digital ? FUTURES : ERAS, idxF = digital ? FUTURES.indexOf(fut) : (e ? e.index : 0);
  const cur = idxF + (digital ? 0 : (y.roll || 0));
  list.forEach((it, i) => {
    const cx = headX + (i - cur) * (cell + 14);
    if (cx < -cell || cx > 1960) return;
    const act = Math.abs(i - cur) < 0.5;
    ctx.fillStyle = act ? (digital ? 'rgba(31,181,166,0.35)' : 'rgba(255,182,46,0.30)') : 'rgba(255,255,255,0.06)';
    ctx.fillRect(cx - cell / 2, S0.y + 36, cell, 36);
    ctx.fillStyle = act ? pal.cream : 'rgba(255,243,214,0.55)'; ctx.font = F.condensed(24, 500); ctx.textAlign = 'center'; ctx.letterSpacing = '3px'; ctx.fillText(String(it.year), cx, S0.y + 62);
  });
  // playhead
  ctx.fillStyle = digital ? pal.teal : pal.amber; ctx.beginPath(); ctx.moveTo(headX - 10, S0.y + 6); ctx.lineTo(headX + 10, S0.y + 6); ctx.lineTo(headX, S0.y + 22); ctx.closePath(); ctx.fill(); ctx.fillRect(headX - 1.5, S0.y + 20, 3, 72);
  // big running year counter (left)
  const nowT = !digital && y.now && t >= NOW_T;
  const txt = nowT ? 'NOW' : String(Math.round(y.year));
  const pop = nowT ? outBack(clamp((t - NOW_T) / 0.2), 2) : 1;
  ctx.save(); ctx.translate(110, S0.y + 84); ctx.scale(pop, pop); ctx.font = F.display(96); ctx.textAlign = 'left'; ctx.letterSpacing = '4px';
  ctx.shadowColor = digital ? pal.teal : pal.amber; ctx.shadowBlur = nowT ? 28 : 8; ctx.fillStyle = nowT ? pal.amber : pal.cream; ctx.fillText(txt, 0, 0); ctx.restore();
  ctx.restore();
}
