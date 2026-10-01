// =============================================================================
// grade.js — the film-look GL pass for Act I frames (and any 2D canvas): per-era "color process".
// Input: a 2D canvas (display-referred sRGB). Output: renders into the shared renderer's canvas.
// Everything is a pure function of (t, frame index): flicker, weave, grain, scratches, dust.
// =============================================================================
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Preset parameter reference (all optional; defaults in DEFAULTS):
//  mono        0..1   blend to monochrome using monoMix (orthochromatic weighting)
//  tint        0..1   split-tone amount;  shadowTint / highTint = rgb multipliers
//  sat, contrast, bright (exposure mult), gamma, lift (milky blacks 0..0.2)
//  threeStrip  0..1   saturated primaries push (1939)
//  tealOrange  0..1   shadows->teal, highlights->orange (2009)
//  flicker     amp of exposure flicker; flickerHz = rate steps/s
//  grain       amount; grainSize px (at 1080p)
//  scratch     0..1 vertical film scratches;  dust 0..1 specks & hairs
//  weave       gate weave px at 1080p
//  vignette    0..1;  halation 0..1 (soft highlight glow);  chroma px (chromatic aberration)
export const DEFAULTS = {
  mono: 0, monoMix: [0.30, 0.55, 0.15], tint: 0, shadowTint: [1, 1, 1], highTint: [1, 1, 1],
  sat: 1, contrast: 1, bright: 1, gamma: 1, lift: 0, threeStrip: 0, tealOrange: 0,
  flicker: 0, flickerHz: 24, grain: 0, grainSize: 1.5, scratch: 0, dust: 0, weave: 0, vignette: 0, halation: 0, chroma: 0,
};
export const PRESETS = {
  none: {},
  projector: { flicker: 0.08, flickerHz: 24, grain: 0.10, scratch: 0.25, dust: 0.5, weave: 1.0, vignette: 0.55, sat: 0.95, contrast: 1.05 },
  bw_flicker: { mono: 1, monoMix: [0.22, 0.52, 0.26], contrast: 1.28, bright: 1.02, lift: 0.03, flicker: 0.13, flickerHz: 16, grain: 0.15, grainSize: 1.7, scratch: 0.95, dust: 0.7, weave: 2.6, vignette: 0.55, tint: 0.12, shadowTint: [0.97, 0.98, 1.02], highTint: [1.0, 0.99, 0.96] },
  sepia: { mono: 1, monoMix: [0.28, 0.54, 0.18], tint: 0.9, shadowTint: [0.20, 0.11, 0.05], highTint: [1.0, 0.90, 0.72], contrast: 1.15, lift: 0.025, flicker: 0.07, flickerHz: 12, grain: 0.11, scratch: 0.5, dust: 0.45, weave: 1.6, vignette: 0.5 },
  bw_talkie: { mono: 1, monoMix: [0.30, 0.55, 0.15], contrast: 1.12, flicker: 0.035, flickerHz: 24, grain: 0.085, scratch: 0.3, dust: 0.25, weave: 0.8, vignette: 0.38, tint: 0.1, highTint: [1.0, 0.98, 0.95] },
  threestrip: { sat: 1.6, contrast: 1.12, bright: 1.05, threeStrip: 1, grain: 0.05, weave: 0.4, vignette: 0.25, halation: 0.3, flicker: 0.015, flickerHz: 24, dust: 0.1 },
  warm70mm: { sat: 1.12, contrast: 1.1, tint: 0.3, shadowTint: [0.88, 0.86, 0.9], highTint: [1.06, 0.97, 0.84], grain: 0.07, weave: 0.5, vignette: 0.38, halation: 0.35, dust: 0.1 },
  grain70s: { sat: 0.95, contrast: 1.2, tint: 0.2, shadowTint: [0.9, 0.9, 0.95], highTint: [1.04, 0.98, 0.9], lift: 0.04, grain: 0.21, grainSize: 1.9, halation: 0.22, scratch: 0.12, dust: 0.3, vignette: 0.45, chroma: 0.9, weave: 0.7 },
  clean90s: { sat: 1.06, contrast: 1.06, grain: 0.018, vignette: 0.1 },
  tealorange: { sat: 1.1, contrast: 1.2, tealOrange: 0.85, grain: 0.04, vignette: 0.32, halation: 0.3 },
  phone: { sat: 1.12, contrast: 1.05, grain: 0.015, vignette: 0.0 },
  stage: { contrast: 1.04, grain: 0.03, vignette: 0.25 },
};

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uRes; uniform float uSeed, uTime, uScale;
uniform float uMono, uTint, uSat, uContrast, uBright, uGamma, uLift, uThree, uTeal, uFlicker, uFlickerHz, uGrain, uGrainSize, uScratch, uDust, uWeave, uVig, uHalo, uChroma;
uniform vec3 uMonoMix, uShadowTint, uHighTint;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float h11(float x){ return fract(sin(x * 91.3458) * 47453.5453); }
void main(){
  vec2 uv = vUv;
  vec2 weave = (vec2(h21(vec2(uSeed, 1.0)), h21(vec2(uSeed, 2.0))) - 0.5) * 2.0 * uWeave * uScale / uRes;
  uv += weave;
  vec3 c;
  if (uChroma > 0.0) {
    vec2 d = (uv - 0.5) * uChroma * uScale / uRes * 2.0;
    c = vec3(texture2D(tSrc, uv + d).r, texture2D(tSrc, uv).g, texture2D(tSrc, uv - d).b);
  } else c = texture2D(tSrc, uv).rgb;
  if (uHalo > 0.0) {
    vec3 b = (texture2D(tSrc, uv, 4.0).rgb + texture2D(tSrc, uv, 5.0).rgb) * 0.5;
    c += max(b - 0.62, 0.0) * uHalo * vec3(1.0, 0.7, 0.5) * 1.6;
  }
  float fl = 1.0 + (h11(floor(uTime * uFlickerHz) + 3.0) - 0.5) * 2.0 * uFlicker;
  c *= uBright * fl;
  c = (c - 0.5) * uContrast + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  if (uThree > 0.0) {
    // three-strip: push primaries apart, deepen saturated mids
    vec3 pushed = vec3(c.r * 1.08 - c.g * 0.04 - c.b * 0.04, c.g * 1.06 - c.r * 0.03 - c.b * 0.03, c.b * 1.1 - c.r * 0.04 - c.g * 0.04);
    c = mix(c, pushed, uThree);
  }
  float m = dot(c, uMonoMix);
  c = mix(c, vec3(m), uMono);
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (uTint > 0.0) { vec3 tn = mix(uShadowTint, uHighTint, smoothstep(0.0, 1.0, lum)); c = mix(c, c * tn + (tn - 1.0) * 0.0, uTint * 0.0) ; c = mix(c, lum * tn * (0.55 + 0.9 * lum) , uTint); }
  if (uTeal > 0.0) {
    vec3 teal = vec3(0.10, 0.52, 0.58), orange = vec3(1.0, 0.62, 0.30);
    vec3 tn = mix(teal, orange, smoothstep(0.12, 0.8, lum));
    c = mix(c, c * (0.5 + tn * 0.9), uTeal * 0.75);
  }
  c = c * (1.0 - uLift) + uLift;
  c = pow(max(c, 0.0), vec3(1.0 / uGamma));
  // film grain (luma-dependent, per-frame seed)
  if (uGrain > 0.0) {
    vec2 g = floor(gl_FragCoord.xy / (uGrainSize * uScale));
    float n = (h21(g + uSeed * 17.0) + h21(g * 1.7 + uSeed * 31.0 + 9.0) + h21(g * 0.6 + uSeed * 7.0 + 21.0)) / 3.0 - 0.5;
    float lw = 1.0 - abs(lum - 0.5) * 1.1;
    c += n * uGrain * 2.2 * lw;
  }
  // scratches: thin vertical lines that live a few frames
  if (uScratch > 0.0) {
    for (int k = 0; k < 3; k++) {
      float life = floor(uSeed / 2.0) + float(k) * 13.0;
      float x = h11(life + 1.7);
      float on = step(1.0 - uScratch * 0.9, h11(life + 5.1));
      float wx = 0.0007 + 0.0006 * h11(life + 2.2);
      float yv = smoothstep(0.0, 0.15, fract(vUv.y * 0.8 + h11(life) )) ;
      float hit = on * smoothstep(wx, 0.0, abs(vUv.x - x - (vUv.y - 0.5) * 0.002 * h11(life + 4.0)));
      c = mix(c, vec3(h11(life + 8.0) > 0.5 ? 1.0 : 0.05), hit * 0.55);
    }
  }
  // dust specks & hairs
  if (uDust > 0.0) {
    for (int k = 0; k < 4; k++) {
      float s = uSeed + float(k) * 7.0;
      vec2 p = vec2(h11(s * 1.3 + 2.0), h11(s * 2.7 + 5.0));
      float r = (0.0015 + 0.003 * h11(s + 11.0)) ;
      float d = length((vUv - p) * vec2(uRes.x / uRes.y, 1.0));
      float on = step(1.0 - uDust * 0.5, h11(s + 3.0));
      c = mix(c, vec3(h11(s + 4.0) > 0.4 ? 0.04 : 0.95), on * smoothstep(r, r * 0.4, d) * 0.7);
    }
  }
  if (uVig > 0.0) {
    vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y * 0.75;
    c *= 1.0 - uVig * smoothstep(0.25, 0.95, length(q) * 1.15);
  }
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class Grade {
  constructor(renderer) {
    this.renderer = renderer;
    this.tex = new THREE.Texture();
    this.tex.minFilter = THREE.LinearMipmapLinearFilter; this.tex.magFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = true; this.tex.colorSpace = THREE.NoColorSpace; this.tex.flipY = true;
    const u = {
      tSrc: { value: this.tex }, uRes: { value: new THREE.Vector2(1920, 1080) }, uSeed: { value: 0 }, uTime: { value: 0 }, uScale: { value: 1 },
      uMono: { value: 0 }, uTint: { value: 0 }, uSat: { value: 1 }, uContrast: { value: 1 }, uBright: { value: 1 }, uGamma: { value: 1 }, uLift: { value: 0 },
      uThree: { value: 0 }, uTeal: { value: 0 }, uFlicker: { value: 0 }, uFlickerHz: { value: 24 }, uGrain: { value: 0 }, uGrainSize: { value: 1.5 },
      uScratch: { value: 0 }, uDust: { value: 0 }, uWeave: { value: 0 }, uVig: { value: 0 }, uHalo: { value: 0 }, uChroma: { value: 0 },
      uMonoMix: { value: new THREE.Vector3(0.3, 0.55, 0.15) }, uShadowTint: { value: new THREE.Vector3(1, 1, 1) }, uHighTint: { value: new THREE.Vector3(1, 1, 1) },
    };
    this.mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, toneMapped: false });
    this.quad = new FullScreenQuad(this.mat);
  }
  // canvas -> renders into renderer canvas (which must already be sized w x h). `over` = partial preset override.
  apply(canvas, presetId, { t = 0, frame = 0, w, h, scale = 1, over = null } = {}) {
    const P = { ...DEFAULTS, ...(PRESETS[presetId] || {}), ...(over || {}) };
    const u = this.mat.uniforms;
    this.tex.image = canvas; this.tex.needsUpdate = true;
    u.uRes.value.set(w, h); u.uSeed.value = frame; u.uTime.value = t; u.uScale.value = scale;
    u.uMono.value = P.mono; u.uTint.value = P.tint; u.uSat.value = P.sat; u.uContrast.value = P.contrast; u.uBright.value = P.bright; u.uGamma.value = P.gamma; u.uLift.value = P.lift;
    u.uThree.value = P.threeStrip; u.uTeal.value = P.tealOrange; u.uFlicker.value = P.flicker; u.uFlickerHz.value = P.flickerHz; u.uGrain.value = P.grain; u.uGrainSize.value = P.grainSize;
    u.uScratch.value = P.scratch; u.uDust.value = P.dust; u.uWeave.value = P.weave; u.uVig.value = P.vignette; u.uHalo.value = P.halation; u.uChroma.value = P.chroma;
    u.uMonoMix.value.set(...P.monoMix); u.uShadowTint.value.set(...P.shadowTint); u.uHighTint.value.set(...P.highTint);
    const r = this.renderer;
    r.setRenderTarget(null); r.setViewport(0, 0, w, h); r.setScissorTest(false); r.autoClear = false; r.clear();
    this.quad.render(r);
  }
}
