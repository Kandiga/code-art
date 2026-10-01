// =============================================================================
// audio/vo/render.mjs - renders the narration + the diegetic 1927 "Hello!".
//
//   import { renderVo } from './vo/render.mjs';
//   const { stem, lines } = await renderVo({ asr: false });     // from audio/build.mjs
//
//   node audio/vo/render.mjs [--no-asr] [--only vo1,vo3b] [--no-cache]
//
// Writes  audio/build/stems/vo.wav   (60 s stereo float32, onset of every line == cues.js t0)
//         audio/build/vo/<id>.wav    (per-line, sample 0 == first sample above -40 dBFS)
//         audio/build/vo_lines.json  ([{id,text,t0,onset,end,maxEnd,peakDb,lufs,rmsDb,diegetic?,...}])
// Everything is timed from shared/cues.js (read by process.py through node). Voice synthesis is seeded
// Piper (bit-exact), dry takes are cached in audio/vo/raw/, so a re-render is deterministic.
// Needs audio/vo/.venv (run audio/vo/setup.sh once) and the voice models in audio/vo/models/.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PY } from './piper.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BUILD = path.resolve(HERE, '..', 'build');

function run(args, label) {
  return new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', '10', PY, ...args], { cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => {
      out += d;
      process.stdout.write(d);
    });
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${label} failed (${code})\n${err.slice(-3000)}`))));
  });
}

/**
 * @param {{asr?: boolean, only?: string[], noCache?: boolean, build?: string}} [opts]
 * @returns {Promise<{stem: string, lines: object[], linesFile: string}>}
 */
export async function renderVo(opts = {}) {
  const build = opts.build ? path.resolve(opts.build) : BUILD;
  if (!fs.existsSync(PY)) throw new Error('audio/vo/.venv missing - run audio/vo/setup.sh');
  const args = ['process.py', '--out', build];
  if (opts.only?.length) args.push('--only', opts.only.join(','));
  if (opts.noCache) args.push('--no-cache');
  await run(args, 'vo/process.py');
  if (!opts.only?.length) {
    // contract checks always run (cheap); ASR only on request (needs Whisper models, ~1 min)
    const v = ['verify.py', '--build', build];
    if (!opts.asr) v.push('--no-asr');
    try {
      await run(v, 'vo/verify.py');
    } catch (e) {
      console.warn('[vo] verify reported problems:\n' + e.message.split('\n').slice(0, 6).join('\n'));
    }
  }
  const linesFile = path.join(build, 'vo_lines.json');
  // audio/build.mjs looks for the manifest next to the stems: keep both copies identical
  if (fs.existsSync(linesFile) && !opts.only?.length) fs.copyFileSync(linesFile, path.join(build, 'stems', 'vo_lines.json'));
  const lines = fs.existsSync(linesFile) ? JSON.parse(fs.readFileSync(linesFile, 'utf8')) : [];
  return { stem: path.join(build, 'stems', 'vo.wav'), lines, linesFile };
}

export default renderVo;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const only = a.includes('--only') ? a[a.indexOf('--only') + 1].split(',') : [];
  renderVo({ asr: !a.includes('--no-asr'), only, noCache: a.includes('--no-cache') })
    .then((r) => console.log(`[vo] ${r.lines.length} lines -> ${r.stem}`))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
