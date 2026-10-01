// =============================================================================
// job_script.js — "SCRIPT" (26.0 – 28.0) · low-angle 50 mm hero shot on the soundstage.
//   26.000 + 0.125k  eight glowing 3D typewriter words punch into the air (typebar strike, spark, overshoot)
//   27.000           bell: words lift, flash, flatten into page rectangles that fly to an assembly point
//   27.250           pages crease (origami dog-ears) and fold in half, rippling top to bottom
//   27.500           snap: cover boards clamp, brass brads punch, tabs pop; the SCRIPT booklet floats beside Amrita
// Pure function of T.t / T.lt (4 sub-frames per frame = motion blur). No Math.random / Date.now.
// This file also exports a small "kit" (beams, dust, sparks, rings, glyph extrusion, env map) that
// job_storyboard.js re-uses, so both set-ups share one lighting language.
// =============================================================================
import { createStage } from '../stage3d.js';
import { createAmrita } from '../amrita3d.js';
import * as E from '../ease.js';
import { hash, rng as mkRng, noise1 } from '../rng.js';

const { clamp, lerp, smooth, smoother, outCubic, outBack, spring } = E;
const TAU = Math.PI * 2;
const seg = (x, a, b) => clamp((x - a) / (b - a)); // progress of x through [a,b], 0..1
const PX = { amber: '#FFB62E', cream: '#FFF3D6', vermilion: '#F2542D', teal: '#1FB5A6', violet: '#6B5BFF', sky: '#7CC4FF', ink: '#0E0D12', graphite: '#2A2833', paper: '#F2EBDC' };

// Special Elite (typewriter) outlines, simplified: advance;contour|contour  (1/1000 em, y up). Generated offline from the shipped @fontsource file.
const GLYPHS = {
  
  A:"550;550 35 536 12 487 -10 419 -15 349 6 331 31 386 93 388 138 348 186 265 193 196 164 173 99 178 75 220 50 237 5 66 -6 1 12 10 44 94 92 111 185 140 245 141 319 158 329 138 336 154 378 149 430 213 673 231 691 320 701 351 655 444 169 438 110 487 61|345 298 307 466 271 493 250 479 237 429 227 277 244 261 285 263", 
  B:"604;556 202 552 165 513 153 535 126 504 70 415 19 320 -3 103 -6 60 9 62 43 117 84 136 129 136 544 121 602 45 639 34 680 70 696 313 703 461 669 516 609 544 538 530 449 492 371 545 268|463 500 447 569 389 612 306 623 232 608 208 582 186 424 286 410 379 418 436 447|479 174 465 256 402 314 298 328 213 313 192 222 191 106 206 70 283 63 393 82 441 109", 
  C:"579;530 261 515 178 492 169 476 99 424 43 271 -13 217 5 151 64 101 125 87 168 63 183 46 308 67 518 131 650 261 697 418 667 459 698 501 683 527 611 520 457 502 404 445 427 445 439 464 433 393 551 334 591 254 601 170 557 140 478 131 269 143 195 187 103 215 89 290 91 386 132 430 219 446 323 497 318", 
  D:"623;579 314 536 136 475 42 424 27 411 6 346 -8 78 -7 62 62 127 86 145 112 137 385 119 571 40 619 44 661 122 710 280 711 401 688 481 632 536 547|497 347 475 417 482 476 444 561 353 598 229 578 216 166 227 101 310 77 438 138 467 190", 
  E:"639;587 487 568 446 524 460 506 570 517 612 500 619 283 601 225 620 186 590 180 443 194 386 312 389 328 423 329 508 385 501 395 251 371 195 343 214 316 295 249 299 192 281 190 91 255 70 473 82 510 125 510 249 545 264 568 252 581 220 573 106 551 35 518 9 117 -16 59 4 55 35 121 90 132 153 119 219 134 528 106 596 47 622 43 658 183 684 517 689 563 635", 
  F:"605;595 506 578 469 524 466 492 583 459 615 281 625 207 602 196 427 225 396 312 415 341 526 369 533 393 514 402 217 381 187 355 183 324 225 336 245 315 296 234 305 198 265 203 119 217 94 291 79 296 9 279 -3 121 -8 45 5 54 72 135 104 141 360 129 583 103 619 37 626 35 674 174 686 204 703 242 689 389 708 529 697 566 643", 
  G:"615;586 331 575 299 526 278 523 41 506 2 473 3 437 52 346 5 249 5 180 32 113 94 59 237 46 352 74 571 192 696 320 709 410 677 475 696 499 661 499 564 519 522 493 426 462 436 430 489 422 543 345 620 212 628 213 601 136 508 143 396 129 296 146 187 213 83 319 75 403 136 449 251 375 309 388 354 483 382 560 363", 
  H:"653;622 27 592 6 435 -19 382 2 377 48 410 63 444 56 465 93 469 263 434 314 342 321 208 285 201 140 223 81 291 49 292 -1 107 -15 45 4 53 55 124 89 140 136 140 547 113 596 45 625 54 672 113 689 265 673 274 635 223 615 194 572 206 414 252 386 401 378 450 399 463 421 453 578 432 607 360 630 356 669 387 682 532 685 600 664 601 631 523 579 521 195 538 76 602 51", 
  I:"495;469 646 426 609 355 605 341 619 306 580 288 397 301 376 297 97 331 75 446 76 464 46 454 2 406 -23 42 -12 29 26 58 71 153 66 210 105 219 333 202 594 162 626 148 605 47 609 27 630 37 664 83 699 266 710 298 691 315 710 329 682 351 704 398 678 384 696 414 707 449 695", 
  J:"541;538 647 511 605 414 599 391 568 400 207 377 108 285 17 185 -3 96 30 32 86 19 119 24 207 57 259 123 264 158 236 171 167 131 101 155 71 212 65 297 95 321 167 321 532 292 605 191 615 165 652 168 676 300 702 404 685 457 693 518 681", 
  K:"583;584 22 512 8 362 15 376 63 408 77 407 106 339 249 260 349 206 299 192 212 202 99 279 61 277 31 249 7 122 -4 73 21 68 56 129 94 142 134 141 438 129 605 35 633 29 660 46 689 210 710 279 692 276 629 216 615 188 578 194 429 210 395 275 494 366 592 351 685 462 700 575 668 549 636 471 614 401 543 342 411 352 358 387 320 407 238 477 86", 
  L:"603;582 136 568 36 520 4 391 -13 266 5 86 -7 55 7 55 58 138 106 150 157 133 590 116 619 45 620 24 647 57 708 270 717 351 689 338 627 233 612 233 557 204 550 226 519 220 430 196 409 217 400 226 183 250 98 406 83 491 102 505 138 497 239 525 275 568 256", 
  M:"698;652 35 633 12 590 3 491 13 466 28 472 56 520 70 531 91 514 266 519 395 500 473 474 446 447 349 411 78 385 27 333 7 301 58 276 131 243 359 207 456 179 409 193 285 180 113 191 89 249 56 231 18 181 -8 96 -9 59 10 51 62 118 104 110 306 124 369 115 594 56 632 60 654 151 703 241 660 274 532 318 237 349 184 388 263 398 450 424 527 415 547 437 661 545 684 644 654 639 621 585 602 569 550 587 436 569 292 582 168 571 93 583 65 651 58", 
  N:"628;594 642 521 600 527 375 511 184 530 52 517 21 468 -3 428 24 356 159 238 472 216 495 199 458 201 289 174 257 193 248 208 210 203 85 237 55 283 58 292 17 264 -14 104 -14 49 9 43 32 59 55 139 77 146 160 121 562 50 617 56 682 161 695 235 662 302 514 342 360 403 257 399 221 458 121 473 162 473 248 440 588 426 607 354 620 344 671 389 696 465 697 542 668 572 678", 
  O:"617;573 329 532 113 495 77 462 83 469 63 497 63 480 39 361 -29 256 -23 184 9 97 102 54 287 43 437 95 596 148 661 194 680 332 702 426 681 536 549|494 332 478 448 443 551 418 574 341 595 239 598 154 517 127 378 134 224 198 135 282 76 349 65 413 83 453 131 485 219", 
  P:"553;527 503 515 427 459 352 363 305 249 305 187 280 206 266 204 103 270 70 291 34 275 3 55 -6 56 49 132 94 123 556 152 592 117 592 92 623 59 622 43 658 208 689 314 684 430 649 517 559|446 474 428 550 366 603 230 609 199 601 182 576 200 522 189 514 198 475 180 450 221 383 365 391 429 420", 
  Q:"602;571 1 535 -73 457 -97 405 -93 366 -55 349 14 188 33 119 98 68 225 70 285 43 398 79 550 71 576 92 602 105 599 157 684 295 710 358 705 410 683 495 583 530 472 527 260 509 167 418 50 411 13 419 -32 467 -59 526 24 561 24|488 348 463 479 403 606 279 647 207 625 140 564 110 309 120 224 176 153 195 146 242 214 304 229 370 204 404 159 424 158 469 244|307 131 293 146 266 139 265 98 297 98", 
  R:"637;624 77 609 22 587 4 534 -8 457 17 428 68 411 251 391 293 371 320 238 321 199 290 189 141 211 107 290 66 287 28 215 -3 58 -8 21 6 25 42 120 81 134 166 135 549 115 612 63 635 67 681 181 702 273 693 347 705 440 690 483 667 531 593 547 509 536 424 500 397 460 332 496 163 529 90 579 138 614 121|478 526 448 592 395 619 229 613 199 582 194 432 216 409 269 415 309 399 411 426", 
  S:"589;546 244 539 146 508 144 531 132 528 120 479 61 451 60 444 37 292 -11 166 14 110 -5 88 5 55 74 52 219 66 289 114 229 124 134 204 70 338 69 441 137 474 182 465 266 406 312 215 346 135 383 99 427 73 506 102 599 167 660 217 676 411 668 441 689 483 675 503 558 486 442 452 463 392 581 301 604 176 564 166 485 186 446 240 410 414 390 471 360 529 296", 
  T:"594;564 510 560 471 537 446 496 480 470 567 489 621 467 646 413 654 329 626 333 339 349 296 336 181 372 107 469 83 468 35 447 21 230 2 147 14 140 50 168 67 162 77 247 98 269 144 257 458 266 615 250 635 188 647 108 628 89 594 91 495 69 446 51 441 38 454 25 598 52 687 86 704 440 706 524 693 555 654", 
  U:"622;611 660 519 610 500 560 482 550 505 508 511 303 497 250 511 202 499 141 469 118 474 83 425 29 342 -5 229 6 173 32 130 98 104 252 118 531 104 606 88 630 31 655 27 676 81 698 185 703 263 674 258 647 178 555 179 367 162 292 182 285 191 153 221 110 315 35 338 53 336 28 366 52 336 63 342 73 395 101 434 146 432 537 445 568 406 612 343 626 335 684 364 702 478 710 587 686", 
  V:"611;613 681 596 640 504 590 458 480 448 383 418 313 425 244 362 90 377 56 365 26 311 -14 255 4 188 195 193 230 148 370 154 411 118 566 85 612 12 634 1 673 131 707 210 699 240 680 245 638 195 605 182 571 213 479 216 376 244 327 251 228 282 188 314 208 355 327 341 364 405 570 332 657 343 701 470 725 540 716", 
  W:"644;614 662 563 586 539 486 509 253 512 144 483 26 464 2 442 2 404 17 386 47 340 362 348 405 328 468 306 453 292 387 272 370 293 339 280 316 266 63 231 14 179 18 157 50 124 389 104 444 123 500 141 492 188 321 188 241 200 224 221 231 226 309 250 370 271 598 214 642 149 627 121 588 141 559 125 529 75 604 14 629 13 652 56 672 197 662 256 685 341 676 362 688 432 667 576 688 613 676|500 584 477 623 424 642 379 621 365 594 389 531 379 493 399 387 417 364 418 266 452 278", 
  X:"582;580 63 565 15 534 2 336 15 324 69 359 133 315 229 275 245 210 133 249 56 234 15 54 5 9 17 20 64 121 123 243 368 135 592 103 624 30 644 15 678 111 690 227 683 237 656 197 612 235 528 283 476 328 511 367 607 335 651 345 682 494 697 555 674 556 649 466 617 428 581 349 414 337 351 371 259 450 128 486 102 565 87", 
  Y:"561;253 636 212 605 212 575 238 511 285 460 345 529 375 620 304 644 292 672 304 693 368 716 503 717 539 711 558 690 547 631 452 588 325 308 331 112 354 84 416 98 456 90 495 54 479 11 97 -2 72 35 74 57 101 74 240 90 253 309 122 592 88 614 -4 634 -19 664 32 711 161 717 248 696 261 667", 
  Z:"592;550 219 521 8 224 -1 72 13 50 132 104 213 168 250 152 283 305 496 351 604 343 622 287 640 248 620 141 628 123 596 119 485 94 463 72 482 54 594 58 648 84 682 445 708 496 680 508 656 460 529 384 453 335 355 279 299 185 146 188 122 362 109 437 130 453 150 473 313 496 312 513 283 544 271", 
};


