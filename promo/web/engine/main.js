// =============================================================================
// main.js — the film. window.film.renderFrame(t) draws frame t into film.out (a 2D canvas).
// EVERY frame is a pure function of t: no state is carried between frames (only caches of
// scene geometry/textures/fonts, which are themselves pure functions of seeds).
// =============================================================================
import * as THREE from 'three';
import * as cues from '../../shared/cues.js';
import { loadFonts, F } from './fonts.js';
import * as ease from './ease.js';
import * as rng from './rng.js';
import * as pencil from './pencil.js';
import { Grade, PRESETS } from './grade.js';
import { Post, subTimes } from './post.js';
import * as overlay from './overlay.js';
import { drawTitles } from './titles.js';
import * as hud from './hud.js';
import * as amrita2d from './amrita2d.js';
import * as amrita3d from './amrita3d.js';

const { ERAS, SCENES, FPS, BRAND, makeT, sceneAt } = cues;
const { clamp, lerp, smooth, smoother } = ease;
const LW = 1920, LH = 1080;
const BAR_COLOR = '#0b0a0d';

function portalPath(ctx, p) {
  ctx.beginPath();
  if (p.type === 'screen') ctx.roundRect(p.cx - p.r, p.cy - p.r * 9 / 16, p.r * 2, p.r * 2 * 9 / 16, p.r * 0.08);
  else if (p.type === 'phone') ctx.roundRect(p.cx - p.r, p.cy - p.r * 16 / 9, p.r * 2, p.r * 2 * 16 / 9, p.r * 0.14);
  else ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
}

