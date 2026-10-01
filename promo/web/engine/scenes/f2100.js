// =============================================================================
// f2100 — 2100 · NEURAL CINEMA (44.0–46.0, 2.39). A story PAINTED FROM THOUGHT.
// A tall faceless crystal head-profile (left third) pours thousands of luminous ribbons from its forehead; they weave
// through the air and PAINT a miniature dreamscape (moon, hills, a road, a castle) that assembles across the 2 s, each
// ribbon leaving a persistent trail. Amrita (right third) conducts them with a baton: they swirl on every beat.
//
// Everything is a pure function of T.lt: ribbon paths are evaluated on the GPU from seeded per-ribbon attributes,
// the painted strokes are baked once from deterministic geometry, the camera/baton/eyes are closed-form.
// Local helpers (built here, no other lib needed): ribbon shader (core + halo), reflective floor (three Reflector),
// crystal head loft, diorama fills, beams, haze, motes, glow sprites, 2D glitch overlay.
// =============================================================================
import { Reflector } from 'three/addons/objects/Reflector.js';
import { createAmrita } from '../amrita3d.js';
import { hash } from '../rng.js';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const H = (...v) => hash(...v);

// ---- world layout (meters, +Y up, camera looks toward -Z) ------------------------------------------------------------
const HEAD_POS = [-2.72, 0, -0.2], HEAD_S = 0.82, HEAD_YAW = -0.1;
const DIO = [0.35, 0.36, -0.10], DS = 1.22;    // diorama origin: x centre, y bottom, z centre plane; DS = size scale of the miniature
const AMR = [2.62, 1.34, 0.65];                // Amrita
const BATON_C = [1.66, 1.78, 1.2];            // baton conducting centre
const FOCUS_DIO = [0.35, 1.35, -0.1];

// ---- shared GLSL ------------------------------------------------------------------------------------------------------
const GLSL_NOISE = `
vec3 hash3(float n){ return fract(sin(vec3(n*127.1 + 1.7, n*311.7 + 9.2, n*74.7 + 3.3)) * 43758.5453); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
float bEnv(float a){ return a > 0.0 ? exp(-a * 5.0) * smoothstep(0.0, 0.03, a) : 0.0; }
`;

// =============================================================================
// RIBBONS — one shader, two modes. FLOW: path evaluated from per-ribbon seeds. BAKED: painted strokes (baked path).
// pass 0 = narrow bright CORE (writes depth so DOF knows where it is), pass 1 = wide soft HALO (additive, no depth write)
// =============================================================================
const RIBBON_VERT = `
uniform float uT, uPass, uWidth, uBright, uGlitch, uSettle;
uniform vec3 uEmit, uEmitB, uHead, uDio, uBaton, uC0, uC1, uC2, uC3;
uniform vec4 uBeat;
attribute float aS; attribute float aSide;
#ifdef FLOW
attribute vec4 aR;
#else
attribute vec3 aTan; attribute vec4 aP; attribute vec4 aQ;
#endif
varying vec3 vCol; varying float vSide; varying float vA;
const float PI = 3.14159265;
const float VOL[16] = float[16](0.0, 0.0, 1.0, 0.0, 2.0, 3.0, 2.0, 3.0, 0.0, 1.0, 3.0, 0.0, 0.0, 1.0, 2.0, 3.0);
${GLSL_NOISE}
vec3 pal(float k){
  k = fract(k);
  vec3 c = mix(uC0, uC1, smoothstep(0.30, 0.38, k));
  c = mix(c, uC2, smoothstep(0.74, 0.80, k));
  c = mix(c, uC3, smoothstep(0.90, 0.94, k));
  return c;
}
vec3 palKey(float key){
  if (key < 0.5) return uC0; if (key < 1.5) return uC1; if (key < 2.5) return uC2; if (key < 3.5) return uC3;
  return vec3(1.0, 0.92, 0.80);
}
float beatSum(){ return bEnv(uT - uBeat.x + 0.08) + bEnv(uT - uBeat.y) + bEnv(uT - uBeat.z) + bEnv(uT - uBeat.w); }
vec3 beatWarp(vec3 p, vec3 n1, vec3 n2, float amp){
  float dist = distance(p, uBaton);
  vec3 d = vec3(0.0);
  float a0 = uT - uBeat.x + 0.08, a1 = uT - uBeat.y, a2 = uT - uBeat.z, a3 = uT - uBeat.w;
  float e0 = bEnv(a0), e1 = bEnv(a1), e2 = bEnv(a2), e3 = bEnv(a3);
  float p0 = dist*4.5 - a0*13.0, p1 = dist*4.5 - a1*13.0 + 1.7, p2 = dist*4.5 - a2*13.0 + 3.4, p3 = dist*4.5 - a3*13.0 + 5.1;
  d += (n1*sin(p0) + n2*cos(p0)) * e0 + (n1*sin(p1) + n2*cos(p1)) * e1 + (n1*sin(p2) + n2*cos(p2)) * e2 + (n1*sin(p3) + n2*cos(p3)) * e3;
  return d * amp * (0.35 + 0.65*exp(-dist*0.22));
}
#ifdef FLOW
vec3 bez(vec3 a, vec3 b, vec3 c, vec3 d, float t){ float u = 1.0-t; return u*u*u*a + 3.0*u*u*t*b + 3.0*u*t*t*c + t*t*t*d; }
vec3 dbez(vec3 a, vec3 b, vec3 c, vec3 d, float t){ float u = 1.0-t; return 3.0*(u*u*(b-a) + 2.0*u*t*(c-b) + t*t*(d-c)); }
#endif
void main(){
  float s = aS;
  vec3 pos, tg, col; float alpha, width, tw;
#ifdef FLOW
  // ---- braided streams: ~16 coherent bundles of ~75 threads. Each braid has a role (roots / behind the painting / over the top /
  //      conducted by the baton / wisps / foreground), a hue, a launch beat; threads inside a braid deviate slightly.
  vec4 R = aR; vec3 sp = R.xyz - 0.5;
  float b = floor(R.w * 16.0);
  vec3 Rb = hash3(b + 1.0), Rb2 = hash3(b + 41.0);
  float root = 1.0 - step(0.5, b);
  float fg = 0.0;
  vec3 P0 = mix(mix(uEmit, uEmitB, R.y) + vec3(0.03 + sp.x*0.06, 0.0, sp.z*0.55), uHead + vec3(sp.x*0.9 - 0.1, 0.25 + sp.y*0.9, sp.z*0.6), root);
  vec3 Tg;
  if (b < 1.0) Tg = uEmit + sp*vec3(0.12, 0.4, 0.3);
  else if (b < 6.0) Tg = uDio + vec3(mix(-2.0, 2.0, (b - 2.0)/3.0) + Rb.x*0.5, 1.3 + Rb.y*1.3, -0.8 - Rb.z*0.9);       // aurora in the sky behind the painting
  else if (b < 8.0) Tg = uDio + vec3(mix(-1.3, 1.3, b - 6.0), 2.0 + Rb.y*0.4, -0.2 + Rb.z*0.8);                         // over the top
  else if (b < 11.0) Tg = uBaton + (Rb - 0.5)*vec3(0.9, 0.9, 0.7);                                                        // conducted
  else Tg = uEmit + vec3(-1.4 + Rb.x*3.2, 0.1 + Rb.y*1.8, -0.2 + (Rb.z - 0.5)*2.2);                                      // wisps around the head
  Tg += sp * 0.34 * (1.0 - root);
  vec3 d0 = normalize(vec3(0.9 + 0.9*Rb.x, 0.2 + 0.8*Rb.y, (Rb.z - 0.5)*1.6) + sp*0.45);
  float L0 = 1.2 + 1.7*Rb2.x;
  vec3 P1 = P0 + d0*L0;
  vec3 d3 = normalize(vec3(0.8, -0.5 + (Rb2.y - 0.5), (Rb2.z - 0.5)*1.4) + sp*0.35);
  float L2 = 0.9 + 1.5*Rb2.x;
  vec3 P2 = Tg - d3*L2;
  if (root > 0.5) { P1 = mix(P0, Tg, 0.33) + sp*0.3; P2 = mix(P0, Tg, 0.66) - sp.zyx*0.3; }
  vec3 bz = bez(P0, P1, P2, Tg, s), db = dbez(P0, P1, P2, Tg, s);
  vec3 dbn = normalize(db + vec3(1e-4));
  vec3 n1 = normalize(cross(dbn, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 n2 = cross(n1, dbn);
  float env = pow(max(sin(PI*s), 0.0), 0.7) * (0.15 + 0.85*smoothstep(0.0, 0.35, s));
  float amp = (0.10 + 0.34*Rb2.y) * env * (1.0 - 0.85*root);
  float frq = 0.55 + 0.75*Rb.x, dph = 2.0*PI*frq;
  float ph = dph*s - uT*(1.2 + 1.0*Rb.y) + Rb2.z*20.0 + sp.x*1.6, ph2 = ph*0.83 + 1.7;
  pos = bz + n1*sin(ph)*amp + n2*cos(ph2)*amp*0.85;
  tg = normalize(db + n1*cos(ph)*amp*dph - n2*sin(ph2)*0.83*dph*amp*0.85 + vec3(1e-4));
  pos += beatWarp(pos, n1, n2, 0.17*(1.0 - root));
  // volleys launch on the baton beats (lt = 0, .5, 1, 1.5); the first volley is already in flight on the cut
  float kv = VOL[int(b)];
  float dly = 0.5*kv - 0.30 - 0.18*step(kv, 0.5) + sp.y*0.16 + sp.x*0.08;
  float grow = 0.60 + 0.35*Rb2.x + 0.08*sp.z;
  float hh = clamp((uT - dly)/grow, 0.0, 1.0);
  float head = hh*hh*(3.0 - 2.0*hh);
  head = mix(head, 1.0, root);
  float life = Rb2.z < 0.55 ? 99.0 : 1.0 + 0.9*Rb.y + 0.2*sp.x;
  float tl = clamp((uT - dly - life)/(grow*0.9), 0.0, 1.0); tl = tl*tl*(3.0 - 2.0*tl);
  float vis = smoothstep(tl - 0.02, tl + 0.06, s) * (1.0 - smoothstep(head, head + 0.05, s));
  vis *= mix(step(0.001, hh), 1.0, root);
  vis *= mix((1.0 - smoothstep(head - 0.10, head, s)) * 0.7 + 0.3, 1.0, step(0.999, hh) + root);   // soft tip while growing
  float age = max(head - s, 0.0);
  float hot = exp(-age*14.0) * mix(1.0, 0.25, step(0.999, hh)) * (1.0 - root);
  float pulse = pow(0.5 + 0.5*sin(2.0*PI*(s*(2.0 + 3.0*Rb.x) - uT*(0.9 + 1.2*Rb.y) + Rb.z*9.0 + sp.y*0.5)), 5.0);
  float sf = smoothstep(0.02, 0.40, s);
  float inten = 0.21 * (0.22 + 1.5*pulse) * (0.25 + 0.75*sf*sf) * (1.0 - smoothstep(0.78, 1.0, s));
  float ck = fract(Rb.x*5.31 + Rb2.y*2.7 + sp.x*0.30);
  float silk = smoothstep(0.62, 0.84, fract(R.y*17.3 + R.x*5.0));
  col = pal(ck) * inten + vec3(1.0, 0.92, 1.0)*hot*0.5*(0.2 + 0.8*sf);
  col *= mix(1.0, 0.65, root) * (1.0 + 0.5*fg) / (1.0 + 0.9*silk);
  alpha = vis * uBright * mix(1.0, 0.8, root) * (1.0 - 0.32*step(10.5, b));      // wisps a touch dimmer: keeps the crown from fogging to white
  width = uWidth * (0.55 + 0.9*fract(R.z*3.7)) * (0.35 + 0.65*sin(PI*s)) * mix(1.0, 0.5, root) * (1.0 + 1.5*fg) * (1.0 + 2.2*silk);
  tw = 2.0*PI*(R.z*3.0 + s*1.3) + uT*(0.8 + R.x);
#else
  pos = position; tg = normalize(aTan);
  float t0 = aP.x, dur = aP.y, af = aP.z, key = aP.w;
  float seed = aQ.x;
  float h = clamp((uT - t0)/dur, 0.0, 1.0);
  float vis = (1.0 - smoothstep(h, h + 0.012, s)) * step(0.0005, h);
  float comet = s < af ? 1.0 - smoothstep(0.0, 0.14, h - s) : 1.0;
  vis *= comet;
  float age = (uT - t0) - s*dur;
  float isStroke = step(af, s);
  float hot = exp(-max(age, 0.0)*5.5) * (0.6 + 0.4*isStroke);
  vec3 n1 = normalize(cross(tg, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 n2 = cross(n1, tg);
  // approach: free swirl; stroke: tiny shimmer
  float ph = s*19.0 - uT*5.0 + seed*40.0;
  float wob = mix(0.10 * sin(PI*clamp(s/max(af, 0.01), 0.0, 1.0)), 0.0035, isStroke);
  pos += (n1*sin(ph) + n2*cos(ph*0.8 + 1.0)) * wob;
  pos += beatWarp(pos, n1, n2, mix(0.05, 0.022, isStroke));
  float bs = beatSum();
  float inten = aQ.z * (0.85 + 0.9*bs) * (0.9 + 0.2*sin(uT*3.0 + seed*30.0 + s*25.0));
  col = palKey(key) * inten + vec3(1.0, 0.92, 0.85)*hot*2.0;
  alpha = vis * uBright;
  width = uWidth * aQ.y * (isStroke > 0.5 ? 1.0 : 0.75) * (0.55 + 0.45*sin(PI*clamp(s, 0.02, 0.98)));
  tw = 0.5*sin(s*7.0 + seed*20.0);
#endif
  // digital glitch pop: stepped row tears
  if (uGlitch > 0.001) {
    float gy = floor(pos.y*8.0) + floor(uT*60.0 + 5.0)*3.0;
    float on = step(0.62, fract(sin(gy*7.31)*931.7));
    pos.x += (fract(sin(gy*12.9898)*43758.5453) - 0.5) * uGlitch * 0.45 * on;
    alpha *= 1.0 + 0.6*on*uGlitch;
  }
  vec3 camDir = normalize(cameraPosition - pos);
  vec3 p1 = normalize(cross(tg, camDir) + vec3(1e-5));
  vec3 p2 = cross(tg, p1);
  float wmul = (uPass > 0.5 && uPass < 1.5) ? 2.6 : 1.0;
  pos += (p1*cos(tw) + p2*sin(tw)) * aSide * width * wmul;
  vCol = col; vSide = aSide; vA = alpha;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}`;

