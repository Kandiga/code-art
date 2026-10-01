// =============================================================================
// post.js — the Act II 3D post chain.
//   scene -> [4 jittered sub-frames, HDR accumulate = motion blur + free AA]
//         -> DOF (half-res gather bokeh from the depth texture, composited by CoC)
//         -> UnrealBloom (HDR) -> OutputPass (ACES tone map + sRGB) -> renderer canvas
// Everything is deterministic: sub-frame times/jitter are fixed tables.
// =============================================================================
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const ACCUM_FRAG = `precision highp float; varying vec2 vUv; uniform sampler2D tSrc; uniform float uW; void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb * uW, 1.0); }`;

// pass 1: half-res downsample of color + signed circle of confusion (px @ output res; + = behind focus, - = in front)
const COC_FRAG = `precision highp float; varying vec2 vUv;
uniform sampler2D tColor, tDepth; uniform vec2 uTexel; uniform float uNear, uFar, uFocus, uStrength, uMaxPx, uHScale;
float lin(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
float cocAt(vec2 uv){ float d = lin(texture2D(tDepth, uv).x); float c = uStrength * (d - uFocus) / max(d, 0.001) * uHScale * 40.0; return clamp(c, -uMaxPx, uMaxPx); }
void main(){
  vec3 c = vec3(0.0); float coc = 0.0, wsum = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = (vec2(float(i & 1), float(i >> 1)) - 0.5) * uTexel;
    c += texture2D(tColor, vUv + o).rgb; float cc = cocAt(vUv + o);
    // prefer the nearer (foreground) sample so foreground blur bleeds correctly
    coc = (i == 0 || cc < coc) ? cc : coc;
  }
  gl_FragColor = vec4(c * 0.25, coc);
}`;

// pass 2: gather bokeh (golden-angle spiral) at half res
const GATHER_FRAG = `precision highp float; varying vec2 vUv;
uniform sampler2D tHalf; uniform vec2 uHalfTexel; uniform float uMaxPx, uBokeh; const int N = 36;
void main(){
  vec4 c0 = texture2D(tHalf, vUv); float r0 = abs(c0.a) * 0.5;       // half-res pixels
  float R = max(r0, 0.0);
  vec3 acc = c0.rgb; float ws = 1.0;
  if (uMaxPx > 0.0) {
    for (int i = 0; i < N; i++) {
      float a = float(i) * 2.39996323; float rr = sqrt((float(i) + 0.5) / float(N));
      vec2 off = vec2(cos(a), sin(a)) * rr; float dist = rr * uMaxPx * 0.5;
      vec4 s = texture2D(tHalf, vUv + off * uMaxPx * 0.5 * uHalfTexel);
      float rs = abs(s.a) * 0.5;
      // a sample contributes if its own blur disc reaches this pixel; foreground (negative) always may bleed
      float reach = smoothstep(dist - 1.0, dist + 0.5, rs);
      float lum = dot(s.rgb, vec3(0.3, 0.55, 0.15));
      float w = reach * (1.0 + uBokeh * lum * lum);
      acc += s.rgb * w; ws += w;
    }
  }
  gl_FragColor = vec4(acc / ws, c0.a);
}`;

// pass 3: composite sharp + blurred by |coc|
const COMP_FRAG = `precision highp float; varying vec2 vUv;
uniform sampler2D tColor, tDepth, tBlur; uniform float uNear, uFar, uFocus, uStrength, uMaxPx, uHScale;
float lin(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
void main(){
  vec3 sharp = texture2D(tColor, vUv).rgb;
  vec4 b = texture2D(tBlur, vUv);
  float d = lin(texture2D(tDepth, vUv).x);
  float coc = abs(clamp(uStrength * (d - uFocus) / max(d, 0.001) * uHScale * 40.0, -uMaxPx, uMaxPx));
  float fg = max(-b.a, 0.0);                       // blurred foreground may cover sharp pixels behind it
  float m = max(smoothstep(0.4, 3.0, coc), smoothstep(0.4, 3.0, fg) * 0.85);
  gl_FragColor = vec4(mix(sharp, b.rgb, m), 1.0);
}`;

// 4 sub-frame times (fraction of the frame interval, centred, shutter 0.5) and half-pixel jitter (rotated grid)
const SUB_JITTER = [[-0.125, -0.375], [0.375, -0.125], [-0.375, 0.125], [0.125, 0.375]];
export function subTimes(t, fps = 30, subframes = 4, shutter = 0.5) {
  if (subframes <= 1) return [t];
  const out = [];
  for (let i = 0; i < subframes; i++) out.push(t + ((i + 0.5) / subframes - 0.5) * shutter / fps);
  return out;
}