// ============================== KIT (exported) ===============================
// 36 mm-gate "mm" lens -> vertical fov (deg) for a given render aspect.
export function lensFov(mm, ratio = 2.39, gate = 36) { return (2 * Math.atan(Math.tan(Math.atan(gate / (2 * mm))) / ratio) * 180) / Math.PI; }
// pixels per world unit at distance 1 (for point sprites) for the GL target this scene renders into
export function pxPerUnit(S, fovDeg, ratio = 2.39) { const h = Math.round((S.W * S.scale) / ratio / 2) * 2; return h / (2 * Math.tan((fovDeg * Math.PI) / 360)); }

export function radialTexture(THREE, S, stops = [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']], size = 128) {
  const c = S.mk(size, size), g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx;
}

// tiny procedural studio environment (soft boxes) -> PMREM texture, so clear-coated PBR has something to reflect
export function makeEnv(THREE, renderer, boxes) {
  const sc = new THREE.Scene(); sc.background = new THREE.Color(0x020204);
  for (const b of boxes) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), new THREE.MeshBasicMaterial({ color: new THREE.Color(b.color).multiplyScalar(b.i), side: THREE.DoubleSide }));
    m.position.set(...b.pos); m.lookAt(0, 0, 0); sc.add(m);
  }
  const pm = new THREE.PMREMGenerator(renderer); const rt = pm.fromScene(sc, 0.035); pm.dispose();
  return rt.texture;
}