const RIBBON_FRAG = `
uniform float uPass;
varying vec3 vCol; varying float vSide; varying float vA;
void main(){
  if (vA < 0.004) discard;
  float x = abs(vSide);
  vec3 c;
  if (uPass > 1.5) {            // depth proxy: only the bright cores write depth (so DOF knows the ribbon's distance) — no colour
    float L = dot(vCol, vec3(0.3, 0.5, 0.2)) * vA;
    if (L < 0.2 || x > 0.8) discard;
    gl_FragColor = vec4(0.0);
    return;
  }
  if (uPass < 0.5) {
    float prof = 1.0 - smoothstep(0.5, 1.0, x);
    if (prof < 0.12) discard;
    c = vCol * vA * prof;
    c = mix(c, vec3(dot(c, vec3(0.33))) * vec3(1.0, 0.95, 1.0) * 1.15, 0.06);
  } else {
    float prof = exp(-x*x*3.2) * 0.07;
    c = vCol * vA * prof;
  }
  gl_FragColor = vec4(c, 1.0);
}`;

function ribbonMaterial(THREE, U, { flow, pass, width }) {
  const m = new THREE.ShaderMaterial({
    defines: flow ? { FLOW: 1 } : {},
    uniforms: { ...U, uPass: { value: pass }, uWidth: { value: width } },
    vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG,
    transparent: true, blending: pass === 2 ? THREE.NoBlending : THREE.AdditiveBlending, depthWrite: pass === 2, colorWrite: pass !== 2, depthTest: true, side: THREE.DoubleSide,
  });
  if (pass === 1) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1; }
  return m;
}

function buildFlowGeometry(THREE, NF, M) {
  const nv = NF * (M + 1) * 2;
  const pos = new Float32Array(nv * 3), aS = new Float32Array(nv), aSide = new Float32Array(nv), aR = new Float32Array(nv * 4);
  const idx = new Uint32Array(NF * M * 6);
  let v = 0, k = 0;
  for (let r = 0; r < NF; r++) {
    const R = [H(r, 11), H(r, 12), H(r, 13), (r + H(r, 14)) / NF];
    const base = v;
    for (let j = 0; j <= M; j++) for (let sd = -1; sd <= 1; sd += 2) {
      aS[v] = j / M; aSide[v] = sd; aR[v * 4] = R[0]; aR[v * 4 + 1] = R[1]; aR[v * 4 + 2] = R[2]; aR[v * 4 + 3] = R[3]; v++;
    }
    for (let j = 0; j < M; j++) { const a = base + j * 2; idx[k++] = a; idx[k++] = a + 1; idx[k++] = a + 2; idx[k++] = a + 1; idx[k++] = a + 3; idx[k++] = a + 2; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aS', new THREE.BufferAttribute(aS, 1)); g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1)); g.setAttribute('aR', new THREE.BufferAttribute(aR, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// ---- stroke baking --------------------------------------------------------------------------------------------------
function resample(pts, spacing) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const L = cum[cum.length - 1], n = clamp(Math.ceil(L / spacing), 8, 140), out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = (i / (n - 1)) * L;
    while (j < pts.length - 2 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j] || 1, f = clamp((d - cum[j]) / seg);
    out.push([lerp(pts[j][0], pts[j + 1][0], f), lerp(pts[j][1], pts[j + 1][1], f), lerp(pts[j][2], pts[j + 1][2], f)]);
  }
  return { pts: out, len: L };
}
const bez3 = (a, b, c, d, t) => { const u = 1 - t, k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1, 2].map((i) => k[0] * a[i] + k[1] * b[i] + k[2] * c[i] + k[3] * d[i]); };
const nrm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

