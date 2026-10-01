// Deterministic randomness: every value is a pure function of its integer/float inputs.
// NEVER use Math.random / Date.now anywhere in the film. Use these.

export function hash32(n) {
  n = n | 0;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return (n ^ (n >>> 16)) >>> 0;
}
const F32 = 1 / 4294967296;

// hash(a, b, c, ...) -> [0,1). Numbers may be floats (they are floored after *1000 scaling is NOT applied: pass ints!).
export function hash(...v) {
  let h = 0x9e3779b9;
  for (let i = 0; i < v.length; i++) h = hash32(h ^ hash32((v[i] * 1 + (i + 1) * 0x85ebca6b) | 0));
  return h * F32;
}
export const hashSigned = (...v) => hash(...v) * 2 - 1;

// string -> int seed
export function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Seeded stream (mulberry32). Local state only: call rng(seed) at the top of a draw function.
export function rng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) * F32;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.signed = () => r() * 2 - 1;
  r.int = (n) => Math.floor(r() * n);
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.gauss = () => (r() + r() + r() + r() - 2) * 0.866; // ~N(0,~0.58)
  return r;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
// smooth 1D value noise in [-1,1]
export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const a = hash(i, seed) * 2 - 1, b = hash(i + 1, seed) * 2 - 1;
  return a + (b - a) * fade(f);
}
// smooth 2D value noise in [-1,1]
export function noise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  const u = fade(fx), v = fade(fy);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
// fractal noise
export function fbm1(x, seed = 0, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise1(x * f, seed + i * 17); f *= 2; a *= 0.5; }
  return s;
}
export function fbm2(x, y, seed = 0, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f, seed + i * 17); f *= 2; a *= 0.5; }
  return s;
}