// ---- volumetric light cone (additive, fresnel-soft edges, gentle shimmer). apex at the mesh origin, pointing -Y until aimed.
export function makeBeam(THREE, { color = '#ffd9a0', length = 10, radius = 1.8, apex = 0.05, intensity = 0.2, power = 1.4, noise = 0.25 } = {}) {
  const geo = new THREE.CylinderGeometry(apex, radius, length, 44, 1, true); geo.translate(0, -length / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uI: { value: intensity }, uTime: { value: 0 }, uPow: { value: power }, uNoise: { value: noise }, uLen: { value: length } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vW; uniform float uLen;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = -mv.xyz; vH = -position.y/uLen; vW = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vW; uniform vec3 uColor; uniform float uI,uTime,uPow,uNoise;
      void main(){ float f = abs(dot(normalize(vN), normalize(vV))); float e = pow(f, uPow);
        float lf = smoothstep(0.0,0.10,vH)*pow(max(1.0-vH,0.0),1.15);
        float n = 1.0 - uNoise + uNoise*(0.5+0.5*sin(vW.x*2.3+uTime*0.35)*sin(vW.y*1.9-uTime*0.27+vW.z*1.3));
        gl_FragColor = vec4(uColor*e*lf*n*uI, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 6;
  const dir = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
  mesh.userData.aim = (from, to, len = length) => { dir.subVectors(to, from); const d = dir.length(); dir.multiplyScalar(1 / d); mesh.position.copy(from); mesh.quaternion.setFromUnitVectors(down, dir); mesh.scale.setScalar(len / length); mesh.userData.dir = dir.clone(); return mesh; };
  return mesh;
}

// ---- floating dust motes (analytic drift in the vertex shader, optionally masked to a light cone so they glint only inside the beam)
export function makeDust(THREE, { count = 300, center = [0, 2, 0], size = [8, 5, 6], color = '#ffe2b0', psize = 0.022, intensity = 1, seed = 1, beam = null } = {}) {
  const r = mkRng(seed * 977 + 13), pos = new Float32Array(count * 3), sd = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = center[0] + (r() - 0.5) * size[0]; pos[i * 3 + 1] = center[1] + (r() - 0.5) * size[1]; pos[i * 3 + 2] = center[2] + (r() - 0.5) * size[2];
    sd[i * 4] = r(); sd[i * 4 + 1] = 0.4 + r() * 1.2; sd[i * 4 + 2] = 0.5 + r() * 1.2; sd[i * 4 + 3] = r();
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 1000 }, uColor: { value: new THREE.Color(color) }, uI: { value: intensity }, uSize: { value: psize }, uCy: { value: center[1] }, uH: { value: size[1] },
      uBO: { value: new THREE.Vector3() }, uBD: { value: new THREE.Vector3(0, -1, 0) }, uBK: { value: 0 } },
    vertexShader: `attribute vec4 aSeed; uniform float uTime,uPx,uSize,uCy,uH,uBK; uniform vec3 uBO,uBD; varying float vA;
      void main(){ vec3 p = position;
        p.x += sin(uTime*aSeed.y*0.35 + aSeed.x*6.283)*0.30; p.z += cos(uTime*aSeed.y*0.27 + aSeed.x*11.0)*0.30;
        float y01 = fract((p.y - uCy)/uH + 0.5 + uTime*0.045*(0.4+aSeed.w)/uH); p.y = uCy + (y01-0.5)*uH;
        float mask = 1.0;
        if (uBK > 0.0) { vec3 d = p - uBO; float al = dot(d,uBD); vec3 q = d - uBD*al; float rm = max(al*uBK,0.0001); mask = step(0.0,al)*smoothstep(rm, rm*0.5, length(q))*smoothstep(0.0,1.2,al); }
        float tw = 0.55 + 0.45*sin(uTime*aSeed.y*2.0 + aSeed.x*40.0);
        vA = mask*tw*smoothstep(0.0,0.12,y01)*smoothstep(1.0,0.88,y01);
        vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = max(aSeed.z*uSize*uPx/max(-mv.z,0.1), 1.6); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uI; varying float vA; void main(){ float d = length(gl_PointCoord-0.5)*2.0; float a = smoothstep(1.0,0.0,d); a *= a; if (a*vA < 0.06) discard; gl_FragColor = vec4(uColor*uI, a*vA); }`,
    transparent: true, depthWrite: true, blending: THREE.AdditiveBlending, fog: false,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 7;
  pts.userData.setBeam = (o, d, halfAngle) => { mat.uniforms.uBO.value.copy(o); mat.uniforms.uBD.value.copy(d); mat.uniforms.uBK.value = Math.tan(halfAngle); };
  if (beam) pts.userData.setBeam(beam.o, beam.d, beam.a);
  return pts;
}

// ---- spark bursts: every spark is born at a fixed global time and flies on an analytic arc (drag + gravity) computed in the vertex shader.
// bursts: [{t, pos:[x,y,z], n, speed:[a,b], life:[a,b], dir:[x,y,z] (mean direction), spread (0..1: 0 = along dir, 1 = sphere), size:[a,b] (m), color:[r,g,b] (HDR), seed}]
export function makeSparks(THREE, bursts, { gravity = [0, -1.2, 0], drag = 1.6 } = {}) {
  let N = 0; for (const b of bursts) N += b.n;
  const o = new Float32Array(N * 3), v = new Float32Array(N * 3), tl = new Float32Array(N * 3), col = new Float32Array(N * 3);
  let i = 0;
  bursts.forEach((b, bi) => {
    const r = mkRng((b.seed ?? bi) * 7919 + 101), dm = Math.hypot(...b.dir) || 1, dx = b.dir[0] / dm, dy = b.dir[1] / dm, dz = b.dir[2] / dm;
    for (let k = 0; k < b.n; k++, i++) {
      // random direction on a sphere blended with the mean direction
      const u = r() * 2 - 1, ph = r() * TAU, s = Math.sqrt(1 - u * u), rx = s * Math.cos(ph), ry = u, rz = s * Math.sin(ph);
      let ax = lerp(dx, rx, b.spread), ay = lerp(dy, ry, b.spread), az = lerp(dz, rz, b.spread); const am = Math.hypot(ax, ay, az) || 1; ax /= am; ay /= am; az /= am;
      const sp = lerp(b.speed[0], b.speed[1], r());
      o.set([b.pos[0], b.pos[1], b.pos[2]], i * 3); v.set([ax * sp, ay * sp, az * sp], i * 3);
      tl.set([b.t + r() * 0.012, lerp(b.life[0], b.life[1], r()), lerp(b.size[0], b.size[1], r())], i * 3);
      const hot = r(); col.set([b.color[0] * (0.7 + 0.5 * hot), b.color[1] * (0.7 + 0.5 * hot), b.color[2] * (0.7 + 0.5 * hot)], i * 3);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(o, 3)); geo.setAttribute('aVel', new THREE.BufferAttribute(v, 3)); geo.setAttribute('aTL', new THREE.BufferAttribute(tl, 3)); geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 1000 }, uG: { value: new THREE.Vector3(...gravity) }, uDrag: { value: drag } },
    vertexShader: `attribute vec3 aVel; attribute vec3 aTL; attribute vec3 aCol; uniform float uTime,uPx,uDrag; uniform vec3 uG; varying vec3 vC; varying float vA;
      void main(){ float age = uTime - aTL.x; float life = aTL.y;
        if (age < 0.0 || age > life) { gl_Position = vec4(2.0,2.0,2.0,1.0); gl_PointSize = 0.0; vC = vec3(0.0); vA = 0.0; return; }
        float k = (1.0 - exp(-uDrag*age))/uDrag; vec3 p = position + aVel*k + 0.5*uG*age*age;
        float x = age/life; vA = pow(1.0-x, 1.4) * smoothstep(0.0,0.03,age); vC = aCol * (1.0 + 2.2*(1.0-x));
        vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = max(aTL.z*(1.0-0.55*x)*uPx/max(-mv.z,0.1), 1.0); }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord-0.5)*2.0; float a = smoothstep(1.0,0.0,d); float core = smoothstep(0.55,0.0,d); if (a*vA < 0.05) discard; gl_FragColor = vec4(vC*(0.5+1.5*core), a*vA); }`,
    transparent: true, depthWrite: true, blending: THREE.AdditiveBlending, fog: false,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 9; return pts;
}

// ---- shock rings (camera-facing, additive). rings: [{t, pos, r0, r1, dur, color:[r,g,b], width}]
export function makeRings(THREE, rings) {
  const grp = new THREE.Group(); grp.name = 'rings';
  const geo = new THREE.RingGeometry(0.965, 1.0, 96, 1);
  const items = rings.map((r) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(...r.color), transparent: true, opacity: 0, depthWrite: true, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }));
    m.position.set(...r.pos); m.renderOrder = 8; m.visible = false; m.frustumCulled = false; grp.add(m); return { m, r };
  });
  grp.userData.update = (t, camera) => {
    for (const { m, r } of items) {
      const a = (t - r.t) / r.dur;
      if (a < 0 || a > 1) { m.visible = false; continue; }
      const e = 1 - (1 - a) ** 3, rad = lerp(r.r0, r.r1, e), w = (r.width ?? 0.08) * (1 - 0.6 * a);
      m.visible = true; m.quaternion.copy(camera.quaternion); m.scale.set(rad, rad, 1); m.material.opacity = (1 - a) ** 1.6;
    }
  };
  return grp;
}