function buildStrokeGeometry(THREE, strokes, emit) {
  const verts = []; // {p, s, side, P:[t0,dur,af,key], Q:[seed,w,inten,0]}
  const idxArr = [];
  strokes.forEach((st, i) => {
    const rs = resample(st.pts, 0.026), P = rs.pts, n = P.length;
    const S0 = P[0], tan0 = nrm([P[Math.min(4, n - 1)][0] - P[0][0], P[Math.min(4, n - 1)][1] - P[0][1], P[Math.min(4, n - 1)][2] - P[0][2]]);
    const r = (k) => H(i, 700 + k);
    const E = [emit[0] + (r(1) - 0.5) * 0.14, emit[1] + (r(2) - 0.5) * 0.45, emit[2] + (r(3) - 0.5) * 0.3];
    const d0 = nrm([0.45 + 0.5 * r(4), 0.5 + 0.6 * r(5), (r(6) - 0.5) * 1.4]), L0 = 0.9 + 0.9 * r(7);
    const P1 = [E[0] + d0[0] * L0, E[1] + d0[1] * L0, E[2] + d0[2] * L0];
    const P2 = [S0[0] - tan0[0] * 0.6, S0[1] - tan0[1] * 0.6 + 0.55 + 0.4 * r(8), S0[2] - tan0[2] * 0.6 + (r(9) - 0.5) * 0.9];
    const A = 34, ap = [];
    for (let j = 0; j < A; j++) ap.push(bez3(E, P1, P2, S0, j / A));
    let aLen = 0; for (let j = 1; j < A; j++) aLen += Math.hypot(ap[j][0] - ap[j - 1][0], ap[j][1] - ap[j - 1][1], ap[j][2] - ap[j - 1][2]);
    const da = clamp(aLen / 9.0, 0.34, 0.6), dp = st.dp, dur = da + dp, af = da / dur, t0 = st.tp0 - da;
    const all = [], sv = [];
    for (let j = 0; j < A; j++) { all.push(ap[j]); sv.push(af * (j / A)); }
    for (let j = 0; j < n; j++) { all.push(P[j]); sv.push(af + (1 - af) * (j / (n - 1))); }
    const base = verts.length;
    for (let j = 0; j < all.length; j++) {
      const a = all[Math.max(0, j - 1)], b = all[Math.min(all.length - 1, j + 1)];
      const tg = nrm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      for (let sd = -1; sd <= 1; sd += 2) verts.push({ p: all[j], tg, s: sv[j], side: sd, P: [t0, dur, af, st.key], Q: [r(10), st.w ?? 1, st.inten ?? 1, 0] });
    }
    for (let j = 0; j < all.length - 1; j++) { const a = base + j * 2; idxArr.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const nv = verts.length;
  const pos = new Float32Array(nv * 3), tan = new Float32Array(nv * 3), aS = new Float32Array(nv), aSide = new Float32Array(nv), aP = new Float32Array(nv * 4), aQ = new Float32Array(nv * 4);
  verts.forEach((v, i) => {
    pos.set(v.p, i * 3); tan.set(v.tg, i * 3); aS[i] = v.s; aSide[i] = v.side; aP.set(v.P, i * 4); aQ.set(v.Q, i * 4);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aTan', new THREE.BufferAttribute(tan, 3));
  g.setAttribute('aS', new THREE.BufferAttribute(aS, 1)); g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
  g.setAttribute('aP', new THREE.BufferAttribute(aP, 4)); g.setAttribute('aQ', new THREE.BufferAttribute(aQ, 4));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idxArr), 1));
  return g;
}

// =============================================================================
// THE PAINTED DREAMSCAPE (diorama): ridges, castle, road, moon, trees, stars — strokes + opaque emissive fills
// =============================================================================
const ridge1 = (x) => 0.80 + 0.15 * Math.sin(1.3 * x + 0.4) + 0.07 * Math.sin(3.1 * x + 1.9) + 0.04 * Math.sin(6.3 * x + 0.2) + 0.24 * Math.exp(-(((x - 0.78) / 0.42) ** 2));
const ridge2 = (x) => 0.50 + 0.13 * Math.sin(1.7 * x + 2.0) + 0.06 * Math.sin(4.0 * x + 0.7) - 0.11 * Math.exp(-(((x - 0.30) / 0.5) ** 2));
const ridge3L = (x) => 0.26 + 0.10 * Math.sin(2.4 * x + 0.9) + 0.04 * Math.sin(5.1 * x) + 0.1 * Math.exp(-(((x + 1.35) / 0.3) ** 2));
const ridge3R = (x) => 0.20 + 0.07 * Math.sin(2.8 * x + 0.3) + 0.03 * Math.sin(6 * x) + 0.1 * Math.exp(-(((x - 1.4) / 0.3) ** 2));
const CASTLE = { x: 0.80, k: 0.92 };
CASTLE.y = ridge1(CASTLE.x) - 0.03;
const MOON = { x: -0.66, y: 1.60, r: 0.27 };
const ROAD = (u) => ({ x: -0.34 + 0.98 * u + 0.30 * Math.sin(3.4 * u * Math.PI * 0.9) * (1 - u * 0.6), y: -0.02 + (CASTLE.y + 0.04 + 0.02) * Math.pow(u, 0.92) * 0.98 - 0.02 * 0, w: 0.40 * (1 - u) + 0.045 });

function line(xs, f, step = 0.03) { const o = []; for (let i = 0; i < xs.length; i++) o.push([xs[i], f(xs[i])]); return o; }
function xsRange(a, b, n) { const o = []; for (let i = 0; i <= n; i++) o.push(lerp(a, b, i / n)); return o; }
function arcPts(cx, cy, r, a0, a1, n = 48) { const o = []; for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return o; }

function crescentOutline() {
  // moon disc cut by an offset disc -> crescent (unit radius, centred 0,0). returns closed outline points (local, unit r)
  const c = [0.40, 0.14], rc = 0.86, N = 300, outer = [], inner = [];
  for (let i = 0; i < N; i++) { const a = (i / N) * TAU, p = [Math.cos(a), Math.sin(a)]; if (Math.hypot(p[0] - c[0], p[1] - c[1]) > rc) outer.push(p); }
  for (let i = 0; i < N; i++) { const a = (i / N) * TAU, p = [c[0] + Math.cos(a) * rc, c[1] + Math.sin(a) * rc]; if (Math.hypot(p[0], p[1]) < 1) inner.push(p); }
  // outer is contiguous but may wrap; rotate so it is monotone
  const rot = (arr, test) => { let k = 0; for (let i = 0; i < arr.length; i++) { const a = arr[i], b = arr[(i + arr.length - 1) % arr.length]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.1) { k = i; break; } } return arr.slice(k).concat(arr.slice(0, k)); };
  const O = rot(outer), I = rot(inner), d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const Ie = d(O[O.length - 1], I[0]) < d(O[O.length - 1], I[I.length - 1]) ? I : I.slice().reverse();
  return O.concat(Ie, [O[0]]);
}

function buildDioramaData() {
  const strokes = [], fills = [], sparkles = [];
  const add = (pts2, z, tp0, dp, key, w = 1, inten = 1) => strokes.push({ pts: pts2.map(([x, y]) => [DIO[0] + x * DS, DIO[1] + y * DS, DIO[2] + z]), tp0, dp, key, w, inten });
  const X0 = -1.5, X1 = 1.5;

  // ---- moon (z -0.75): crescent outline + faint full disc ring + halo
  const cres = crescentOutline().map(([x, y]) => [MOON.x + x * MOON.r, MOON.y + y * MOON.r]);
  add(cres, -0.74, -0.05, 0.50, 4, 1.15, 1.5);
  add(arcPts(MOON.x, MOON.y, MOON.r * 1.18, 0.4, 0.4 + TAU * 0.92, 56), -0.76, 0.05, 0.55, 0, 0.8, 0.9);
  add(arcPts(MOON.x, MOON.y, MOON.r * 1.45, 2.2, 2.2 + TAU * 0.85, 64), -0.78, 0.15, 0.6, 3, 0.6, 0.6);
  fills.push({ kind: 'moon', z: -0.74, t0: 0.10, dur: 0.50 });

  // ---- far hills (z -0.55): ridge + 3 contour lines
  const xs1 = xsRange(X0, X1, 90);
  add(line(xs1, ridge1), -0.55, 0.18, 0.62, 0, 1.25, 1.35);
  add(line(xs1, (x) => ridge1(x) - 0.10 + 0.012 * Math.sin(9 * x)), -0.55, 0.30, 0.62, 3, 0.7, 0.7);
  add(line(xs1, (x) => ridge1(x) - 0.22 + 0.018 * Math.sin(7 * x + 1)), -0.55, 0.42, 0.62, 0, 0.6, 0.6);
  fills.push({ kind: 'hill', id: 'far', z: -0.55, f: ridge1, t0: 0.16, dur: 0.66, top: '#3a3fa8', bot: '#0a0d2c', rim: '#6B5BFF', y0: 0.0, y1: 1.15 });

  // ---- mid hills (z -0.2) with a valley for the road
  const xs2 = xsRange(X0, X1, 90);
  add(line(xs2, ridge2), -0.20, 0.45, 0.66, 1, 1.3, 1.3);
  add(line(xs2, (x) => ridge2(x) - 0.09 + 0.012 * Math.sin(8 * x + 2)), -0.20, 0.58, 0.62, 3, 0.65, 0.65);
  add(line(xs2, (x) => ridge2(x) - 0.19 + 0.015 * Math.sin(6 * x)), -0.20, 0.70, 0.60, 1, 0.55, 0.55);
  fills.push({ kind: 'hill', id: 'mid', z: -0.20, f: ridge2, t0: 0.44, dur: 0.70, top: '#0f6f78', bot: '#07122a', rim: '#1FB5A6', y0: 0.0, y1: 0.7 });

  // ---- castle (z -0.35)
  const cz = -0.35, ck = CASTLE.k, cx = CASTLE.x, cy = CASTLE.y;
  const C = (pts) => pts.map(([x, y]) => [cx + x * ck, cy + y * ck]);
  const t0c = 0.75;
  add(C([[-0.34, 0], [-0.34, 0.22], [-0.29, 0.22], [-0.29, 0.255], [-0.25, 0.255], [-0.25, 0.22], [-0.2, 0.22], [-0.2, 0.255], [-0.16, 0.255], [-0.16, 0.22], [0.16, 0.22], [0.16, 0.255], [0.2, 0.255], [0.2, 0.22], [0.25, 0.22], [0.25, 0.255], [0.29, 0.255], [0.29, 0.22], [0.34, 0.22], [0.34, 0]]), cz, t0c, 0.40, 2, 1.0, 1.15);
  add(C([[-0.09, 0.22], [-0.09, 0.62], [-0.13, 0.62], [0, 0.88], [0.13, 0.62], [0.09, 0.62], [0.09, 0.22]]), cz, t0c + 0.12, 0.42, 2, 1.1, 1.3);
  add(C([[-0.30, 0.22], [-0.30, 0.46], [-0.345, 0.46], [-0.235, 0.68], [-0.125, 0.46], [-0.17, 0.46], [-0.17, 0.22]]), cz, t0c + 0.22, 0.40, 4, 1.0, 1.1);
  add(C([[0.17, 0.22], [0.17, 0.42], [0.125, 0.42], [0.235, 0.62], [0.345, 0.42], [0.30, 0.42], [0.30, 0.22]]), cz, t0c + 0.30, 0.38, 4, 1.0, 1.1);
  add(C(arcPts(0, 0.0, 0.065, 0, Math.PI, 20).map(([x, y]) => [x, y + 0.02])), cz + 0.01, t0c + 0.45, 0.25, 2, 0.8, 1.2);
  add(C([[0, 0.88], [0, 1.0], [0.1, 0.96], [0, 0.92]]), cz, t0c + 0.50, 0.22, 3, 0.7, 1.2);
  add(C([[-0.235, 0.68], [-0.235, 0.78], [-0.15, 0.745], [-0.235, 0.71]]), cz, t0c + 0.55, 0.20, 3, 0.7, 1.2);
  fills.push({ kind: 'poly', z: cz, t0: t0c, dur: 0.70, top: '#2a2a78', bot: '#1a1650', rim: '#FFB62E', shapes: [
    C([[-0.34, 0], [-0.34, 0.22], [0.34, 0.22], [0.34, 0]]),
    C([[-0.09, 0.22], [-0.09, 0.62], [-0.13, 0.62], [0, 0.88], [0.13, 0.62], [0.09, 0.62], [0.09, 0.22]]),
    C([[-0.30, 0.22], [-0.30, 0.46], [-0.345, 0.46], [-0.235, 0.68], [-0.125, 0.46], [-0.17, 0.46], [-0.17, 0.22]]),
    C([[0.17, 0.22], [0.17, 0.42], [0.125, 0.42], [0.235, 0.62], [0.345, 0.42], [0.30, 0.42], [0.30, 0.22]]),
  ], x0: cx - 0.35 * ck, x1: cx + 0.35 * ck, y0: cy, y1: cy + 0.9 * ck });
  // windows light up last (amber sparkles)
  const win = [[0, 0.5], [0, 0.36], [-0.235, 0.34], [0.235, 0.32], [0, 0.06]];
  win.forEach(([x, y], i) => sparkles.push({ p: [DIO[0] + (cx + x * ck) * DS, DIO[1] + (cy + y * ck) * DS, DIO[2] + cz + 0.03], t: 1.38 + 0.09 * i, size: 0.075, kind: 'win' }));

  // ---- road (z +0.05): two edges + centre dashes + glowing fill
  const L = [], Rr = [], Cc = [];
  for (let i = 0; i <= 40; i++) { const u = i / 40, r = ROAD(u); L.push([r.x - r.w / 2, r.y]); Rr.push([r.x + r.w / 2, r.y]); Cc.push([r.x, r.y]); }
  add(L, 0.05, 0.92, 0.55, 2, 1.0, 1.2);
  add(Rr, 0.05, 0.98, 0.55, 2, 1.0, 1.2);
  for (let d = 0; d < 6; d++) { const a = 0.08 + d * 0.15, b = a + 0.07; add(Cc.slice(Math.floor(a * 40), Math.ceil(b * 40) + 1), 0.06, 1.20 + d * 0.06, 0.14, 4, 0.8, 1.3); }
  fills.push({ kind: 'road', z: 0.05, t0: 0.92, dur: 0.62, L, R: Rr, top: '#e8a948', bot: '#c9852a', rim: '#FFB62E', y0: 0, y1: 0.7 });

  // ---- near hills + trees (z +0.25)
  const xs3L = xsRange(X0, -0.45, 40), xs3R = xsRange(0.85, X1, 30);
  add(line(xs3L, ridge3L), 0.25, 1.05, 0.45, 1, 1.35, 1.2);
  add(line(xs3R, ridge3R), 0.25, 1.12, 0.40, 1, 1.35, 1.2);
  add(line(xs3L, (x) => ridge3L(x) - 0.08), 0.25, 1.2, 0.4, 0, 0.6, 0.6);
  fills.push({ kind: 'hill', id: 'nearL', z: 0.25, f: ridge3L, xa: X0, xb: -0.45, t0: 1.0, dur: 0.48, top: '#0a4f5c', bot: '#050a1c', rim: '#1FB5A6', y0: 0, y1: 0.45 });
  fills.push({ kind: 'hill', id: 'nearR', z: 0.25, f: ridge3R, xa: 0.85, xb: X1, t0: 1.08, dur: 0.42, top: '#0a4f5c', bot: '#050a1c', rim: '#1FB5A6', y0: 0, y1: 0.4 });
  const trees = [[-1.2, 0.62], [-0.95, 0.4], [1.2, 0.55]];
  trees.forEach(([tx, sc], i) => {
    const gy = (tx < 0 ? ridge3L(tx) : ridge3R(tx)) - 0.01, tt = 1.25 + 0.1 * i, r = 0.085 * sc / 0.62;
    add([[tx, gy], [tx, gy + 0.11 * sc / 0.62]], 0.27, tt, 0.14, 2, 0.8, 1.1);
    add(arcPts(tx, gy + 0.11 * sc / 0.62 + r, r, -1.6, -1.6 + TAU, 28), 0.27, tt + 0.1, 0.30, 3, 0.9, 1.2);
  });

  // ---- stars (sparkle points) + fireflies
  for (let i = 0; i < 46; i++) {
    const x = lerp(-1.45, 1.45, H(i, 51)), y = lerp(1.05, 1.95, H(i, 52));
    if (Math.hypot(x - MOON.x, y - MOON.y) < 0.4) continue;
    if (Math.abs(x - CASTLE.x) < 0.45 && y < CASTLE.y + 0.9) continue;
    if (y < ridge1(x) + 0.12) continue;
    sparkles.push({ p: [DIO[0] + x * DS, DIO[1] + y * DS, DIO[2] + lerp(-0.9, -0.65, H(i, 53))], t: 0.05 + 1.35 * ((x + 1.5) / 3) + 0.25 * H(i, 54), size: lerp(0.035, 0.07, H(i, 55)), kind: 'star' });
  }
  for (let i = 0; i < 14; i++) sparkles.push({ p: [DIO[0] + lerp(-1.3, 1.3, H(i, 61)) * DS, DIO[1] + lerp(0.15, 1.0, H(i, 62)) * DS, DIO[2] + lerp(0.3, 0.55, H(i, 63))], t: 1.3 + 0.5 * H(i, 64), size: 0.05, kind: 'fly' });
  return { strokes, fills, sparkles };
}

// ---- fills ----------------------------------------------------------------------------------------------------------
const FILL_VERT = `varying vec3 vL; void main(){ vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FILL_FRAG = `
uniform float uT, uT0, uDur, uX0, uX1, uBright, uY0, uY1, uHot, uRoad, uEdge; uniform vec3 uTop, uBot, uRim; uniform vec4 uBeat;
varying vec3 vL;
${GLSL_NOISE}
void main(){
  float u = (vL.x - uX0) / (uX1 - uX0);
  float head = (uT - uT0) / uDur;
  float n = vn(vL.xy * 9.0);
  float k = clamp((vL.y - uY0) / (uY1 - uY0), 0.0, 1.0);
  float front = head * 1.28 - u - 0.20 * (1.0 - k) - n * 0.14 - 0.03;     // slanted, noisy brush front (the paint follows the ribbon)
  if (front < 0.0) discard;
  vec3 c = mix(uBot, uTop, pow(k, 1.3));
  if (uRoad > 0.5) c = mix(uBot, uTop, 0.5 + 0.5*sin(vL.y*18.0) * 0.2 + 0.3*k);
  float cl = smoothstep(0.90, 1.0, sin(vL.y * 52.0 + vL.x * 1.7 + n)) * 0.10;
  c += uRim * cl;
  c *= 0.82 + 0.36 * fbm(vL.xy * 6.0 + uT * 0.15);
  float hot = 1.0 - smoothstep(0.0, 0.16, front);
  c += uRim * hot * uHot * 2.2;
  float ef = 1.0;
  if (uEdge > 0.0) ef = smoothstep(0.0, uEdge * (1.0 + 0.5*n), min(vL.x - uX0, uX1 - vL.x)) * smoothstep(0.0, uEdge * 1.6, vL.y - uY0 + 0.06);
  c *= ef;
  float be = bEnv(uT - uBeat.x + 0.08) + bEnv(uT - uBeat.y) + bEnv(uT - uBeat.z) + bEnv(uT - uBeat.w);
  c *= 1.0 + 0.30 * be;
  float a = ef * smoothstep(0.0, 0.20, front) * mix(0.92, 1.0, uRoad);
  if (a < 0.06) discard;
  gl_FragColor = vec4(c * uBright, a);
}`;
function fillMaterial(THREE, U, f, o) {
  const col = (h) => new THREE.Color(h);
  return new THREE.ShaderMaterial({
    uniforms: { uT: U.uT, uBeat: U.uBeat, uBright: U.uFillBright, uT0: { value: f.t0 }, uDur: { value: f.dur }, uX0: { value: o.x0 }, uX1: { value: o.x1 }, uY0: { value: o.y0 }, uY1: { value: o.y1 }, uHot: { value: 1 }, uRoad: { value: f.kind === 'road' ? 1 : 0 }, uEdge: { value: f.kind === 'hill' ? 0.38 : 0 }, uTop: { value: col(f.top) }, uBot: { value: col(f.bot) }, uRim: { value: col(f.rim) } },
    vertexShader: FILL_VERT, fragmentShader: FILL_FRAG, side: THREE.DoubleSide, transparent: true, depthWrite: true,
  });
}
function buildFills(THREE, U, data) {
  const group = new THREE.Group();
  for (const f of data.fills) {
    let mesh;
    if (f.kind === 'hill') {
      const xa = f.xa ?? -1.5, xb = f.xb ?? 1.5, N = 80, pos = [], idx = [];
      for (let i = 0; i <= N; i++) { const x = lerp(xa, xb, i / N); pos.push(x, f.f(x), 0, x, -0.06, 0); }
      for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      mesh = new THREE.Mesh(g, fillMaterial(THREE, U, f, { x0: xa, x1: xb, y0: f.y0, y1: f.y1 }));
      mesh.position.set(DIO[0], DIO[1], DIO[2] + f.z); mesh.scale.set(DS, DS, 1);
    } else if (f.kind === 'poly') {
      const geos = f.shapes.map((pts) => new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))));
      const g = mergeGeos(THREE, geos);
      mesh = new THREE.Mesh(g, fillMaterial(THREE, U, f, { x0: f.x0, x1: f.x1, y0: f.y0, y1: f.y1 }));
      mesh.position.set(DIO[0], DIO[1], DIO[2] + f.z); mesh.scale.set(DS, DS, 1);
    } else if (f.kind === 'road') {
      const pos = [], idx = [], N = f.L.length - 1;
      for (let i = 0; i <= N; i++) { pos.push(f.L[i][0], f.L[i][1], 0, f.R[i][0], f.R[i][1], 0); }
      for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      mesh = new THREE.Mesh(g, fillMaterial(THREE, U, f, { x0: -0.6, x1: 1.0, y0: f.y0, y1: f.y1 }));
      mesh.material.uniforms.uDur.value = f.dur; mesh.position.set(DIO[0], DIO[1], DIO[2] + f.z); mesh.scale.set(DS, DS, 1);
    } else if (f.kind === 'moon') {
      mesh = new THREE.Mesh(new THREE.CircleGeometry(MOON.r, 56), moonMaterial(THREE, U, f));
      mesh.position.set(DIO[0] + MOON.x * DS, DIO[1] + MOON.y * DS, DIO[2] + f.z); mesh.scale.set(DS, DS, 1);
    }
    mesh.matrixAutoUpdate = false; mesh.updateMatrix(); mesh.frustumCulled = false; mesh.renderOrder = 0;
    group.add(mesh);
  }
  return group;
}
function mergeGeos(THREE, geos) {
  const pos = [], idx = []; let off = 0;
  for (const g of geos) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), 0); const ix = g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, i) => i); for (const i of ix) idx.push(i + off); off += p.count; }
  const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); m.setIndex(idx); return m;
}
function moonMaterial(THREE, U, f) {
  return new THREE.ShaderMaterial({
    uniforms: { uT: U.uT, uBright: U.uFillBright, uT0: { value: f.t0 }, uDur: { value: f.dur }, uR: { value: MOON.r } },
    vertexShader: FILL_VERT,
    fragmentShader: `uniform float uT, uT0, uDur, uBright, uR; varying vec3 vL; ${GLSL_NOISE}
    void main(){
      vec2 p = vL.xy / uR; float r = length(p);
      float ang = atan(p.y, p.x) / 6.2831853 + 0.5;
      float head = (uT - uT0) / uDur;
      if (ang > head * 1.05) discard;
      float cut = length(p - vec2(0.40, 0.14));
      vec3 c;
      if (cut < 0.86) c = vec3(0.10, 0.09, 0.36) * (0.8 + 0.4*vn(p*5.0));       // faint dark limb
      else c = vec3(1.0, 0.86, 0.55) * (0.95 + 0.35*vn(p*7.0 + uT*0.3));        // lit crescent
      gl_FragColor = vec4(c * uBright, 1.0);
    }`,
    side: THREE.DoubleSide, transparent: true, depthWrite: true,
  });
}

// ---- sparkles (stars / window lights / fireflies): points with a 4-point flare ----------------------------------------
function buildSparkles(THREE, U, list) {
  const n = list.length, pos = new Float32Array(n * 3), aT = new Float32Array(n), aSz = new Float32Array(n), aK = new Float32Array(n), aH = new Float32Array(n);
  list.forEach((s, i) => { pos.set(s.p, i * 3); aT[i] = s.t; aSz[i] = s.size; aK[i] = s.kind === 'win' ? 1 : s.kind === 'fly' ? 2 : 0; aH[i] = H(i, 91); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aT', new THREE.BufferAttribute(aT, 1)); g.setAttribute('aSz', new THREE.BufferAttribute(aSz, 1)); g.setAttribute('aK', new THREE.BufferAttribute(aK, 1)); g.setAttribute('aH', new THREE.BufferAttribute(aH, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uT: U.uT, uPx: U.uPx, uBright: U.uBright },
    vertexShader: `uniform float uT, uPx; attribute float aT, aSz, aK, aH; varying float vK, vI; varying float vH;
      void main(){ vec3 p = position; vK = aK; vH = aH;
        if (aK > 1.5) { p.y += sin(uT*0.9 + aH*6.28)*0.06 + 0.05*uT; p.x += cos(uT*0.7 + aH*9.0)*0.05; }
        float age = uT - aT; float pop = age > 0.0 ? (1.0 + 1.6*exp(-age*7.0)) * (1.0 - exp(-age*28.0)) : 0.0;
        float tw = 0.65 + 0.35*sin(uT*(2.0 + 3.0*aH) + aH*40.0);
        vI = pop * tw * (aK > 0.5 && aK < 1.5 ? 1.6 : 1.0);
        vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSz * pop * uPx / max(-mv.z, 0.1) * 2.6, 0.0, 120.0 * uPx / 1675.0); }`,
    fragmentShader: `uniform float uBright; varying float vK, vI, vH;
      void main(){ vec2 q = gl_PointCoord - 0.5; float d = length(q) * 2.0; if (vI < 0.01 || d > 1.0) discard;
        float core = exp(-d*d*14.0);
        float cross = (exp(-abs(q.x)*38.0) * (1.0 - smoothstep(0.0, 0.5, abs(q.y))) + exp(-abs(q.y)*38.0) * (1.0 - smoothstep(0.0, 0.5, abs(q.x)))) * 0.8;
        vec3 col = vK > 0.5 && vK < 1.5 ? vec3(1.0, 0.62, 0.16) : vK > 1.5 ? vec3(1.0, 0.8, 0.35) : mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.95, 0.85), vH);
        gl_FragColor = vec4(col * (core * 2.2 + cross) * vI * uBright * (vK > 0.5 && vK < 1.5 ? 1.8 : 1.0), 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: true, depthTest: true,
  });
  const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 12; return p;
}

