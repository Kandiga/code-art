// Easing + analytic springs. Pure functions of their input; no state.
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const unlerp = (a, b, x) => clamp((x - a) / (b - a));
export const remap = (x, a, b, c, d) => lerp(c, d, clamp((x - a) / (b - a)));
export const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
export const smoother = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
export const inQuad = (x) => clamp(x) ** 2;
export const outQuad = (x) => 1 - (1 - clamp(x)) ** 2;
export const inOutQuad = (x) => { x = clamp(x); return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2; };
export const inCubic = (x) => clamp(x) ** 3;
export const outCubic = (x) => 1 - (1 - clamp(x)) ** 3;
export const inOutCubic = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; };
export const inQuart = (x) => clamp(x) ** 4;
export const outQuart = (x) => 1 - (1 - clamp(x)) ** 4;
export const inOutQuart = (x) => { x = clamp(x); return x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2; };
export const outExpo = (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * clamp(x)));
export const inExpo = (x) => (x <= 0 ? 0 : 2 ** (10 * clamp(x) - 10));
export const outBack = (x, s = 1.70158) => { x = clamp(x) - 1; return x * x * ((s + 1) * x + s) + 1; };
export const inBack = (x, s = 1.70158) => { x = clamp(x); return x * x * ((s + 1) * x - s); };
export const outElastic = (x) => { x = clamp(x); return x === 0 || x === 1 ? x : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1; };
export const outBounce = (x) => {
  x = clamp(x); const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};
// Analytic under-damped spring step response: 0 -> 1 with overshoot. t in seconds since trigger.
// freq Hz, damp 0..1 (0.25 bouncy, 0.6 firm)
export function spring(t, freq = 3, damp = 0.35) {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * freq;
  if (damp >= 1) return 1 - (1 + w * t) * Math.exp(-w * t);
  const wd = w * Math.sqrt(1 - damp * damp);
  return 1 - Math.exp(-damp * w * t) * (Math.cos(wd * t) + (damp / Math.sqrt(1 - damp * damp)) * Math.sin(wd * t));
}
// squash & stretch helper: returns {sx, sy} that preserves area, from a normalised "stretch" amount (+ = taller)
export function squash(stretch) {
  const sy = 1 + stretch, sx = 1 / Math.sqrt(Math.max(0.2, sy));
  return { sx, sy };
}
// pulse that rises quickly and decays (for hits): value at time since hit
export const pulse = (dt, tau = 0.15) => (dt < 0 ? 0 : Math.exp(-dt / tau));
// triangular window 0->1->0 across [a,b]
export const tri = (x, a, b) => { const m = (a + b) / 2; return x <= a || x >= b ? 0 : x < m ? (x - a) / (m - a) : (b - x) / (b - m); };
// window: 1 inside [a,b] with fade in/out
export const win = (x, a, b, fi = 0.1, fo = 0.1) => smooth((x - a) / Math.max(1e-6, fi)) * smooth((b - x) / Math.max(1e-6, fo));