// ---- glyph extrusion from the embedded Special Elite outlines. Returns {geo, width, height}; geometry is centred on the word's bbox (x), cap-height middle (y), depth middle (z).
const glyphCache = new Map();
function glyph(ch) {
  if (glyphCache.has(ch)) return glyphCache.get(ch);
  const [advS, cs] = GLYPHS[ch].split(';'), adv = +advS / 1000;
  const polys = cs.split('|').map((c) => { const n = c.trim().split(/\s+/).map(Number), p = []; for (let i = 0; i < n.length; i += 2) p.push([n[i] / 1000, n[i + 1] / 1000]); return p; });
  const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };
  const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { if ((poly[i][1] > pt[1]) !== (poly[j][1] > pt[1]) && pt[0] < ((poly[j][0] - poly[i][0]) * (pt[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c; } return c; };
  const areas = polys.map(area), big = areas.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  const outers = [], holes = [];
  polys.forEach((p, i) => (Math.sign(areas[i]) === Math.sign(big) ? outers.push({ pts: p, holes: [] }) : holes.push(p)));
  for (const h of holes) { const o = outers.find((q) => inside(h[0], q.pts)) || outers[0]; o.holes.push(h); }
  const g = { adv, outers }; glyphCache.set(ch, g); return g;
}
export function wordGeometry(THREE, str, { size = 0.34, depth = 0.05, bevel = 0.006, track = 0.04 } = {}) {
  const shapes = []; let pen = 0;
  for (const ch of str) {
    if (ch === ' ') { pen += 0.55 + track; continue; }
    const g = glyph(ch);
    for (const o of g.outers) {
      const sh = new THREE.Shape(o.pts.map(([x, y]) => new THREE.Vector2((pen + x) * size, y * size)));
      for (const h of o.holes) sh.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2((pen + x) * size, y * size))));
      shapes.push(sh);
    }
    pen += g.adv + track;
  }
  const geo = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 1, curveSegments: 1, steps: 1 });
  geo.computeBoundingBox(); const bb = geo.boundingBox;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -0.35 * size, -depth / 2);
  return { geo, width: bb.max.x - bb.min.x, height: 0.7 * size };
}

// ---- a glowing stylus that floats beside Amrita ("she writes"): tip flashes on every keystroke
export function makeStylus(THREE) {
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  const steel = new THREE.MeshStandardMaterial({ color: '#2a2833', roughness: 0.3, metalness: 0.8 });
  const brass = new THREE.MeshStandardMaterial({ color: '#ffc85a', roughness: 0.25, metalness: 0.9, emissive: new THREE.Color('#ff9d1c'), emissiveIntensity: 0.35 });
  const tipM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd28a').multiplyScalar(3), toneMapped: false });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.021, 0.5, 16), steel); inner.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0225, 0.0225, 0.05, 16), brass); band.position.y = 0.19; inner.add(band);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.017, 0.09, 16), brass); cone.position.y = 0.295; inner.add(cone);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 10), tipM); tip.position.y = 0.345; inner.add(tip);
  inner.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, inner, tip, tipM, tipPos: new THREE.Vector3(0, 0.345, 0) };
}

// ============================ SCRIPT SCENE ===================================
const T0 = 26;                       // scene start (global s)
const WORDS = ['THE', 'LAST', 'NIGHT', 'TRAIN', 'LEAVES', 'FOR', 'THE', 'MOON'];
const WSCALE = [0.8, 1, 1, 1, 0.92, 0.8, 0.8, 1.12];   // typographic hierarchy: small words smaller, hero words hotter
const WHOT = [0.55, 1.0, 1.0, 1.0, 0.85, 0.55, 0.55, 1.25];
const LINES = [[0, 1, 2, 3], [4, 5, 6, 7]];
const KEYS = Array.from({ length: 8 }, (_, k) => 0.125 * k);   // lt of each typewriter_key (cues.SFX: 26.0 + 0.125k)
const BELL = 1.0, FOLD0 = 1.28, SNAP = 1.5;                    // lt of bell (27.0), page_fold (27.25 +), page_snap (27.5)
const AM = [1.75, 1.0, 0];                                    // Amrita's centre
const EM = 0.255;                                               // em size of the typed words (m)
const ASM = [-0.55, 1.5, 1.0];                               // assembly point of the pages
const REST = [0.2, 1.3, 0.95];                               // booklet resting place, beside her

// ---- paper textures ----------------------------------------------------------------------------
function pageTexture(THREE, S, seed) {
  const w = 420, h = 560, c = S.mk(w, h), g = c.getContext('2d'), r = mkRng(seed * 31 + 5);
  g.fillStyle = '#f7edd4'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 34; i++) { g.fillStyle = `rgba(196,160,104,${0.025 + r() * 0.035})`; g.beginPath(); g.arc(r() * w, r() * h, 24 + r() * 70, 0, TAU); g.fill(); }
  g.fillStyle = 'rgba(46,38,32,0.82)'; g.textBaseline = 'alphabetic';
  const heads = ['INT. NIGHT TRAIN', 'EXT. SILVER MOON', 'INT. DEPOT - DAWN', 'FADE IN:', 'EXT. LONG ROAD'];
  let y = 58; g.font = S.F.type(15);
  const bar = (x, len, hh = 5, a = 0.62) => { g.globalAlpha = a; g.fillRect(x, y, len, hh); g.globalAlpha = 1; };
  while (y < h - 60) {
    const k = r();
    if (k < 0.24) { g.font = S.F.type(15); g.fillText(heads[Math.floor(r() * heads.length)], 54, y + 7); y += 30; }
    else if (k < 0.62) { const n = 2 + Math.floor(r() * 3); for (let i = 0; i < n; i++) { bar(54, (w - 108) * (i === n - 1 ? 0.35 + r() * 0.4 : 0.86 + r() * 0.12)); y += 15; } y += 17; }
    else { bar(w * 0.43, 62 + r() * 40, 5, 0.8); y += 15; const n = 2 + Math.floor(r() * 2); for (let i = 0; i < n; i++) { bar(w * 0.24, w * 0.5 * (i === n - 1 ? 0.5 + r() * 0.3 : 0.92)); y += 15; } y += 17; }
  }
  g.globalAlpha = 0.5; g.fillRect(w - 78, 26, 26, 5); g.globalAlpha = 1;
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; return tx;
}
function coverTexture(THREE, S) {
  const w = 420, h = 560, c = S.mk(w, h), g = c.getContext('2d'), r = mkRng(77);
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#34313f'); gr.addColorStop(1, '#1d1b25'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.035})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1); }
  g.strokeStyle = '#FFB62E'; g.lineWidth = 3; g.strokeRect(26, 26, w - 52, h - 52); g.lineWidth = 1; g.globalAlpha = 0.6; g.strokeRect(36, 36, w - 72, h - 72); g.globalAlpha = 1;
  g.fillStyle = '#FFB62E'; g.textAlign = 'center'; g.font = S.F.type(112); g.shadowColor = 'rgba(255,170,40,0.9)'; g.shadowBlur = 22; g.fillText('SCRIPT', w / 2, h * 0.47); g.shadowBlur = 0;
  g.fillRect(w * 0.2, h * 0.47 + 22, w * 0.6, 5);
  g.fillStyle = '#FFF3D6'; g.font = S.F.type(26); g.fillText('FADE IN:', w / 2, h * 0.47 + 74);
  g.fillStyle = '#F2542D'; g.fillRect(w * 0.5 - 22, h - 118, 44, 8);
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; return tx;
}