// ---- ambient motes ------------------------------------------------------------------------------------------------------
function buildMotes(THREE, U, { n, min, size, sizeMul, tint, seed, drift = 1, alpha = 1 }) {
  const aSeed = new Float32Array(n * 4), pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) aSeed[i * 4 + k] = H(i, seed + k);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 4));
  const m = new THREE.ShaderMaterial({
    uniforms: { uT: U.uT, uPx: U.uPx, uMin: { value: new THREE.Vector3(...min) }, uSize: { value: new THREE.Vector3(...size) }, uPt: { value: sizeMul }, uDrift: { value: drift }, uTint: { value: new THREE.Color(tint) }, uA: { value: alpha } },
    vertexShader: `uniform float uT, uPx, uPt, uDrift; uniform vec3 uMin, uSize; attribute vec4 aSeed; varying float vI; varying vec3 vC;
      void main(){ vec3 p = uMin + aSeed.xyz * uSize; float w = aSeed.w;
        p.x += sin(uT*(0.2 + 0.3*w)*uDrift + aSeed.y*6.28)*0.35; p.z += cos(uT*(0.25 + 0.2*aSeed.x)*uDrift + aSeed.z*6.28)*0.3;
        p.y = uMin.y + mod(aSeed.y*uSize.y + uT*(0.05 + 0.12*w)*uDrift, uSize.y);
        vec4 mv = viewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uPt * (0.4 + w) * uPx / max(-mv.z, 0.2), 1.0, 70.0 * uPx / 838.0);
        vI = 0.35 + 0.65*pow(0.5 + 0.5*sin(uT*3.0 + aSeed.x*40.0), 2.0);
        vC = mix(vec3(0.15, 0.7, 0.65), vec3(0.35, 0.3, 1.0), step(0.5, fract(aSeed.x*7.3)));
        vC = mix(vC, vec3(1.0, 0.6, 0.15), step(0.84, fract(aSeed.z*11.1))); }`,
    fragmentShader: `uniform vec3 uTint; uniform float uA; varying float vI; varying vec3 vC;
      void main(){ vec2 q = gl_PointCoord - 0.5; float d = length(q)*2.0; if (d > 1.0) discard; float a = pow(1.0 - d, 1.6);
        gl_FragColor = vec4(vC * uTint * a * vI * uA * 3.0, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: true, depthTest: true,
  });
  const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 13; return p;
}

// ---- glow sprite (billboard radial gradient + optional streaks) ----------------------------------------------------------
function glowSprite(THREE, { color, size, streak = 0, power = 2.2 }) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(color) }, uK: { value: 1 }, uStreak: { value: streak }, uPow: { value: power } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uCol; uniform float uK, uStreak, uPow; varying vec2 vUv;
      void main(){ vec2 q = vUv - 0.5; float d = length(q)*2.0; float g = pow(max(1.0 - d, 0.0), uPow);
        float st = uStreak * (exp(-abs(q.y)*60.0) * (1.0 - smoothstep(0.0, 0.5, abs(q.x))) + 0.5*exp(-abs(q.x)*60.0) * (1.0 - smoothstep(0.0, 0.5, abs(q.y))));
        gl_FragColor = vec4(uCol * (g + st) * uK, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m); mesh.frustumCulled = false; mesh.renderOrder = 14; mesh.userData.size = size; return mesh;
}

// ---- volumetric beam: a soft-edged light shaft (camera-facing strip along the axis, gaussian across, dust streaks) ----------------
function buildBeam(THREE, U, { from, to, r0, r1, color, k }) {
  const g = new THREE.PlaneGeometry(1, 1, 1, 10);
  const m = new THREE.ShaderMaterial({
    uniforms: { uT: U.uT, uCol: { value: new THREE.Color(color) }, uK: { value: k }, uFrom: { value: new THREE.Vector3(...from) }, uTo: { value: new THREE.Vector3(...to) }, uR0: { value: r0 }, uR1: { value: r1 } },
    vertexShader: `uniform vec3 uFrom, uTo; uniform float uR0, uR1; varying vec2 vQ;
      void main(){ float s = uv.y, x = uv.x*2.0 - 1.0; vec3 p = mix(uFrom, uTo, s); vec3 ax = normalize(uTo - uFrom);
        vec3 perp = normalize(cross(ax, cameraPosition - p) + vec3(1e-5)); p += perp * x * mix(uR0, uR1, s); vQ = vec2(x, s);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `uniform float uT, uK; uniform vec3 uCol; varying vec2 vQ; ${GLSL_NOISE}
      void main(){ float x = vQ.x, s = vQ.y;
        float across = exp(-x*x*2.6) * (1.0 - smoothstep(0.7, 1.0, abs(x)));
        float fade = smoothstep(0.0, 0.10, s) * (1.0 - smoothstep(0.5, 1.0, s));
        float dust = 0.6 + 0.4 * vn(vec2(x * 7.0, s * 5.0 - uT * 0.35));
        gl_FragColor = vec4(uCol * across * fade * dust * uK, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 15; return mesh;
}

// ---- haze plane (drifting noise, additive, denser near the floor) ----------------------------------------------------------
function buildHaze(THREE, U, { z, y, w, h, color, k, scale, speed }) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uT: U.uT, uCol: { value: new THREE.Color(color) }, uK: { value: k }, uS: { value: scale }, uSp: { value: speed } },
    vertexShader: 'varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
    fragmentShader: `uniform float uT, uK, uS, uSp; uniform vec3 uCol; varying vec3 vW; varying vec2 vUv; ${GLSL_NOISE}
      void main(){ float n = fbm(vec2(vW.x * uS + uT * uSp, vW.y * uS * 1.4 - uT * uSp * 0.3));
        float dens = smoothstep(0.30, 0.85, n) * (0.25 + 0.75 * exp(-max(vW.y, 0.0) * 0.45));
        float edge = smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x)) * smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y));
        gl_FragColor = vec4(uCol * dens * uK * edge, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); mesh.position.set(0, y, z); mesh.frustumCulled = false; mesh.renderOrder = 16; return mesh;
}