class Film {
  async init({ scale = 1, subframes = 4, shutter = 0.5, quality = 0.95, noPost = false } = {}) {
    this.scale = scale; this.W = Math.round(LW * scale); this.H = Math.round(LH * scale);
    this.subframes = subframes; this.shutter = shutter; this.quality = quality;
    await loadFonts();
    const mk = (w = this.W, h = this.H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    this.mk = mk;
    this.out = mk(); this.outCtx = this.out.getContext('2d');
    this.cScene = mk(); this.cSceneCtx = this.cScene.getContext('2d', { willReadFrequently: false });
    this.cAct1 = mk(); this.cAct1Ctx = this.cAct1.getContext('2d');
    this.cEra = [mk(), mk()]; this.cEraCtx = this.cEra.map((c) => c.getContext('2d'));
    this.cComp = mk(); this.cCompCtx = this.cComp.getContext('2d');
    this.cAcc = mk(); this.cAccCtx = this.cAcc.getContext('2d');
    this.cGl = mk(); this.cGlCtx = this.cGl.getContext('2d'); // copy of a GL result
    this.renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(1); this.renderer.setSize(this.W, this.H, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.glCanvas = this.renderer.domElement;
    this.grade = new Grade(this.renderer); this.post = new Post(this.renderer);
    this.mods = new Map(); this.states = new Map(); this.failed = new Set(); this.act1Cache = new Map(); this.frameCache = new Map();
    this.S = this._services();
    this.log = { rects: [], warnings: [] };
    return { W: this.W, H: this.H, gl: this.renderer.getContext().getParameter(this.renderer.getContext().VERSION) };
  }

  _services() {
    const self = this;
    return {
      THREE, cues, BRAND, ease, rng, pencil, overlay, amrita2d, amrita3d, hud, F, PRESETS,
      scale: this.scale, W: LW, H: LH,
      get renderer() { return self.renderer; },
      get post() { return self.post; },
      mk: (w, h) => self.mk(w, h),
      // graded Act-I composite (incl. HUD + titles) at time t, as a fresh canvas (used by the paper tear)
      act1Frame: (t) => self.act1Frame(t),
      // gradeCanvas(src, presetId, {t, over}) -> new canvas (full-frame film look for any 2D canvas)
      gradeCanvas: (src, presetId, o = {}) => self.gradeCanvas(src, presetId, o),
      // frame of THIS film rendered earlier (pass-1 cache served by the render server): Promise<ImageBitmap>
      cachedFrame: (frameIdx) => self.cachedFrame(frameIdx),
      sceneT: (ts, sc) => self.sceneT(ts, sc),
      warn: (m) => self.log.warnings.push(m),
    };
  }

  // ---------- helpers -------------------------------------------------------
  sceneT(ts, sc) {
    const T = makeT(ts);
    T.scene = sc; T.lt = ts - sc.t0; T.dur = sc.t1 - sc.t0; T.u = clamp(T.lt / T.dur);
    T.era = sc.section === 'past' ? ERAS[sc.era] : null;
    return T;
  }
  async mod(id) {
    if (this.mods.has(id)) return this.mods.get(id);
    let m = null;
    try { m = (await import(`./scenes/${id}.js`)).default; } catch (e) { console.error(`[scene ${id}] failed to load:`, e && e.stack || e); this.log.warnings.push(`load ${id}: ${e.message}`); }
    this.mods.set(id, m);
    return m;
  }
  _size(w, h) { if (this.renderer.domElement.width !== w || this.renderer.domElement.height !== h) this.renderer.setSize(w, h, false); }

  // ---------- 2D era frame --------------------------------------------------
  // draw era i (or cold open) at time t into slot canvas, matte + grade applied. embedded => era not started yet.
  async eraFrame(sc, t, slot, { embedded = false, boilFrom = t } = {}) {
    const mod = await this.mod(sc.id);
    const ctx = this.cEraCtx[slot], cs = this.cSceneCtx, e = sc.era != null ? ERAS[sc.era] : null;
    const tt = embedded ? sc.t0 : clamp(t, sc.t0, sc.t1 - 1e-6);
    const T = this.sceneT(tt, sc);
    const b = Math.floor(boilFrom * 12 + 1e-6); T.boil = b; T.boilT = b / 12;
    const ratio = e ? (embedded ? e.prevRatio : lerp(e.prevRatio, e.ratio, smooth(T.lt / cues.ERA_MATTE_TIME))) : cues.R169;
    T.frame = overlay.matteRect(ratio); T.ratio = ratio; T.embedded = embedded;
    cs.setTransform(this.scale, 0, 0, this.scale, 0, 0); cs.globalAlpha = 1; cs.globalCompositeOperation = 'source-over'; cs.clearRect(0, 0, LW, LH);
    cs.save();
    try {
      if (mod && mod.draw) mod.draw(cs, T, this.S); else this._placeholder2d(cs, T, sc);
    } catch (err) { console.error(`[scene ${sc.id}] draw error:`, err && err.stack || err); this.log.warnings.push(`draw ${sc.id}: ${err.message}`); this._placeholder2d(cs, T, sc, true); }
    cs.restore();
    cs.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    overlay.drawBars(cs, T.frame, (mod && mod.barColor) || BAR_COLOR);
    this._size(this.W, this.H);
    const preset = (mod && mod.grade) ? (typeof mod.grade === 'function' ? mod.grade(T) : mod.grade) : null;
    const presetId = (e && e.grade) || (sc.id === 'coldopen' ? 'projector' : 'none');
    const over = preset && typeof preset === 'object' ? preset : null;
    this.grade.apply(this.cScene, presetId, { t: boilFrom, frame: Math.round(boilFrom * FPS), w: this.W, h: this.H, scale: this.scale, over });
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.glCanvas, 0, 0);
    return this.cEra[slot];
  }
  _placeholder2d(ctx, T, sc, err = false) {
    pencil.paper(ctx, this.S, { seed: 3 });
    ctx.save(); ctx.fillStyle = err ? '#F2542D' : '#2A2833'; ctx.font = F.display(120); ctx.textAlign = 'center';
    ctx.fillText(sc.id.toUpperCase() + (err ? ' (ERROR)' : ' (stub)'), LW / 2, LH / 2);
    ctx.font = F.label(36); ctx.fillText(`t=${T.t.toFixed(2)} lt=${T.lt.toFixed(2)}`, LW / 2, LH / 2 + 70);
    if (T.era) { ctx.font = F.hand(64, 700); ctx.fillText(T.era.caption, LW / 2, LH / 2 - 150); }
    ctx.restore();
  }

  // ---------- Act I composite (scene or dive) + HUD + titles ---------------
  async act1(t, { huds = true, titles = true } = {}) {
    const sc = sceneAt(t), ctx = this.cAct1Ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, this.W, this.H);
    let base;
    if (sc.id === 'coldopen') base = await this.eraFrame(sc, t, 0);
    else {
      const e = ERAS[sc.era];
      base = await this.eraFrame(sc, t, 0);
      if (e.hasDive && t >= e.diveT0) {
        const nxt = SCENES.find((s) => s.id === ERAS[e.index + 1].id);
        const B = await this.eraFrame(nxt, t, 1, { embedded: true, boilFrom: t });
        this._dive(e, t, base, B);
        base = this.cAcc;
      }
    }
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const T = this.sceneT(clamp(t, sc.t0, sc.t1 - 1e-6), sc); T.t = t; T.boil = Math.floor(t * 12 + 1e-6); T.boilT = T.boil / 12;
    if (huds && cues.hudVisible(t)) hud.draw(ctx, T, this.S, 'paper');
    if (titles) drawTitles(ctx, T, this.S, this.log);
    return this.cAct1;
  }
  // zoom into era e's portal; next era appears inside it. 4 sub-steps blended (motion blur).
  _dive(e, t, A, B) {
    const p = e.portal, acc = this.cAccCtx, cc = this.cCompCtx, s = this.scale;
    const Sfull = (p.type === 'screen' || p.type === 'phone' ? 1250 : 1120) / p.r, lnFull = Math.log(Sfull), lnFit = Math.log(960 / p.r);
    const du = (1 / FPS) / 0.5;
    for (let k = 0; k < 4; k++) {
      const u = clamp((t - e.diveT0) / 0.5 + ((k + 0.5) / 4 - 0.5) * 0.5 * du);
      const q = smoother(u), S = Math.exp(q * lnFull), pr = clamp(Math.log(S) / lnFit), kk = Math.min(1, (2 * p.r * S) / LW);
      const cx = lerp(p.cx, LW / 2, smooth(pr)), cy = lerp(p.cy, LH / 2, smooth(pr));
      cc.setTransform(1, 0, 0, 1, 0, 0); cc.globalAlpha = 1; cc.globalCompositeOperation = 'source-over'; cc.fillStyle = '#000'; cc.fillRect(0, 0, this.W, this.H);
      cc.setTransform(s, 0, 0, s, 0, 0);
      cc.save(); cc.translate(cx, cy); cc.scale(S, S); cc.translate(-p.cx, -p.cy);
      cc.drawImage(A, 0, 0, this.W, this.H, 0, 0, LW, LH);
      portalPath(cc, p); cc.save(); cc.clip();
      cc.translate(p.cx, p.cy); cc.scale(kk / S, kk / S); cc.translate(-LW / 2, -LH / 2);
      cc.drawImage(B, 0, 0, this.W, this.H, 0, 0, LW, LH);
      cc.restore(); cc.restore();
      acc.setTransform(1, 0, 0, 1, 0, 0); acc.globalCompositeOperation = 'source-over'; acc.globalAlpha = k === 0 ? 1 : 1 / (k + 1);
      acc.drawImage(this.cComp, 0, 0);
    }
    acc.globalAlpha = 1;
  }