// ---- the booklet: 8 sheets (landscape spreads) that crease + fold in half, then boards / spine / brads / tabs -------------------
function buildBooklet(THREE, S) {
  const K = 8, W2 = 0.525, H = 0.70, gap = 0.0045, th = 0.0035, L = 0.17;   // W2 = half-sheet width
  const texL = pageTexture(THREE, S, 1), texR = pageTexture(THREE, S, 2), texC = coverTexture(THREE, S);
  const mkPage = (tex) => new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color('#ffbd5e'), emissiveIntensity: 0.3, roughness: 0.82, metalness: 0, color: '#e2d3b0' });
  const matL = mkPage(texL), matR = mkPage(texR);
  const root = new THREE.Group(); root.name = 'booklet';
  const pageGeo = new THREE.BoxGeometry(W2, H, th);
  const tri = new THREE.Shape(); const hl = L / Math.SQRT2; tri.moveTo(-hl, 0); tri.lineTo(hl, 0); tri.lineTo(0, hl); tri.closePath();
  const flapGeo = new THREE.ExtrudeGeometry(tri, { depth: th * 0.7, bevelEnabled: false });
  const flapMat = new THREE.MeshStandardMaterial({ color: '#e6d6b2', emissive: new THREE.Color('#ffbd5e'), emissiveIntensity: 0.3, roughness: 0.8, side: THREE.DoubleSide });
  const sheets = [];
  for (let k = 0; k < K; k++) {
    const g = new THREE.Group(), zk = -0.003 - (K - 1 - k) * gap, za = -zk;          // stack height (booklet-local) and hinge-axis offset above the sheet
    const right = new THREE.Mesh(pageGeo, matR); right.position.x = W2 / 2; g.add(right);
    const hinge = new THREE.Group(); hinge.position.z = za; g.add(hinge);
    const left = new THREE.Mesh(pageGeo, matL); left.position.set(-W2 / 2, 0, -za); hinge.add(left);
    // dog-ear: hinge line through the top-left corner of the LEFT half (left-mesh local coords: corner at (-W2/2, +H/2))
    const fo = new THREE.Group(); fo.position.set(-W2 / 2 + L / 2, H / 2 - L / 2, th / 2 + 0.0009); fo.rotation.z = Math.PI / 4;
    const fi = new THREE.Group(); fo.add(fi); const fm = new THREE.Mesh(flapGeo, flapMat); fi.add(fm); left.add(fo);
    g.visible = false; root.add(g);
    sheets.push({ g, hinge, flap: fi, zk, za, k });
  }
  // cover set
  const edge = new THREE.MeshStandardMaterial({ color: '#2a2833', roughness: 0.55, metalness: 0.3 });
  const coverMat = new THREE.MeshStandardMaterial({ map: texC, roughness: 0.5, metalness: 0.15, emissiveMap: texC, emissive: new THREE.Color('#ffb62e'), emissiveIntensity: 0.12 });
  const backMat = new THREE.MeshStandardMaterial({ color: '#25232e', roughness: 0.55, metalness: 0.2 });
  const bGeo = new THREE.BoxGeometry(W2 + 0.012, H + 0.012, 0.010);
  const front = new THREE.Mesh(bGeo, [edge, edge, edge, edge, coverMat, backMat]); const back = new THREE.Mesh(bGeo, [edge, edge, edge, edge, backMat, backMat]);
  front.visible = back.visible = false; root.add(front, back);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.016, H + 0.012, 0.098), new THREE.MeshStandardMaterial({ color: '#d9411f', roughness: 0.45, metalness: 0.15, clearcoat: 0.5 }));
  spine.position.set(-W2 / 2 - 0.004, 0, 0); spine.visible = false; root.add(spine);
  const brassM = new THREE.MeshStandardMaterial({ color: '#ffc85a', roughness: 0.25, metalness: 0.9, emissive: new THREE.Color('#ff9d1c'), emissiveIntensity: 0.25 });
  const brads = [0.23, 0, -0.23].map((y) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 20), brassM); m.rotation.x = Math.PI / 2; m.position.set(-W2 / 2 + 0.052, y, 0.052); m.visible = false; root.add(m); return m; });
  const tabCols = [PX.vermilion, PX.amber, PX.teal, PX.violet, PX.sky];
  const tabs = tabCols.map((c, i) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.062, 0.009), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.05, emissive: new THREE.Color(c), emissiveIntensity: 0.18 })); m.position.set(W2 / 2, 0.25 - i * 0.125, -0.012 + i * 0.005); m.visible = false; root.add(m); return m; });
  return { root, sheets, front, back, spine, brads, tabs, matL, matR, flapMat, coverMat, brassM, K, W2, H, gap, th };
}

