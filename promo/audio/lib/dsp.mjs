// =============================================================================
// dsp.mjs - THE import for audio code:  import * as dsp from '../lib/dsp.mjs'
// Re-exports the whole foundation (core, gen, filt, fx, verb, dyn). Implementation lives in the sibling
// modules so each file stays readable; the names below are the public API (see audio/README.md).
// meter.mjs / ff.mjs / theory.mjs are separate imports (they need ffmpeg / cues).
// =============================================================================
export * from './core.mjs';
export * from './gen.mjs';
export * from './filt.mjs';
export * from './fx.mjs';
export * from './verb.mjs';
export * from './dyn.mjs';