export class Post {
  constructor(renderer) {
    this.r = renderer; this.w = 0; this.h = 0;
    this.accum = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: ACCUM_FRAG, uniforms: { tSrc: { value: null }, uW: { value: 1 } }, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, depthTest: false, depthWrite: false, toneMapped: false }));
    const mk = (frag, uniforms) => new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false }));
    this.cocQ = mk(COC_FRAG, { tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 100 }, uFocus: { value: 6 }, uStrength: { value: 1 }, uMaxPx: { value: 16 }, uHScale: { value: 1 } });
    this.gatherQ = mk(GATHER_FRAG, { tHalf: { value: null }, uHalfTexel: { value: new THREE.Vector2() }, uMaxPx: { value: 16 }, uBokeh: { value: 1.2 } });
    this.compQ = mk(COMP_FRAG, { tColor: { value: null }, tDepth: { value: null }, tBlur: { value: null }, uNear: { value: 0.1 }, uFar: { value: 100 }, uFocus: { value: 6 }, uStrength: { value: 1 }, uMaxPx: { value: 16 }, uHScale: { value: 1 } });
    this.output = new OutputPass(); this.output.renderToScreen = true;
    this.bloom = null; this.t = {};
  }
  _alloc(w, h) {
    if (this.w === w && this.h === h) return;
    this.w = w; this.h = h;
    Object.values(this.t).forEach((t) => t.dispose && t.dispose());
    const hf = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    const depth = new THREE.DepthTexture(w, h, THREE.FloatType);
    this.t.scene = new THREE.WebGLRenderTarget(w, h, { ...hf, depthBuffer: true, depthTexture: depth });
    this.t.accum = new THREE.WebGLRenderTarget(w, h, hf);
    this.t.half = new THREE.WebGLRenderTarget(w >> 1, h >> 1, hf);
    this.t.half2 = new THREE.WebGLRenderTarget(w >> 1, h >> 1, hf);
    this.t.out = new THREE.WebGLRenderTarget(w, h, hf);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.4, 0.6, 0.85);
  }
  // opts: scene, camera, w, h, times:[t...] (sub-frame times), update:(t)=>void (sets ALL scene state for time t),
  //       dof:{enabled, focus, strength, maxPx, bokeh}, bloom:{strength, radius, threshold}, exposure, jitter (bool)
  render({ scene, camera, w, h, times, update, dof = {}, bloom = {}, exposure = 1, jitter = true }) {
    const r = this.r; this._alloc(w, h);
    r.setViewport(0, 0, w, h); r.setScissorTest(false);
    const N = times.length, hs = h / 1080;
    r.setRenderTarget(this.t.accum); r.setClearColor(0x000000, 1); r.clear();
    // render order: put the sub-frame nearest the centre last so the depth texture matches the centre of the exposure
    const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => Math.abs(b - (N - 1) / 2) - Math.abs(a - (N - 1) / 2));
    r.autoClear = true;
    for (const i of order) {
      update(times[i]);
      if (jitter) { const j = SUB_JITTER[i % 4]; camera.setViewOffset(w, h, j[0] * (N > 1 ? 1 : 0), j[1] * (N > 1 ? 1 : 0), w, h); }
      camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
      r.setRenderTarget(this.t.scene); r.clear();
      r.render(scene, camera);
      if (N === 1) { /* single sample: skip accumulation, use scene target directly */ }
      else {
        this.accum.material.uniforms.tSrc.value = this.t.scene.texture; this.accum.material.uniforms.uW.value = 1 / N;
        r.setRenderTarget(this.t.accum); r.autoClear = false; this.accum.render(r); r.autoClear = true;
      }
    }
    if (jitter) camera.clearViewOffset();
    const color = N === 1 ? this.t.scene.texture : this.t.accum.texture, depthTex = this.t.scene.depthTexture;
    let finalTex = color;
    const D = { enabled: true, focus: 6, strength: 1, maxPx: 14, bokeh: 1.2, ...dof };
    if (D.enabled && D.maxPx > 0) {
      const maxPx = D.maxPx * hs;
      const cu = this.cocQ.material.uniforms; cu.tColor.value = color; cu.tDepth.value = depthTex; cu.uTexel.value.set(1 / w, 1 / h); cu.uNear.value = camera.near; cu.uFar.value = camera.far; cu.uFocus.value = D.focus; cu.uStrength.value = D.strength; cu.uMaxPx.value = maxPx; cu.uHScale.value = hs;
      r.setRenderTarget(this.t.half); r.setViewport(0, 0, w >> 1, h >> 1); this.cocQ.render(r);
      const gu = this.gatherQ.material.uniforms; gu.tHalf.value = this.t.half.texture; gu.uHalfTexel.value.set(1 / (w >> 1), 1 / (h >> 1)); gu.uMaxPx.value = maxPx; gu.uBokeh.value = D.bokeh;
      r.setRenderTarget(this.t.half2); this.gatherQ.render(r);
      r.setViewport(0, 0, w, h);
      const pu = this.compQ.material.uniforms; pu.tColor.value = color; pu.tDepth.value = depthTex; pu.tBlur.value = this.t.half2.texture; pu.uNear.value = camera.near; pu.uFar.value = camera.far; pu.uFocus.value = D.focus; pu.uStrength.value = D.strength; pu.uMaxPx.value = maxPx; pu.uHScale.value = hs;
      r.setRenderTarget(this.t.out); this.compQ.render(r);
      finalTex = this.t.out.texture;
    } else {
      // copy to out so bloom has a writable target
      this.accum.material.uniforms.tSrc.value = color; this.accum.material.uniforms.uW.value = 1;
      r.setRenderTarget(this.t.out); r.clear(); r.autoClear = false; this.accum.render(r); r.autoClear = true;
      finalTex = this.t.out.texture;
    }
    const B = { strength: 0.4, radius: 0.6, threshold: 0.85, ...bloom };
    if (B.strength > 0) {
      this.bloom.strength = B.strength; this.bloom.radius = B.radius; this.bloom.threshold = B.threshold;
      this.bloom.render(r, null, this.t.out, 0, false);
    }
    r.toneMappingExposure = exposure;
    this.output.render(r, null, this.t.out);
    r.setRenderTarget(null);
  }
}