// ---- floor pool (additive radial light on the floor) -----------------------------------------------------------------------
function floorPool(THREE, { color, r, k, pow = 2 }) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(color) }, uK: { value: k }, uPow: { value: pow } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uCol; uniform float uK, uPow; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float g = pow(max(1.0 - d, 0.0), uPow); gl_FragColor = vec4(uCol * g * uK, 1.0); }',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), m); mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.004; mesh.renderOrder = 5; mesh.frustumCulled = false; return mesh;
}

// ---- floor (planar reflection, fresnel, anisotropic glossy blur) ---------------------------------------------------------------
const FLOOR_SHADER = {
  name: 'NeuralFloor',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, uCam: { value: null }, uT: { value: 0 }, uTexel: { value: null }, uRefl: { value: 1.35 } },
  vertexShader: 'uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW; void main(){ vUv = textureMatrix * vec4(position, 1.0); vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
  fragmentShader: `uniform vec3 color; uniform sampler2D tDiffuse; uniform vec3 uCam; uniform float uT, uRefl; uniform vec2 uTexel; varying vec4 vUv; varying vec3 vW; ${GLSL_NOISE}
    void main(){
      vec2 uv = vUv.xy / vUv.w;
      vec3 V = uCam - vW; float dist = length(V); float cosT = clamp(V.y / dist, 0.0, 1.0);
      float fres = 0.05 + 0.95 * pow(1.0 - cosT, 4.0);
      float rough = 0.7 + 0.3 * vn(vW.xz * 1.3);
      float spread = (4.0 + 0.9 * dist) * rough;       // texels
      vec3 acc = vec3(0.0); float ws = 0.0;
      for (int i = 0; i < 16; i++) {
        float a = float(i) * 2.39996; float r = sqrt((float(i) + 0.5) / 16.0);
        vec2 o = vec2(cos(a) * 0.55, sin(a) * 1.9) * r * spread * uTexel;       // vertical smear (wet glossy floor)
        float w = 1.0 - 0.5 * r;
        acc += texture2D(tDiffuse, uv + o).rgb * w; ws += w;
      }
      vec3 refl = acc / ws;
      vec3 base = vec3(0.004, 0.006, 0.016) + vec3(0.0, 0.004, 0.010) * (1.0 - smoothstep(0.0, 12.0, dist));
      float fadeFar = 1.0 - smoothstep(14.0, 26.0, dist);
      gl_FragColor = vec4(base + refl * fres * uRefl * 0.85 * fadeFar, 1.0);
    }`,
};