  async act1Frame(t) {
    const key = Math.round(t * 1000);
    if (this.act1Cache.has(key)) return this.act1Cache.get(key);
    const src = await this.act1(t);
    const c = this.mk(); c.getContext('2d').drawImage(src, 0, 0);
    this.act1Cache.set(key, c);
    return c;
  }
  gradeCanvas(src, presetId, { t = 0, over = null } = {}) {
    this._size(this.W, this.H);
    this.grade.apply(src, presetId, { t, frame: Math.round(t * FPS), w: this.W, h: this.H, scale: this.scale, over });
    const c = this.mk(); c.getContext('2d').drawImage(this.glCanvas, 0, 0); return c;
  }
  async cachedFrame(frameIdx) {
    if (this.frameCache.has(frameIdx)) return this.frameCache.get(frameIdx);
    // exact frame, else the nearest cached one (partial caches exist while developing; the final render has every frame < 1500)
    let r = null, used = frameIdx;
    for (let d = 0; d <= 45 && !(r && r.ok); d++) for (const s of d === 0 ? [0] : [-1, 1]) {
      used = frameIdx + s * d; if (used < 0) continue;
      r = await fetch(`/cache/frames/${String(used).padStart(5, '0')}.jpg`); if (r.ok) break;
    }
    if (!r || !r.ok) throw new Error('no cached frame near ' + frameIdx + ' (run tools/mkcache.mjs)');
    const bmp = await createImageBitmap(await r.blob());
    if (this.frameCache.size > 160) { const k = this.frameCache.keys().next().value; this.frameCache.get(k).close?.(); this.frameCache.delete(k); }
    this.frameCache.set(frameIdx, bmp);
    return bmp;
  }