export default {
  id: 'job_script', kind: '3d', ratio: 2.39,
  setup({ THREE, S, renderer }) {
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#040306'); scene.fog = new THREE.FogExp2('#0b0a12', 0.024);
    const stage = createStage(THREE, { THREE, S, renderer }); scene.add(stage.group);
    scene.environment = makeEnv(THREE, renderer, [
      { w: 7, h: 3.5, pos: [-5, 4, 5], color: '#ffd9a0', i: 5 }, { w: 2.2, h: 8, pos: [6, 3, -4], color: '#9fd4ff', i: 3.5 },
      { w: 10, h: 2, pos: [0, 8, 1], color: '#ffffff', i: 1.2 }, { w: 5, h: 2, pos: [3, 0.5, 6], color: '#ffb870', i: 1.0 },
    ]);
    scene.environmentIntensity = 0.5;
    const camera = new THREE.PerspectiveCamera(lensFov(45), 2.39, 0.1, 80);
    const A = createAmrita(THREE); A.root.position.set(...AM); scene.add(A.root);
    A.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    const stylus = makeStylus(THREE); A.root.add(stylus.group); stylus.group.position.set(-0.8, 0.28, 0.4); stylus.group.rotation.z = 0.8;
    const tipHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(THREE, S), color: new THREE.Color(1.0, 0.7, 0.3), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); tipHalo.scale.set(0.5, 0.5, 1); tipHalo.renderOrder = 4; stylus.inner.add(tipHalo); tipHalo.position.copy(stylus.tipPos);

    // ---- set dressing (this set-up: warm "writer's room" — ghost light, string-lights, a distant director's chair)
    stage.chair.position.set(-4.6, 0, -2.4); stage.chair.rotation.y = 0.7;
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ fog: false }), 80);
    { const r = mkRng(5), m = new THREE.Matrix4(), c = new THREE.Color(); let i = 0;
      for (const [zz, yy, sag, n] of [[-6.2, 5.9, 1.9, 26], [-8.0, 5.1, 1.5, 20]]) for (let j = 0; j < n; j++, i++) {
        const u = j / (n - 1), x = lerp(-9, 9, u), y = yy - sag * (1 - (2 * u - 1) ** 2) + r() * 0.06 - 0.1;
        m.makeScale(0.06 + r() * 0.03, 0.06 + r() * 0.03, 0.06); m.setPosition(x, y, zz + r() * 0.2); bulbs.setMatrixAt(i, m);
        const pick = r(); c.set(pick < 0.62 ? '#ffb347' : pick < 0.82 ? '#fff0c8' : pick < 0.93 ? '#ff7a4a' : '#6fd9ff').multiplyScalar(0.9 + r() * 1.0); bulbs.setColorAt(i, c);
      }
      for (let j = 0; j < 14; j++, i++) { const x = lerp(0.6, 7.5, r()), y = 0.12 + r() * 0.5, zz = -5 - r() * 3; m.makeScale(0.07, 0.07, 0.07); m.setPosition(x, y, zz); bulbs.setMatrixAt(i, m); c.set(r() < 0.7 ? '#ff9a3c' : '#ffe0a0').multiplyScalar(0.8 + r() * 0.8); bulbs.setColorAt(i, c); }
      bulbs.count = i; }
    scene.add(bulbs);
    const ghost = new THREE.Group(); ghost.position.set(-3.6, 0, -2.6); scene.add(ghost); // ghost light: tall stand + one bare bulb
    { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, 1.75, 10), new THREE.MeshStandardMaterial({ color: '#15141a', roughness: 0.5, metalness: 0.7 })); pole.position.y = 0.875; ghost.add(pole);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.04, 20), pole.material); base.position.y = 0.02; ghost.add(base);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe2a8').multiplyScalar(5), fog: false })); bulb.position.y = 1.82; ghost.add(bulb); }
    const glowTex = radialTexture(THREE, S);
    const sprite = (col, sx, sy, op = 1) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(...col), transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); m.scale.set(sx, sy, 1); m.renderOrder = 4; return m; };
    const ghostHalo = sprite([1.0, 0.62, 0.22], 2.4, 2.4, 0.55); ghostHalo.position.set(-3.6, 1.82, -2.6); scene.add(ghostHalo);

    // floor light pools (additive decals) + contact shadow under Amrita
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    const pool = (col, sx, sz, x, z) => { const m = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(...col), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.004, z); m.scale.set(sx, sz, 1); m.renderOrder = 3; scene.add(m); return m; };
    const poolWords = pool([1.0, 0.62, 0.2], 6.0, 3.0, -0.6, 0.7), poolAm = pool([1.0, 0.7, 0.34], 3.4, 2.2, AM[0] - 0.1, 0.1), poolBook = pool([1.0, 0.8, 0.45], 2.6, 1.6, REST[0], REST[2]);
    const blob = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({ map: radialTexture(THREE, S, [[0, 'rgba(0,0,0,0.85)'], [0.5, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0)']]), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.set(AM[0] + 0.05, 0.006, AM[2]); blob.scale.set(1.6, 1.1, 1); blob.renderOrder = 2; scene.add(blob);

    // ---- light cones + dust
    const beamKey = makeBeam(THREE, { color: '#ffcf8c', length: 11, radius: 1.2, intensity: 0.15, power: 1.5 }); scene.add(beamKey);
    beamKey.userData.aim(new THREE.Vector3(-4.2, 7.0, 3.4), new THREE.Vector3(-0.1, 1.5, 0.4), 11);
    const beamRim = makeBeam(THREE, { color: '#8fc8ff', length: 12, radius: 1.5, intensity: 0.17, power: 1.6 }); scene.add(beamRim);
    beamRim.userData.aim(new THREE.Vector3(4.6, 6.4, -4.6), new THREE.Vector3(1.0, 0.9, 0), 12);
    const dustA = makeDust(THREE, { count: 340, center: [0, 2.2, 0.5], size: [9, 5, 6], color: '#ffe0a8', psize: 0.02, intensity: 1.2, seed: 3 }); dustA.userData.setBeam(new THREE.Vector3(-4.2, 7.0, 3.4), beamKey.userData.dir, 0.14); scene.add(dustA);
    const dustB = makeDust(THREE, { count: 120, center: [0, 2.0, 0], size: [10, 5, 8], color: '#bcd8ff', psize: 0.016, intensity: 0.5, seed: 4 }); scene.add(dustB);

    // ---- the eight words
    const R_ARC = 5.0, CX = [-0.6, -0.5], LY = [1.9, 1.54], Z0 = 0.1;
    const words = [];
    LINES.forEach((line, li) => {
      const ws = line.map((k) => wordGeometry(THREE, WORDS[k], { size: EM * WSCALE[k], depth: 0.045 * WSCALE[k], bevel: 0.005 }));
      const sp = 0.7 * EM, total = ws.reduce((a, w) => a + w.width, 0) + sp * (line.length - 1);
      let s = -total / 2;
      line.forEach((k, j) => {
        const w = ws[j], sc = s + w.width / 2, th = sc / R_ARC; s += w.width + sp;
        const faceMat = new THREE.MeshStandardMaterial({ color: '#fff0cc', emissive: new THREE.Color('#ffb04a'), emissiveIntensity: 1.2, roughness: 0.4, metalness: 0.1 });
        const sideMat = new THREE.MeshStandardMaterial({ color: '#ffb62e', emissive: new THREE.Color('#ff8a1f'), emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.6 });
        const mesh = new THREE.Mesh(w.geo, [faceMat, sideMat]); mesh.visible = false; scene.add(mesh);
        const base = new THREE.Vector3(CX[li] + R_ARC * Math.sin(th), LY[li] + 0.02 * Math.cos(th * 5 + li), Z0 + R_ARC * (1 - Math.cos(th)));
        const halo = sprite([1.0, 0.6, 0.2], w.width * 1.9, w.height * 3.4, 0); halo.position.copy(base); scene.add(halo);
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 1).translate(0, 0.5, 0), new THREE.ShaderMaterial({
          uniforms: { uO: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
          fragmentShader: 'varying vec2 vUv; uniform float uO; void main(){ float x = abs(vUv.x*2.0-1.0); float a = pow(vUv.y,2.2)*(1.0-x*x)*uO; gl_FragColor = vec4(vec3(1.0,0.78,0.42)*a*3.0, a); }' }));
        bar.visible = false; bar.renderOrder = 8; bar.frustumCulled = false; scene.add(bar);
        words[k] = { mesh, faceMat, sideMat, halo, bar, base, yaw: -th, width: w.width, height: w.height, th };
      });
    });
    const book = buildBooklet(THREE, S); scene.add(book.root);
    const glow = new THREE.PointLight('#ffb25a', 0, 14, 2); scene.add(glow);

    // ---- sparks + rings (all events are known up front: pure function of time)
    const bursts = [], rings = [];
    words.forEach((w, k) => {
      const p = [w.base.x, w.base.y - 0.04, w.base.z + 0.08];
      bursts.push({ t: T0 + KEYS[k], pos: p, n: 18, speed: [0.5, 2.0], life: [0.3, 0.75], dir: [0, 0.7, 0.5], spread: 0.85, size: [0.012, 0.03], color: [2.6, 1.6, 0.55], seed: k + 1 });
      bursts.push({ t: T0 + BELL, pos: [w.base.x, w.base.y + 0.14, w.base.z], n: 14, speed: [0.4, 1.8], life: [0.5, 1.0], dir: [0, 1, 0.3], spread: 0.7, size: [0.014, 0.034], color: [2.6, 1.9, 0.8], seed: 40 + k });
      bursts.push({ t: T0 + 1.04 + 0.012 * k, pos: [w.base.x, w.base.y + 0.14, w.base.z], n: 10, speed: [0.3, 1.2], life: [0.35, 0.7], dir: [0, 0.4, 1], spread: 0.9, size: [0.012, 0.026], color: [2.2, 1.7, 0.9], seed: 80 + k });
      rings.push({ t: T0 + KEYS[k], pos: [w.base.x, w.base.y, w.base.z - 0.02], r0: 0.04, r1: 0.34 * WSCALE[k] + 0.12, dur: 0.2, color: [1.2, 0.7, 0.25] });
    });
    rings.push({ t: T0 + BELL, pos: [-0.9, 1.75, 0.4], r0: 0.2, r1: 2.0, dur: 0.45, color: [1.0, 0.75, 0.4] });
    const ASMV = new THREE.Vector3(...ASM);
    bursts.push({ t: T0 + SNAP, pos: ASM, n: 90, speed: [0.8, 4.2], life: [0.5, 1.2], dir: [0, 0.3, 1], spread: 1, size: [0.014, 0.04], color: [3.0, 2.2, 1.0], seed: 200 });
    rings.push({ t: T0 + SNAP, pos: ASM, r0: 0.1, r1: 1.5, dur: 0.38, color: [1.4, 1.0, 0.5] }, { t: T0 + SNAP + 0.04, pos: ASM, r0: 0.05, r1: 0.9, dur: 0.3, color: [1.0, 1.0, 1.0] });
    for (let i = 0; i < 5; i++) { const u = 0.15 + i * 0.17, p = [lerp(ASM[0], REST[0], u), lerp(ASM[1], REST[1], u) + 0.12 * Math.sin(u * Math.PI), lerp(ASM[2], REST[2], u)]; bursts.push({ t: T0 + SNAP + 0.06 + i * 0.07, pos: p, n: 12, speed: [0.2, 1.1], life: [0.4, 0.9], dir: [0, 0.4, 0], spread: 1, size: [0.01, 0.026], color: [2.6, 2.0, 1.0], seed: 300 + i }); }
    const sparks = makeSparks(THREE, bursts); scene.add(sparks);
    const ringsG = makeRings(THREE, rings); scene.add(ringsG);

    const tmp = { v: new THREE.Vector3(), v2: new THREE.Vector3(), c: new THREE.Color(), q: new THREE.Quaternion(), e: new THREE.Euler() };
    return { scene, camera, stage, A, THREE, stylus, tipHalo, bulbs, words, book, glow, beamKey, beamRim, dustA, dustB, sparks, ringsG, ghostHalo, poolWords, poolAm, poolBook, blob, tmp, ASMV };
  },

  update(st, T, S) {
    const { THREE, camera, A, words, book, tmp, stage } = st;
    const lt = clamp(T.lt, 0, 2), t = T.t, imp = Math.min(1, T.impact), D = globalThis.__dbg || {};
    st.beamKey.visible = st.beamRim.visible = !D.noBeams; st.dustA.visible = st.dustB.visible = !D.noDust; st.bulbs.visible = !D.noBulbs; st.sparks.visible = !D.noSparks;
    const snapP = lt >= SNAP ? Math.exp(-(lt - SNAP) / 0.09) : 0;
    const kIdx = Math.min(7, Math.floor(lt / 0.125)), kAge = Math.max(0, lt - 0.125 * kIdx);
    const typedN = KEYS.reduce((n, k) => n + (lt >= k ? 1 : 0), 0);
    const sp = lt >= 1.52 ? spring(lt - 1.52, 1.5, 0.5) : 0;                       // booklet float-to-rest spring

    // ---------------- booklet root (position/orientation drive the gaze + light too)
    const root = book.root, fl = Math.max(0, lt - 1.52);
    root.position.set(lerp(ASM[0], REST[0], sp), lerp(ASM[1], REST[1], sp) + 0.16 * Math.sin(Math.PI * clamp(fl / 0.34)) + 0.018 * Math.sin(t * 3.1) * sp, lerp(ASM[2], REST[2], sp));
    root.rotation.set(0.06 * sp * Math.sin(t * 2.0), -0.46 * sp, 0.16 * (1 - sp) * (lt >= 1.52 ? 1 : 0) - 0.02 * sp);
    const squashB = lt >= SNAP ? 0.07 * Math.exp(-(lt - SNAP) / 0.07) * Math.cos((lt - SNAP) * 30) : 0;
    const bs = 1 + 0.3 * sp; root.scale.set(bs * (1 + squashB * 0.5), bs * (1 + squashB * 0.5), bs * (1 - squashB * 1.2));

    // ---------------- camera: low-angle 50 mm, slow drift in, snap punch
    const cu = smooth(lt / 2);
    camera.position.set(lerp(-0.3, 0.15, cu) + 0.012 * noise1(t * 0.8, 1) + imp * 0.02 * noise1(t * 53, 7), lerp(0.2, 0.4, cu) + 0.008 * noise1(t * 0.7, 2) + imp * 0.014 * noise1(t * 47, 9), lerp(7.2, 6.5, cu));
    camera.fov = lensFov(45) * (1 - 0.035 * snapP);
    camera.lookAt(tmp.v.set(lerp(0.45, 0.6, cu), lerp(1.2, 1.25, cu), 0));
    camera.updateProjectionMatrix();

    // ---------------- Amrita: types with the words, startles at the bell, tracks the pages, beams at the snap
    const nod = lt < 1.0 ? -0.075 * Math.exp(-kAge / 0.045) : 0;
    const bellB = lt >= BELL ? 0.12 * Math.exp(-(lt - BELL) / 0.1) * Math.cos((lt - BELL) * 26) : 0;
    const snapB = lt >= SNAP ? 0.18 * Math.exp(-(lt - SNAP) / 0.13) * Math.cos((lt - SNAP) * 22) : 0;
    A.pose({ squash: nod + bellB + snapB, yaw: -0.5 + 0.1 * smooth(seg(lt, 1.45, 2.0)) + 0.025 * Math.sin(t * 1.7), roll: 0.02 * Math.sin(t * 1.3), bob: 0.035 * Math.sin(t * 2.4) });
    const gz = tmp.v2;
    if (lt < BELL + 0.05) gz.copy(words[kIdx].base); else if (lt < SNAP) gz.set(...ASM); else gz.copy(root.position);
    const hap = lt >= 1.56 ? 1 : 0;
    A.eyes({ open: 1 - A.blinkAt(T), squint: 0, sleepy: 0, determined: (lt < BELL ? 0.5 : 0) + (lt >= 1.2 && lt < SNAP ? 0.5 : 0), surprised: lt >= BELL && lt < 1.25 ? 0.8 * Math.exp(-(lt - BELL) / 0.12) : 0, happy: hap, lookX: clamp((gz.x - AM[0]) / 2.6, -1, 1), lookY: clamp((gz.y - AM[1]) / 1.4, -1, 1) });
    A.setProp('slate', { t, glow: 0.45 + 0.55 * (lt < BELL ? Math.exp(-kAge / 0.07) : 0.5 + snapP) });

    // stylus taps with each key (tip flash), then idles; tracks to the pages
    { const tapAge = lt < 1.0 ? kAge : 9, tap = Math.exp(-tapAge / 0.045), idle = Math.sin(t * 2.6) * 0.02;
      st.stylus.group.position.set(-0.8, 0.3 + idle - 0.07 * tap, 0.4); st.stylus.group.rotation.z = 0.8 - 0.1 * tap + 0.25 * smooth(seg(lt, 1.0, 1.3)) * (1 - smooth(seg(lt, 1.5, 1.8)));
      st.stylus.tipM.color.setRGB(3.2 + 8 * tap, 2.3 + 5 * tap, 1.2 + 2 * tap); st.tipHalo.material.opacity = 0.35 + 0.65 * tap; st.tipHalo.scale.setScalar(0.4 + 0.5 * tap); }

    // ---------------- the eight words
    for (let k = 0; k < 8; k++) {
      const w = words[k], a = lt - KEYS[k], cv = smooth(seg(lt, 1.03 + 0.012 * k, 1.14 + 0.012 * k));
      const alive = a >= 0 && cv < 0.999;
      w.mesh.visible = alive; w.halo.visible = a >= -0.01 && cv < 0.999;
      if (alive) {
        const pop = spring(a, 5.5, 0.5), slam = 1 - smooth(a / 0.1), lift = 0.15 * outBack(seg(lt, BELL, BELL + 0.12), 2.0), tick = (hash(k, 3) - 0.5) * 0.06 * Math.exp(-a / 0.1);
        w.mesh.position.set(w.base.x, w.base.y + lift, w.base.z + 0.34 * slam); w.mesh.rotation.set(0, w.yaw, tick);
        w.mesh.scale.set(pop * (1 - 0.1 * cv), pop * (1 - 0.96 * cv), pop);
        const fl2 = lt >= BELL ? Math.exp(-(lt - BELL) / 0.09) : 0, e = WHOT[k] * (1.5 + 4.2 * Math.exp(-a / 0.07) + 3.0 * fl2) + 2.5 * cv;
        w.faceMat.emissiveIntensity = e; w.sideMat.emissiveIntensity = e * 0.45;
        w.halo.position.set(w.base.x, w.base.y + lift, w.base.z - 0.12); w.halo.material.opacity = clamp(0.1 * Math.min(1, pop) + 0.6 * Math.exp(-a / 0.09) + 0.3 * fl2, 0, 1);
        const hs = 1 + 0.3 * Math.exp(-a / 0.12); w.halo.scale.set(w.width * 1.9 * hs, w.height * 3.4 * hs, 1);
      }
      // ghost typebar: swings up from below, strikes at KEYS[k], rebounds + fades
      let phi = 0, op = 0;
      if (a >= -0.075 && a < 0) { const u = 1 + a / 0.075; phi = -0.6 * (1 - u * u); op = 0.35 + 0.65 * u; }
      else if (a >= 0 && a < 0.22) { phi = 0.16 * (1 - Math.exp(-a / 0.05)); op = Math.exp(-a / 0.055); }
      w.bar.visible = op > 0.01;
      if (w.bar.visible) {
        w.bar.position.set(w.base.x, w.base.y - 0.66, w.base.z + 0.1); w.bar.quaternion.copy(camera.quaternion); w.bar.rotateZ(phi); w.bar.scale.set(1, 0.66, 1); w.bar.material.uniforms.uO.value = op;
      }
    }

    // ---------------- pages: form from the words, fly, crease, fold
    const K = book.K, W2 = book.W2, H = book.H;
    for (let k = 0; k < K; k++) {
      const sh = book.sheets[k], wk = words[k], t0 = 1.04 + 0.006 * k;
      sh.g.visible = lt >= t0;
      if (!sh.g.visible) continue;
      const fs = 1.03 + 0.012 * k, u = smoother(seg(lt, fs, fs + 0.16)), sg = k % 2 ? 1 : -1;
      const p0x = wk.base.x - ASM[0], p0y = wk.base.y + 0.15 - ASM[1], p0z = wk.base.z - ASM[2], p3x = -W2 / 2, p3y = 0, p3z = sh.zk;
      const p1x = p0x + sg * 0.25, p1y = p0y + 0.45, p1z = p0z + 0.35, p2x = p3x - sg * 0.5, p2y = p3y + 0.2, p2z = p3z + 0.7;
      const v = 1 - u, b0 = v * v * v, b1 = 3 * v * v * u, b2 = 3 * v * u * u, b3 = u * u * u;
      sh.g.position.set(b0 * p0x + b1 * p1x + b2 * p2x + b3 * p3x, b0 * p0y + b1 * p1y + b2 * p2y + b3 * p3y, b0 * p0z + b1 * p1z + b2 * p2z + b3 * p3z);
      sh.g.rotation.set(-0.7 * Math.sin(k * 1.9 + 1) * v * v, wk.yaw * v, sg * 1.0 * v * v);
      const sx0 = (wk.width / (2 * W2)) * 0.96, sy0 = 0.07 / H;
      const msz = lerp(0.7, 1, smooth(seg(u, 0.6, 1)));
      sh.g.scale.set(lerp(sx0, 1, smooth(seg(u, 0, 0.6))) * msz, lerp(sy0, 1, smooth(seg(u, 0.05, 0.75))) * msz, 1);
      sh.flap.rotation.x = Math.PI * smooth(seg(u, 0.35, 0.95));
      const tf = FOLD0 + (K - 1 - k) * 0.009; sh.hinge.rotation.y = Math.PI * smoother(seg(lt, tf, tf + 0.11));
    }
    const pe = (lt < SNAP ? 0.3 : 0.1 + 0.3 * (1 - seg(lt, 1.52, 1.95))) + 0.6 * snapP;
    book.matL.emissiveIntensity = book.matR.emissiveIntensity = book.flapMat.emissiveIntensity = pe;
    book.coverMat.emissiveIntensity = 0.12 + 0.9 * snapP;
    // boards slam in, spine/brads/tabs snap on at 27.5
    const ub = seg(lt, 1.33, SNAP), eb = ub ** 2.4, ib = 1 - eb;
    book.front.visible = book.back.visible = lt >= 1.33;
    book.front.position.set(0.42 * ib, 0.5 * ib, 0.0436 + 0.95 * ib); book.front.rotation.set(0.5 * ib, 0.3 * ib, 0.5 * ib);
    book.back.position.set(-0.38 * ib, -0.45 * ib, -0.0436 - 0.7 * ib); book.back.rotation.set(-0.3 * ib, 0, -0.4 * ib);
    book.spine.visible = lt >= SNAP; book.spine.scale.set(1, 1, Math.max(0.01, spring(lt - SNAP, 6, 0.5)));
    book.brads.forEach((m, j) => { const s = spring(lt - (SNAP + 0.03 * j), 7, 0.4); m.visible = lt >= SNAP + 0.03 * j; m.scale.setScalar(Math.max(0.01, s)); });
    book.tabs.forEach((m, i) => { const s = spring(lt - (SNAP + 0.05 + 0.045 * i), 6, 0.45); m.visible = lt >= SNAP + 0.05 + 0.045 * i; m.position.x = W2 / 2 - 0.03 + 0.075 * s; });

    // ---------------- lights
    const L = stage.lights;
    L.key.color.set('#ffd7a0'); L.key.intensity = 230; L.key.position.set(-4.2, 6.5, 4.4); L.key.target.position.set(1.1, 0.9, 0.2); L.key.angle = 0.42; L.key.penumbra = 0.7;
    L.rim.color.set('#9cc8ff'); L.rim.intensity = 520; L.rim.position.set(4.6, 6.4, -4.6); L.rim.target.position.set(1.0, 0.9, 0); L.rim.angle = 0.38; L.rim.penumbra = 0.8;
    L.fill.color.set('#6a86c8'); L.fill.intensity = 6; L.amb.intensity = 0.1;
    const gl = st.glow;
    if (lt < 1.1) gl.position.set(-0.8, 1.9, 1.6); else gl.position.copy(root.position).add(tmp.v.set(-0.6, 0.4, 1.6));
    gl.intensity = (lt < BELL ? 4 * (0.3 + 0.7 * typedN / 8) * (1 + Math.exp(-kAge / 0.06)) : 4) + (lt >= BELL ? 8 * Math.exp(-(lt - BELL) / 0.12) : 0) + 12 * snapP;
    st.poolWords.material.opacity = 0.2 * (typedN / 8) * (1 - seg(lt, 1.1, 1.4)); st.poolAm.material.opacity = 0.2 + 0.1 * snapP; st.poolBook.material.opacity = 0.24 * sp;
    st.ghostHalo.material.opacity = 0.5 + 0.08 * Math.sin(t * 3.1);
    st.blob.position.x = A.root.position.x + 0.05;

    // ---------------- uniforms
    const px = pxPerUnit(S, camera.fov);
    st.sparks.material.uniforms.uTime.value = t; st.sparks.material.uniforms.uPx.value = px;
    for (const d of [st.dustA, st.dustB]) { d.material.uniforms.uTime.value = t; d.material.uniforms.uPx.value = px; }
    st.beamKey.material.uniforms.uTime.value = t; st.beamRim.material.uniforms.uTime.value = t;
    st.ringsG.userData.update(t, camera);

    // ---------------- DOF: focus rides from Amrita to the folding pages and back to Amrita + booklet
    const f = smooth(seg(lt, 1.05, 1.25)) * (1 - smooth(seg(lt, 1.52, 1.85)));
    const fx = lerp(AM[0], ASM[0], f), fy = lerp(AM[1], ASM[1], f), fz = lerp(AM[2], ASM[2], f);
    if (D.noDof) return { dof: { enabled: false }, bloom: { strength: D.noBloom ? 0 : 0.34, radius: 0.5, threshold: 1.15 } };
    return { dof: { focus: camera.position.distanceTo(tmp.v.set(fx, fy, fz)), strength: 0.9, maxPx: 13, bokeh: 1.4 }, bloom: { strength: D.noBloom ? 0 : 0.34 + 0.22 * imp + 0.45 * snapP, radius: 0.5, threshold: 1.15 } };
  },
};