// ---- cyc backdrop (self-lit gradient with coloured spill) ------------------------------------------------------------------------
function buildCyc(THREE) {
  const m = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: 'varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
    fragmentShader: `varying vec3 vW; ${GLSL_NOISE}
      void main(){
        float y = vW.y, x = vW.x;
        vec3 c = mix(vec3(0.0022, 0.0045, 0.0140), vec3(0.0008, 0.0014, 0.0045), smoothstep(0.5, 9.0, y));
        c += vec3(0.0, 0.010, 0.016) * exp(-pow((y - 0.6) / 1.1, 2.0)) ;                  // horizon band
        c += vec3(0.40, 0.28, 1.00) * 0.055 * exp(-(pow((x - 0.4) / 3.6, 2.0) + pow((y - 1.6) / 2.0, 2.0)));   // violet behind the painting
        c += vec3(0.05, 0.60, 0.55) * 0.045 * exp(-(pow((x + 3.4) / 2.4, 2.0) + pow((y - 2.2) / 2.6, 2.0)));    // teal behind the head
        c += vec3(1.00, 0.55, 0.12) * 0.020 * exp(-(pow((x - 4.6) / 2.4, 2.0) + pow((y - 3.0) / 2.6, 2.0)));    // amber top-right
        c *= 0.85 + 0.3 * fbm(vec2(x * 0.4, y * 0.5));
        gl_FragColor = vec4(c, 1.0); }`,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(70, 28), m); mesh.position.set(0, 14, -9.5); mesh.frustumCulled = false; return mesh;
}