  // ---------- 3D scene frame ------------------------------------------------
  matteRatio3D(sc, t) {
    if (sc.id === 'turn') return lerp(cues.R169, cues.R239, smooth((t - 23.0) / 1.0));
    return cues.R239;
  }
  async frame3d(sc, t) {
    const mod = await this.mod(sc.id), ctx = this.outCtx;
    const T = this.sceneT(t, sc), ratioR = (mod && mod.ratio) || sc.ratio || cues.R239;
    let st = this.states.get(sc.id);
    const env = { THREE, S: this.S, renderer: this.renderer, W: this.W };
    try {
      if (mod && !st && !this.failed.has(sc.id)) { st = await mod.setup(env); this.states.set(sc.id, st); }
    } catch (err) { console.error(`[scene ${sc.id}] setup error:`, err && err.stack || err); this.log.warnings.push(`setup ${sc.id}: ${err.message}`); this.failed.add(sc.id); st = null; }
    const w = this.W, h = Math.round(w / ratioR / 2) * 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, this.W, this.H);
    let rendered = false, ctl = {};
    if (mod && st && !this.failed.has(sc.id)) {
      try {
        const times = subTimes(t, FPS, this.subframes, this.shutter);
        if (st.camera) { st.camera.aspect = w / h; st.camera.updateProjectionMatrix(); } // engine owns aspect
        if (mod.prepare) await mod.prepare(st, T, this.S, times);
        ctl = mod.update(st, T, this.S) || {};
        this._size(w, h);
        this.post.render({
          scene: st.scene, camera: st.camera, w, h, times,
          update: (ts) => { mod.update(st, this.sceneT(ts, sc), this.S); }, dof: ctl.dof, bloom: ctl.bloom, exposure: ctl.exposure ?? 1, jitter: ctl.jitter !== false,
        });
        rendered = true;
      } catch (err) { console.error(`[scene ${sc.id}] render error:`, err && err.stack || err); this.log.warnings.push(`render ${sc.id}: ${err.message}`); this.failed.add(sc.id); }
    }
    const mr = this.matteRatio3D(sc, t), M = overlay.matteRect(mr);
    ctx.save(); ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    // global hit shake (micro camera shake as a 2D move with slight overscan)
    const [dx, dy, rot] = overlay.shakeOffset(t, T.impact, ctl.shake ?? 5), os = 1 + 0.012 * Math.min(1, T.impact);
    ctx.translate(LW / 2, LH / 2); ctx.rotate(rot); ctx.scale(os, os); ctx.translate(-LW / 2 + dx, -LH / 2 + dy);
    if (rendered) {
      // centre-crop the GL image to the visible matte aspect
      const gw = this.glCanvas.width, gh = this.glCanvas.height, sh = Math.min(gh, gw / mr), sy = (gh - sh) / 2;
      ctx.drawImage(this.glCanvas, 0, sy, gw, sh, M.x, M.y, M.w, M.h);
    } else { ctx.fillStyle = '#1a1020'; ctx.fillRect(M.x, M.y, M.w, M.h); ctx.fillStyle = '#F2542D'; ctx.font = F.display(110); ctx.textAlign = 'center'; ctx.fillText(sc.id.toUpperCase() + (mod ? ' (ERROR)' : ' (stub)'), LW / 2, LH / 2); }
    ctx.restore();
    ctx.save(); ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    if (rendered && mod.overlay2d) { try { mod.overlay2d(ctx, T, this.S, st); } catch (e) { console.error(`[scene ${sc.id}] overlay2d error:`, e && e.stack || e); } }
    overlay.drawVignette(ctx, 0.32, M);
    ctx.restore();
    overlay.drawGrain(ctx, this.S, Math.round(t * FPS), 0.05, { x: M.x, y: M.y, w: M.w, h: M.h });
    ctx.save(); ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    overlay.drawBars(ctx, M, '#000');
    ctx.restore();
    return T;
  }

  // ---------- one frame -----------------------------------------------------
  async renderFrame(t) {
    const t0 = performance.now(); this.log.rects = [];
    t = clamp(t, 0, cues.DURATION - 1e-6);
    const sc = sceneAt(t), ctx = this.outCtx;
    let T;
    if (sc.kind === '2d') {
      T = this.sceneT(t, sc);
      const a = await this.act1(t);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(a, 0, 0);
    } else {
      T = await this.frame3d(sc, t);
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      if (cues.hudVisible(t)) hud.draw(ctx, T, this.S, 'digital');
      drawTitles(ctx, T, this.S, this.log);
    }
    // global finishing flash on big hits
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    if (t >= 22) overlay.drawFlash(ctx, Math.max(0, T.impact - 0.55) * 0.5);
    // end-card: projector click-off flicker to black over the last frames
    if (t >= cues.MUSIC.projectorClickOff) {
      const x = (t - cues.MUSIC.projectorClickOff) / (cues.DURATION - cues.MUSIC.projectorClickOff);
      const on = x < 0.3 ? 1 - 0.35 * Math.abs(Math.sin(x * 60)) : 1, fade = smooth((x - 0.62) / 0.3);
      ctx.save(); ctx.fillStyle = `rgba(0,0,0,${clamp(1 - on * (1 - fade) + 0, 0, 1)})`; ctx.fillRect(0, 0, LW, LH); ctx.restore();
    }
    return { scene: sc.id, ms: performance.now() - t0, rects: this.log.rects, warnings: this.log.warnings.splice(0) };
  }


  // render frame idx and POST it to the render server (full-res JPEG) + optionally the small cache copy (Droste source)
  async frameJob(idx, { cache = false, quality = this.quality, cacheQuality = 0.88 } = {}) {
    const info = await this.renderFrame(idx / FPS);
    const size = await this.postFrame('/frame', idx, 'image/jpeg', quality);
    if (cache) {
      if (!this._small) { this._small = this.mk(1280, 720); this._smallCtx = this._small.getContext('2d'); }
      this._smallCtx.drawImage(this.out, 0, 0, 1280, 720);
      const b = await new Promise((res) => this._small.toBlob(res, 'image/jpeg', cacheQuality));
      const r = await fetch(`/cache?i=${idx}`, { method: 'POST', body: b }); if (!r.ok) throw new Error('cache post failed');
    }
    return { size, ms: info.ms, scene: info.scene, warnings: info.warnings };
  }


  // QA: render frame t then return luminance statistics of the finished frame (64x36 probe)
  async lintFrame(t) {
    const info = await this.renderFrame(t);
    if (!this._probe) { this._probe = document.createElement('canvas'); this._probe.width = 64; this._probe.height = 36; this._probeCtx = this._probe.getContext('2d', { willReadFrequently: true }); }
    this._probeCtx.drawImage(this.out, 0, 0, 64, 36);
    const d = this._probeCtx.getImageData(0, 0, 64, 36).data; let sum = 0, sq = 0, dark = 0; const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; sum += l; sq += l * l; if (l < 10) dark++; }
    const mean = sum / n, std = Math.sqrt(Math.max(0, sq / n - mean * mean));
    return { t, scene: info.scene, ms: Math.round(info.ms), mean: +mean.toFixed(1), std: +std.toFixed(1), dark: +(dark / n).toFixed(3), rects: info.rects, warnings: info.warnings };
  }

  async toBlob(type = 'image/jpeg', q = this.quality) { return new Promise((res) => this.out.toBlob(res, type, q)); }
  async postFrame(url, idx, type = 'image/jpeg', q = this.quality) {
    const b = await this.toBlob(type, q);
    const r = await fetch(`${url}?i=${idx}`, { method: 'POST', body: b });
    if (!r.ok) throw new Error('post failed ' + r.status);
    return b.size;
  }
  dataURL(type = 'image/png', q = 0.95) { return this.out.toDataURL(type, q); }
}

window.film = new Film();
window.__filmReady = true;
