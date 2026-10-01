// =============================================================================
// titles.js — draws every title from cues.TITLES. One idea per title, fixed zones in the 1920x1080
// 90 % safe area. Records each drawn text rect in `log.rects` so collisions can be verified.
// =============================================================================
import { TITLES, BRAND } from '../../shared/cues.js';
import { F } from './fonts.js';
import { smooth, outBack, outCubic, clamp, lerp } from './ease.js';
import * as P from './pencil.js';
import { hash } from './rng.js';

// Zones: rect + anchor. Keep Amrita's face out of these (scenes are told the zone ids).
export const ZONES = {
  lower: { x: 96, y: 800, w: 1728, h: 130, ax: 'center' },
  label: { x: 110, y: 760, w: 760, h: 190, ax: 'left' },
  endTitle: { x: 96, y: 400, w: 1728, h: 160, ax: 'center' },
  endTagline: { x: 96, y: 590, w: 1728, h: 70, ax: 'center' },
  endCta: { x: 96, y: 700, w: 1728, h: 64, ax: 'center' },
  endCredit: { x: 96, y: 884, w: 1728, h: 40, ax: 'center' },
};

const IN = 0.25, OUT = 0.2;
export function titleAt(t) { return TITLES.filter((x) => t >= x.t0 && t < x.t1); }

// ctx is in logical space. T from makeT. `act` = 1 (hand-drawn paper) | 2 (3D stage) selects colours when style 'auto'.
export function drawTitles(ctx, T, S, log) {
  for (const ti of titleAt(T.t)) drawOne(ctx, ti, T, S, log);
}
function rec(log, ti, x, y, w, h) { if (log) log.rects.push({ id: ti.id, x, y, w, h }); }

function drawOne(ctx, ti, T, S, log) {
  const z = ZONES[ti.zone], lt = T.t - ti.t0, rem = ti.t1 - T.t;
  const aIn = smooth(lt / IN), aOut = smooth(rem / OUT), a = Math.min(aIn, aOut);
  if (a <= 0.001) return;
  const pal = BRAND.palette;
  ctx.save();
  switch (ti.style) {
    case 'hand': { // pencil hand lettering that WRITES ON, on paper
      const size = 76, font = F.hand(size, 700);
      const reveal = clamp(lt / 1.25);
      const cx = z.x + z.w / 2, y = z.y + 84;
      ctx.globalAlpha = aOut;
      const m = P.measure(ctx, ti.text, font);
      P.text(ctx, ti.text, cx, y, { font, color: pal.graphite, align: 'center', boil: T.boil, reveal, seed: 31, amp: 1.4 });
      P.underline(ctx, cx - m / 2, cx + m / 2, y + 22, { color: pal.vermilion, width: 5, boil: T.boil, reveal: clamp((lt - 1.0) / 0.5) });
      rec(log, ti, cx - m / 2, y - 62, m, 100);
      break;
    }
    case 'slam': { // big condensed title slams in with overshoot + soft glow
      const size = 150, font = F.display(size);
      const s = lerp(1.35, 1, outBack(clamp(lt / 0.22), 1.4)), cx = z.x + z.w / 2, y = z.y + 100;
      ctx.translate(cx, y); ctx.scale(s, s); ctx.translate(-cx, -y);
      ctx.globalAlpha = a; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.shadowColor = pal.amber; ctx.shadowBlur = 40 * (1 - clamp(lt / 0.8)) + 10; ctx.fillStyle = pal.cream;
      const sp = 6; ctx.letterSpacing = sp + 'px'; ctx.fillText(ti.text, cx, y);
      const m = ctx.measureText(ti.text).width; rec(log, ti, cx - m / 2, y - 112, m, 130);
      break;
    }
    case 'label': { // one-word job label, bottom-left, with a drawn-on rule
      const size = 168, font = F.display(size), x = z.x + 8, y = z.y + 140;
      const slide = (1 - outCubic(clamp(lt / 0.28))) * -60;
      ctx.globalAlpha = a; ctx.font = font; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.letterSpacing = '4px';
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 24; ctx.fillStyle = pal.cream; ctx.fillText(ti.text, x + slide, y);
      ctx.shadowBlur = 0; const m = ctx.measureText(ti.text).width;
      ctx.fillStyle = pal.amber; ctx.fillRect(x + slide, y + 16, m * outCubic(clamp(lt / 0.5)), 8);
      rec(log, ti, x + slide, y - 130, m, 160);
      break;
    }
    case 'wordmark': {
      const size = 150, font = F.display(size), cx = z.x + z.w / 2, y = z.y + 118;
      const k = outCubic(clamp(lt / 0.6));
      ctx.globalAlpha = a * k; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.letterSpacing = (24 - 14 * k) + 'px'; ctx.shadowColor = pal.amber; ctx.shadowBlur = 30 * (1 - k) + 6; ctx.fillStyle = pal.cream; ctx.fillText(ti.text, cx, y);
      const m = ctx.measureText(ti.text).width; rec(log, ti, cx - m / 2, y - 112, m, 130);
      break;
    }
    case 'tagline': {
      const size = 56, font = F.condensed(size, 500), cx = z.x + z.w / 2, y = z.y + 52;
      ctx.globalAlpha = a; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.letterSpacing = '8px'; ctx.fillStyle = pal.amber;
      const dy = (1 - outCubic(clamp(lt / 0.4))) * 14; ctx.fillText(ti.text.toUpperCase(), cx, y + dy);
      const m = ctx.measureText(ti.text.toUpperCase()).width; rec(log, ti, cx - m / 2, y - 48, m, 62);
      break;
    }
    case 'cta': { // placeholder chip: dashed outline so it reads as PLACEHOLDER
      const font = F.label(30, 600), cx = z.x + z.w / 2, y = z.y + 42;
      ctx.globalAlpha = a; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.letterSpacing = '5px';
      const m = ctx.measureText(ti.text).width, pw = m + 70, ph = 52;
      ctx.strokeStyle = BRAND.ctaPlaceholder ? pal.amber : pal.cream; ctx.lineWidth = 2; if (BRAND.ctaPlaceholder) ctx.setLineDash([12, 9]);
      ctx.beginPath(); ctx.roundRect(cx - pw / 2, y - 36, pw, ph, 26); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = pal.cream; ctx.fillText(ti.text, cx, y);
      rec(log, ti, cx - pw / 2, y - 36, pw, ph);
      break;
    }
    case 'credit': {
      const font = F.label(22, 600), cx = z.x + z.w / 2, y = z.y + 28;
      ctx.globalAlpha = a * 0.85; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.letterSpacing = '7px'; ctx.fillStyle = pal.paper;
      ctx.fillText(ti.text.toUpperCase(), cx, y);
      const m = ctx.measureText(ti.text.toUpperCase()).width; rec(log, ti, cx - m / 2, y - 22, m, 32);
      break;
    }
    default: break;
  }
  ctx.restore();
}