// =============================================================================
// THE CRYSTAL HEAD — a faceted loft of ellipses following a stylised, faceless side profile
// =============================================================================
const HEAD_ROWS = [ // [y, xBack, xFront, halfWidth] (unscaled meters; +x = facing direction). Stylised, faceless profile.
  [0.00, -0.66, 0.46, 1.12], [0.28, -0.66, 0.46, 1.12], [0.55, -0.62, 0.42, 1.02], [0.80, -0.54, 0.36, 0.80], [1.00, -0.46, 0.30, 0.56],
  [1.14, -0.40, 0.28, 0.44], [1.28, -0.38, 0.28, 0.40], [1.40, -0.40, 0.31, 0.38], [1.50, -0.46, 0.46, 0.36], [1.62, -0.54, 0.58, 0.37],
  [1.74, -0.60, 0.53, 0.38], [1.83, -0.64, 0.60, 0.40], [1.92, -0.68, 0.58, 0.42], [2.02, -0.71, 0.74, 0.44], [2.12, -0.74, 0.62, 0.46],
  [2.24, -0.76, 0.58, 0.49], [2.36, -0.78, 0.59, 0.50], [2.50, -0.78, 0.56, 0.50], [2.63, -0.75, 0.52, 0.48], [2.76, -0.68, 0.46, 0.44],
  [2.88, -0.52, 0.36, 0.36], [2.97, -0.30, 0.20, 0.23], [3.02, -0.08, 0.04, 0.06],
];
function buildHeadGeometry(THREE) {
  const N = 14, rows = HEAD_ROWS, pos = [], idx = [];
  const sgn = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
  rows.forEach(([y, xb, xf, hw], i) => {
    const cx = (xb + xf) / 2, a = (xf - xb) / 2;
    for (let k = 0; k < N; k++) {
      const ph = (k / N) * TAU + 0.0;
      const j = 1 + 0.03 * (H(i, k, 3) * 2 - 1);
      pos.push(cx + a * sgn(Math.cos(ph), 0.8) * j, y, hw * sgn(Math.sin(ph), 0.8) * j);
    }
  });
  for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < N; k++) {
    const a = i * N + k, b = i * N + ((k + 1) % N), c = (i + 1) * N + k, d = (i + 1) * N + ((k + 1) % N);
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const HEAD_FRESNEL = {
  vert: 'varying vec3 vW; varying vec3 vO; void main(){ vO = position; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
  frag: `uniform float uT, uPulse, uBright; uniform vec3 uTeal, uViolet, uAmber; varying vec3 vW; varying vec3 vO;
    void main(){
      vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); vec3 v = normalize(cameraPosition - vW);
      float ndv = abs(dot(n, v)); float fres = pow(1.0 - ndv, 4.0);
      float facet = fract(sin(dot(floor(n * 5.0 + 0.5), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      vec3 col = mix(uTeal, uViolet, smoothstep(-0.5, 0.7, vO.x + 0.25 * sin(vO.y * 2.5)));
      float brain = exp(-length((vO - vec3(0.20, 2.45, 0.0)) * vec3(1.2, 1.0, 1.6)) * 3.4);
      float stripes = 0.5 + 0.5 * sin(vO.y * 22.0 - uT * 6.0 + vO.x * 4.0);
      float low = smoothstep(1.2, 0.0, vO.y);
      vec3 c = col * (0.006 + fres * 1.1) * (0.35 + 1.0 * facet);
      c += col * stripes * fres * 0.35 * smoothstep(0.8, 2.3, vO.y);
      c += mix(vec3(0.8, 0.7, 1.0), uAmber, 0.35) * brain * (0.05 + 0.16 * uPulse);
      c += uTeal * low * 0.07 * (0.4 + facet);
      float tw = step(0.80, facet) * pow(0.5 + 0.5 * sin(uT * 2.6 + facet * 60.0), 10.0);       // gem facets glint (smooth, ~20% of facets)
      c += mix(uTeal, vec3(1.0), 0.4) * tw * (0.12 + 0.45 * fres + 0.15 * uPulse);
      gl_FragColor = vec4(c * uBright, 1.0); }`,
};

// =============================================================================
// MODULE
// =============================================================================
export default {
  id: 'f2100', kind: '3d', ratio: 2.39,

  async setup({ THREE, S, renderer }) {
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#02040b');
    const envTex = makeEnvMap(THREE, renderer);
    scene.environment = envTex; scene.environmentIntensity = 0.35;
    const camera = new THREE.PerspectiveCamera(27, 2.39, 0.1, 90);
    const col = (h) => new THREE.Color(h);
    const U = {
      uT: { value: 0 }, uPx: { value: 1000 }, uBright: { value: 1 }, uFillBright: { value: 1 }, uGlitch: { value: 0 }, uSettle: { value: 0 },
      uEmit: { value: new THREE.Vector3() }, uEmitB: { value: new THREE.Vector3() }, uHead: { value: new THREE.Vector3() }, uDio: { value: new THREE.Vector3(DIO[0], DIO[1], DIO[2]) }, uBaton: { value: new THREE.Vector3(...BATON_C) },
      uBeat: { value: new THREE.Vector4(0, 0.5, 1.0, 1.5) },
      uC0: { value: col('#6B5BFF').multiplyScalar(1.9) }, uC1: { value: col('#1FB5A6').multiplyScalar(1.9) }, uC2: { value: col('#FFB62E').multiplyScalar(1.5) }, uC3: { value: col('#7CC4FF').multiplyScalar(1.6) },
    };

    // ---- backdrop, floor
    scene.add(buildCyc(THREE));
    const floor = new Reflector(new THREE.PlaneGeometry(80, 60), { textureWidth: 768, textureHeight: 320, clipBias: 0.002, multisample: 0, shader: FLOOR_SHADER });
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -4); floor.material.uniforms.uCam.value = new THREE.Vector3(); floor.material.uniforms.uTexel.value = new THREE.Vector2(1 / 768, 1 / 320);
    const refl = { lastT: 0, reflT: -1e9, lite: [] };   // reflection budget: rendered once per FRAME (not per sub-frame), without the heavy additive extras
    scene.add(floor);

    // ---- the crystal head
    const headGroup = new THREE.Group(); headGroup.position.set(...HEAD_POS); headGroup.rotation.y = HEAD_YAW; headGroup.scale.setScalar(HEAD_S);
    const headGeo = buildHeadGeometry(THREE);
    const glass = new THREE.Mesh(headGeo, new THREE.MeshPhysicalMaterial({ color: '#03101f', metalness: 0.0, roughness: 0.14, clearcoat: 0.7, clearcoatRoughness: 0.16, envMapIntensity: 2.4, transparent: true, opacity: 0.6, flatShading: true, depthWrite: false, side: THREE.FrontSide }));
    glass.renderOrder = 2; headGroup.add(glass);
    const hu = { uT: U.uT, uPulse: { value: 0 }, uBright: { value: 1 }, uTeal: { value: col('#1FB5A6').multiplyScalar(1.2) }, uViolet: { value: col('#6B5BFF').multiplyScalar(2.2) }, uAmber: { value: col('#FFB62E') } };
    const rim = new THREE.Mesh(headGeo, new THREE.ShaderMaterial({ uniforms: hu, vertexShader: HEAD_FRESNEL.vert, fragmentShader: HEAD_FRESNEL.frag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide }));
    rim.renderOrder = 3; headGroup.add(rim);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(headGeo, 36), new THREE.LineBasicMaterial({ color: col('#27d6c4').multiplyScalar(1.6), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); edges.renderOrder = 3; headGroup.add(edges);
    const proxy = new THREE.Mesh(headGeo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true })); proxy.renderOrder = 30; headGroup.add(proxy);
    // plinth + ring
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.46, 0.10, 56), new THREE.MeshStandardMaterial({ color: '#05080f', metalness: 0.6, roughness: 0.2, envMapIntensity: 1.2 })); plinth.position.y = 0.04; headGroup.add(plinth);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.38, 0.014, 8, 96), new THREE.MeshBasicMaterial({ color: col('#1FB5A6').multiplyScalar(3.2) })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.095; headGroup.add(ring);
    scene.add(headGroup); headGroup.updateMatrixWorld(true);
    const emit = headGroup.localToWorld(new THREE.Vector3(0.57, 2.36, 0)), emitB = headGroup.localToWorld(new THREE.Vector3(0.44, 2.80, 0)), headC = headGroup.localToWorld(new THREE.Vector3(0.0, 2.2, 0));
    U.uEmit.value.copy(emit); U.uEmitB.value.copy(emitB); U.uHead.value.copy(headC);
    const emitMid = emit.clone().lerp(emitB, 0.5);

    // ---- ribbons: flowing river (thousands) + painted strokes
    const NF = 1000, M = 20;
    const flowGeo = buildFlowGeometry(THREE, NF, M);
    const flowCore = new THREE.Mesh(flowGeo, ribbonMaterial(THREE, U, { flow: true, pass: 0, width: 0.0105 })), flowHalo = new THREE.Mesh(flowGeo, ribbonMaterial(THREE, U, { flow: true, pass: 1, width: 0.0105 }));
    const data = buildDioramaData();
    const strokeGeo = buildStrokeGeometry(THREE, data.strokes, [emit.x, emit.y, emit.z]);
    const strokeCore = new THREE.Mesh(strokeGeo, ribbonMaterial(THREE, U, { flow: false, pass: 0, width: 0.0105 })), strokeHalo = new THREE.Mesh(strokeGeo, ribbonMaterial(THREE, U, { flow: false, pass: 1, width: 0.0105 }));
    const flowProxy = new THREE.Mesh(flowGeo, ribbonMaterial(THREE, U, { flow: true, pass: 2, width: 0.0105 })), strokeProxy = new THREE.Mesh(strokeGeo, ribbonMaterial(THREE, U, { flow: false, pass: 2, width: 0.0105 }));
    for (const [m, ro] of [[flowCore, 10], [strokeCore, 10], [flowHalo, 11], [strokeHalo, 11], [flowProxy, 11.5], [strokeProxy, 11.5]]) { m.frustumCulled = false; m.renderOrder = ro; scene.add(m); }

    // ---- the painted diorama fills, sparkles
    const fills = buildFills(THREE, U, data); scene.add(fills);
    const sparkles = buildSparkles(THREE, U, data.sparkles); scene.add(sparkles);
    const moonHalo = glowSprite(THREE, { color: '#6B5BFF', size: 2.0, power: 2.4 }); moonHalo.position.set(DIO[0] + MOON.x * DS, DIO[1] + MOON.y * DS, DIO[2] - 0.8); scene.add(moonHalo);
    const castleHalo = glowSprite(THREE, { color: '#FFB62E', size: 1.4, power: 3.0 }); castleHalo.position.set(DIO[0] + CASTLE.x * DS, DIO[1] + (CASTLE.y + 0.3) * DS, DIO[2] - 0.45); scene.add(castleHalo);

    // ---- atmosphere
    const motes = buildMotes(THREE, U, { n: 240, min: [-6, 0.1, -3], size: [12, 4.2, 9.5], sizeMul: 0.04, tint: '#ffffff', seed: 200 }); scene.add(motes);
    const bokeh = buildMotes(THREE, U, { n: 90, min: [-11, 0.6, -9], size: [22, 6.5, 2.0], sizeMul: 0.3, tint: '#ffffff', seed: 300, drift: 0.2, alpha: 0.7 }); scene.add(bokeh);
    const beams = [
      buildBeam(THREE, U, { from: [-5.6, 9, -3.2], to: [-2.2, 1.2, -0.4], r0: 0.15, r1: 1.7, color: '#1FB5A6', k: 0.50 }),
      buildBeam(THREE, U, { from: [6.4, 8.5, -3.4], to: [2.7, 1.2, 0.2], r0: 0.15, r1: 1.6, color: '#7CC4FF', k: 0.45 }),
      buildBeam(THREE, U, { from: [0.6, 9.5, -2.2], to: [0.4, 1.0, -0.1], r0: 0.2, r1: 2.4, color: '#6B5BFF', k: 0.28 }),
    ]; beams.forEach((b) => scene.add(b));
    const hazes = [
      buildHaze(THREE, U, { z: -4.2, y: 2.4, w: 40, h: 8, color: '#5a46ff', k: 0.060, scale: 0.22, speed: 0.04 }),
    ]; hazes.forEach((h) => scene.add(h));
    const pools = [
      floorPool(THREE, { color: '#6B5BFF', r: 3.4, k: 0.55, pow: 2.2 }),
      floorPool(THREE, { color: '#1FB5A6', r: 2.4, k: 0.45, pow: 2.4 }),
      floorPool(THREE, { color: '#FFB62E', r: 1.5, k: 0.25, pow: 2.6 }),
    ];
    pools[0].position.set(DIO[0], 0.004, DIO[2]); pools[1].position.set(HEAD_POS[0] + 0.2, 0.004, HEAD_POS[2]); pools[2].position.set(AMR[0], 0.004, AMR[2]); pools.forEach((p) => scene.add(p));

    // ---- emitter / brain glow
    const emitGlow = glowSprite(THREE, { color: '#b9a8ff', size: 1.5, streak: 0.5, power: 2.6 }); emitGlow.position.copy(emitMid); scene.add(emitGlow);
    const brainGlow = glowSprite(THREE, { color: '#7aa8ff', size: 1.2, power: 2.6 }); brainGlow.position.copy(headGroup.localToWorld(new THREE.Vector3(0.15, 2.5, -0.05))); brainGlow.visible = false; scene.add(brainGlow);

    // ---- Amrita + baton
    const A = createAmrita(THREE); A.root.position.set(...AMR); scene.add(A.root); A.setProp(null);
    const baton = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#16131c', roughness: 0.3, metalness: 0.5, envMapIntensity: 1.5 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.70, 12), new THREE.MeshStandardMaterial({ color: '#fff3d6', roughness: 0.3, emissive: '#ffcf80', emissiveIntensity: 0.9 })); shaft.position.y = -0.33; baton.add(shaft);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.16, 14), wood); handle.position.y = -0.62; baton.add(handle);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.034, 14, 10), new THREE.MeshBasicMaterial({ color: col('#ffe2a8').multiplyScalar(2.2) })); baton.add(tip);
    scene.add(baton);
    const tipGlow = glowSprite(THREE, { color: '#ffc566', size: 0.38, streak: 0.5, power: 2.6 }); scene.add(tipGlow);
    // baton light-trail (ribbon of past tip positions, recomputed per update: pure function of time)
    const TR = 30, trailPos = new Float32Array(TR * 2 * 3), trailCol = new Float32Array(TR * 2 * 3), trailIdx = [];
    for (let i = 0; i < TR - 1; i++) { const a = i * 2; trailIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const trailGeo = new THREE.BufferGeometry(); trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3)); trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3)); trailGeo.setIndex(trailIdx);
    const trail = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); trail.frustumCulled = false; trail.renderOrder = 17; scene.add(trail);

    // ---- lights (no shadow maps: soft glow pools + contact are faked; <= 2 shadow casters rule satisfied)
    const amb = new THREE.AmbientLight('#18214a', 0.22); scene.add(amb);
    const rimSpot = new THREE.SpotLight('#9fd8ff', 260, 40, 0.42, 0.7, 2); rimSpot.position.set(4.9, 3.6, -2.3); rimSpot.target.position.set(AMR[0], AMR[1], AMR[2]); scene.add(rimSpot, rimSpot.target);
    const headRim = new THREE.SpotLight('#2fe0cf', 170, 40, 0.5, 0.7, 2); headRim.position.set(-6.0, 4.6, -3.0); headRim.target.position.set(HEAD_POS[0], 1.9, HEAD_POS[2]); scene.add(headRim, headRim.target);
    const keyV = new THREE.PointLight('#8a7bff', 10, 14, 2); keyV.position.set(0.5, 2.0, 1.4); scene.add(keyV);
    const keyT = new THREE.PointLight('#27d6c4', 6, 12, 2); keyT.position.set(-3.6, 3.6, 2.4); scene.add(keyT);
    const keyA = new THREE.PointLight('#ffb62e', 3, 9, 2); keyA.position.set(1.0, 1.7, 2.2); scene.add(keyA);
    const batonL = new THREE.PointLight('#ffc566', 0.8, 6, 2); scene.add(batonL);

    const parts = { flow: [flowCore, flowHalo, flowProxy], strokes: [strokeCore, strokeHalo, strokeProxy], fills, sparkles, moonHalo, castleHalo, motes, bokeh, beams, hazes, pools, emitGlow, brainGlow, glass, rim, edges, proxy, plinth, ring, floor, cyc: scene.children[0], amrita: A.root, baton, tipGlow, trail };
    refl.lite = [flowHalo, flowProxy, strokeProxy, brainGlow, motes, bokeh, hazes[0], rim, edges, proxy];
    const reflOrig = floor.onBeforeRender;
    floor.onBeforeRender = function (r, sc, cam) {
      if (Math.abs(refl.lastT - refl.reflT) < 0.02) return;       // same frame: reuse the reflection rendered for its first sub-frame (deterministic per frame)
      refl.reflT = refl.lastT;
      const vis = refl.lite.map((o) => o.visible); refl.lite.forEach((o) => { o.visible = false; });
      reflOrig.call(this, r, sc, cam);
      refl.lite.forEach((o, i) => { o.visible = vis[i]; });
    };
    return { scene, camera, parts, refl, THREE, U, A, baton, tip, tipGlow, trail, trailPos, trailCol, TR, floor, headGroup, hu, emitGlow, brainGlow, moonHalo, castleHalo, pools, keyV, keyT, keyA, batonL, rimSpot, headRim, beams, hazes, motes, bokeh, emit, headC, shaft, handle, scratch: { v: new THREE.Vector3(), v2: new THREE.Vector3(), q: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0), c: new THREE.Vector3() } };
  },

  update(st, T, S) {
    const { THREE, camera, U, A, scratch } = st;
    const dbg = globalThis.__f2100dbg;   // lab-only hook (undefined in the film)
    if (dbg) for (const [k, v] of Object.entries(st.parts)) for (const o of [].concat(v)) o.visible = !(dbg.hide || []).includes(k) && (!dbg.solo || dbg.solo.includes(k));
    const lt = clamp(T.lt, -0.03, 2.03), tt = Math.max(lt, 0);
    st.refl.lastT = T.t;
    const u = clamp(lt / 2), ue = u * u * (3 - 2 * u);
    U.uT.value = lt;
    const glH = Math.round((S.W * S.scale) / 2.39 / 2) * 2;
    U.uPx.value = glH / (2 * Math.tan((27 * Math.PI) / 360));
    // brightness: a quick glitch-pop surge on the cut, calm body, surge into the next scene
    const surgeOut = sm(1.82, 2.0, lt);
    const glitch = lt < 0.3 ? Math.exp(-tt / 0.065) : 0;
    U.uGlitch.value = glitch;
    U.uBright.value = 1 + 0.25 * Math.exp(-tt / 0.10) + 0.32 * surgeOut;
    U.uFillBright.value = 1 + 0.2 * Math.exp(-tt / 0.1) + 0.12 * surgeOut;

    // ---- baton: conducting a 4-pattern; ictus exactly on the beats (lt = 0, .5, 1, 1.5)
    const PAT = [[0.0, -0.30], [-0.36, -0.12], [0.34, -0.10], [0.10, 0.32]];
    const cr = (p0, p1, p2, p3, t) => 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    const batonAt = (tm, out) => {
      const tau = ((tm / 0.5) % 4 + 4) % 4, i = Math.floor(tau), f = tau - i;
      const g = (k) => PAT[((k % 4) + 4) % 4];
      const x = cr(g(i - 1)[0], g(i)[0], g(i + 1)[0], g(i + 2)[0], f), y = cr(g(i - 1)[1], g(i)[1], g(i + 1)[1], g(i + 2)[1], f);
      return out.set(BATON_C[0] + x * 0.9, BATON_C[1] + y * 0.8, BATON_C[2] + 0.1 * Math.sin(tau * 1.57));
    };
    const tipP = batonAt(lt, scratch.v);
    U.uBaton.value.copy(tipP);
    st.tip.position.copy(tipP); st.tipGlow.position.copy(tipP); st.batonL.position.copy(tipP);
    const pivot = scratch.v2.set(AMR[0] - 0.74, AMR[1] - 0.40, AMR[2] + 0.35);
    const dir = scratch.c.copy(tipP).sub(pivot).normalize();
    st.baton.position.copy(tipP); st.baton.scale.set(1, clamp((tipP.distanceTo(pivot) - 0.12) / 0.78, 0.45, 1.5), 1); st.baton.quaternion.setFromUnitVectors(scratch.up, dir); // local +y -> tip direction; the rod extends toward -y (back to the pivot)
    // beat energy (for light + body language)
    const beatE = (tm) => { let e = 0; for (const b of [0, 0.5, 1.0, 1.5]) { const a = tm - b + (b === 0 ? 0.08 : 0); if (a > 0) e += Math.exp(-a * 5) * sm(0, 0.03, a); } return e; };
    const be = beatE(lt);
    st.tipGlow.material.uniforms.uK.value = 0.18 + 0.30 * be;
    st.batonL.intensity = 0.6 + 1.6 * be;
    // trail
    {
      const { trailPos, trailCol, TR } = st; const cam = camera.position, p = scratch.v, q = new THREE.Vector3(), tg = new THREE.Vector3(), sd = new THREE.Vector3(), cd = new THREE.Vector3();
      const pts = [];
      for (let k = 0; k < TR; k++) pts.push(batonAt(lt - k * 0.011, new THREE.Vector3()));
      for (let k = 0; k < TR; k++) {
        const a = pts[Math.max(0, k - 1)], b = pts[Math.min(TR - 1, k + 1)];
        tg.copy(a).sub(b).normalize(); cd.copy(cam).sub(pts[k]).normalize(); sd.crossVectors(tg, cd).normalize();
        const f = 1 - k / (TR - 1), w = 0.028 * Math.pow(f, 0.8) * (0.6 + be);
        for (let s2 = -1; s2 <= 1; s2 += 2) {
          const o = (k * 2 + (s2 > 0 ? 1 : 0)) * 3;
          trailPos[o] = pts[k].x + sd.x * w * s2; trailPos[o + 1] = pts[k].y + sd.y * w * s2; trailPos[o + 2] = pts[k].z + sd.z * w * s2;
          const br = Math.pow(f, 1.4) * (1.6 + 2.6 * be);
          trailCol[o] = 1.0 * br; trailCol[o + 1] = 0.62 * br; trailCol[o + 2] = 0.2 * br;
        }
      }
      st.trail.geometry.attributes.position.needsUpdate = true; st.trail.geometry.attributes.color.needsUpdate = true;
    }

    // ---- Amrita: body language on the beats, eyes happy -> determined -> awe
    const bob = 0.035 * Math.sin(lt * 2.6) - 0.055 * be * 0.5;
    const squash = 0.13 * be * Math.cos(Math.max(0, lt) * 0) - 0.04 * Math.sin(lt * 5.0) * 0.5;
    A.root.position.set(AMR[0], AMR[1] + 0.02 * Math.sin(lt * 2.1), AMR[2]); A.root.scale.setScalar(1.1);
    A.pose({ squash: clamp(squash, -0.2, 0.2), yaw: -0.42 + 0.05 * Math.sin(lt * 1.3), roll: 0.06 * (tipP.x - BATON_C[0]) * -1, bob });
    const happy = lt < 0.5 ? 1 : 0, det = sm(0.5, 0.65, lt) * (1 - sm(1.46, 1.52, lt)), awe = sm(1.47, 1.56, lt);
    const blink = A.blinkAt({ t: T.t + 0.5 });   // phase-shifted so the natural blink lands under the 'happy' arcs, never on the key beats
    A.eyes({ open: 1 - 0.92 * blink * (1 - awe), squint: 0, happy, determined: happy ? 0 : 0.7 * det, surprised: awe, sleepy: 0, lookX: lerp(-0.9, -0.5, sm(0, 1.4, lt)) , lookY: lerp(0.15, 0.5, awe) });
    st.A = A;

    // ---- lights breathe with the painting
    st.keyV.intensity = 8 + 5 * ue + 6 * be; st.keyT.intensity = 5 + 3 * be; st.keyA.intensity = 1.5 + 4 * sm(1.3, 1.9, lt);
    st.hu.uPulse.value = 0.25 + 0.75 * be + 0.5 * sm(0, 0.4, lt) * (1 - sm(0.4, 1.2, lt));
    st.emitGlow.material.uniforms.uK.value = 0.25 + 0.7 * be + 0.7 * Math.exp(-tt / 0.15);
    st.brainGlow.material.uniforms.uK.value = 0.10 + 0.25 * be;
    st.moonHalo.material.uniforms.uK.value = 0.30 * sm(0.05, 0.6, lt);
    st.castleHalo.material.uniforms.uK.value = 0.55 * sm(1.3, 1.8, lt) * (1 + 0.5 * be);
    st.pools[0].material.uniforms.uK.value = 0.15 + 0.5 * sm(0.3, 1.7, lt) + 0.25 * be;
    st.pools[1].material.uniforms.uK.value = 0.35 + 0.25 * be;
    // billboards face the camera
    for (const s of [st.emitGlow, st.brainGlow, st.moonHalo, st.castleHalo, st.tipGlow]) s.quaternion.copy(camera.quaternion);

    // ---- camera: slow low-angle orbit + dolly-in, handheld breath, stepped glitch jitter on the cut
    const az = lerp(-0.17, 0.10, ue), R = lerp(8.2, 6.9, ue), cy = lerp(0.42, 0.62, ue);
    const F = scratch.c.set(0.30, 1.14 + 0.06 * ue, 0);
    camera.position.set(F.x + Math.sin(az) * R, cy, F.z + Math.cos(az) * R);
    camera.position.x += 0.012 * Math.sin(lt * 1.7) + glitch * (H(Math.floor(T.t * 60), 5) - 0.5) * 0.16;
    camera.position.y += 0.010 * Math.sin(lt * 2.3 + 1) + glitch * (H(Math.floor(T.t * 60), 6) - 0.5) * 0.05;
    camera.lookAt(F.x + 0.05 * Math.sin(lt * 0.9), F.y, F.z);
    camera.fov = 27; camera.near = 0.1; camera.far = 90;
    st.floor.material.uniforms.uCam.value.copy(camera.position);
    st.floor.material.uniforms.uT.value = lt;

    // DOF: rack from the painting to Amrita on the final beat
    const dDio = camera.position.distanceTo(scratch.v.set(...FOCUS_DIO)), dAmr = camera.position.distanceTo(scratch.v.set(AMR[0] - 0.1, AMR[1], AMR[2]));
    const focus = lerp(dDio, dAmr, sm(1.15, 1.6, lt));
    return { dof: { focus, strength: 0.9, maxPx: 12, bokeh: 1.5 }, bloom: { strength: 0.46 + 0.28 * Math.exp(-tt / 0.12) + 0.10 * surgeOut, radius: 0.7, threshold: 0.9 }, exposure: 1.0 + 0.10 * Math.exp(-tt / 0.07) + 0.05 * surgeOut, shake: 9 };
  },

  // digital glitch pop on the cut (first ~0.3 s): sliced rows, RGB split, scan lines, blocks
  overlay2d(ctx, T, S, st) {
    const lt = T.lt;
    if (lt > 0.32) return;
    const g = 0.6 * Math.exp(-Math.max(lt, 0) / 0.06);
    if (g < 0.03) return;
    const fr = Math.round(T.t * 30), sc = S.scale, cv = ctx.canvas;
    const M = S.overlay.matteRect(2.39);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    const x0 = Math.round(M.x * sc), y0 = Math.round(M.y * sc), w = Math.round(M.w * sc), h = Math.round(M.h * sc);
    ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
    const snap = S.mk(w, h), sg = snap.getContext('2d'); sg.drawImage(cv, x0, y0, w, h, 0, 0, w, h);
    // RGB split
    const dx = Math.round((5 + 22 * g) * sc * (H(fr, 1) > 0.5 ? 1 : -1));
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#00ffff'; ctx.fillRect(x0, y0, w, h);
    const red = S.mk(w, h), rg = red.getContext('2d'); rg.drawImage(snap, 0, 0); rg.globalCompositeOperation = 'multiply'; rg.fillStyle = '#ff0000'; rg.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(red, x0 + dx, y0);
    // sliced bands
    ctx.globalCompositeOperation = 'source-over';
    const nb = 3 + Math.round(8 * g);
    for (let i = 0; i < nb; i++) {
      const by = Math.floor(H(fr, 20 + i) * h * 0.92), bh = Math.max(2, Math.floor((0.008 + 0.045 * H(fr, 40 + i)) * h));
      const off = Math.round((H(fr, 60 + i) - 0.5) * 150 * g * sc);
      ctx.drawImage(snap, 0, by, w, bh, x0 + off, y0 + by, w, bh);
      if (H(fr, 80 + i) > 0.55) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = H(fr, 90 + i) > 0.5 ? `rgba(40,230,255,${0.28 * g})` : `rgba(255,60,200,${0.24 * g})`; ctx.fillRect(x0, y0 + by, w, Math.max(1, Math.round(bh * 0.35))); ctx.globalCompositeOperation = 'source-over'; }
    }
    // data blocks + scanlines
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      if (H(fr, 120 + i) > 0.5 * g + 0.15) continue;
      const bx = Math.floor(H(fr, 130 + i) * w * 0.9), by2 = Math.floor(H(fr, 140 + i) * h * 0.9), bw = Math.floor((0.02 + 0.08 * H(fr, 150 + i)) * w), bh2 = Math.max(2, Math.floor(0.008 * h * (1 + 3 * H(fr, 160 + i))));
      ctx.fillStyle = i % 2 ? `rgba(120,255,235,${0.55 * g})` : `rgba(150,130,255,${0.55 * g})`; ctx.fillRect(x0 + bx, y0 + by2, bw, bh2);
    }
    ctx.fillStyle = `rgba(160,255,255,${0.07 * g})`; for (let y = 0; y < h; y += Math.max(3, Math.round(4 * sc))) ctx.fillRect(x0, y0 + y, w, 1);
    ctx.restore();
  },
};

function makeEnvMap(THREE, renderer) {
  const sc = new THREE.Scene(); sc.background = new THREE.Color('#02040c');
  const panel = (w, h, pos, hex, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); sc.add(m);
  };
  panel(5, 16, [-9, 4, 2], '#1FB5A6', 5); panel(5, 16, [9, 4, -2], '#6B5BFF', 6); panel(16, 5, [0, 10, 0], '#8fc8ff', 2.5);
  panel(8, 3, [0, 2, -10], '#6B5BFF', 2); panel(4, 10, [4, 3, 9], '#FFB62E', 2.2); panel(3, 10, [-5, 3, 9], '#7CC4FF', 1.2);
  const pm = new THREE.PMREMGenerator(renderer); const rt = pm.fromScene(sc, 0.03); pm.dispose();
  return rt.texture;
}
