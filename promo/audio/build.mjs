#!/usr/bin/env node
// =============================================================================
// audio/build.mjs - audio build orchestrator.
//
//   node audio/build.mjs                  all stages: music sfx vo crowd mix
//   node audio/build.mjs music sfx        only those stages (order is always music, sfx, vo, crowd, mix)
//   node audio/build.mjs mix              only the final mix/master
//   node audio/build.mjs --par            run music/sfx/vo/crowd in parallel child processes (--jobs N, default 2)
//   node audio/build.mjs --verify         print duration / peak / loudness of every existing stem + the master
//   node audio/build.mjs --list           show stages and whether their module exists
//
// Each stage is optional and dynamically imported:
//   audio/music/render.mjs   export async function renderMusic()  -> audio/build/stems/music.wav
//   audio/sfx/render.mjs     export async function renderSfx()    -> audio/build/stems/sfx.wav
//   audio/vo/render.mjs      export async function renderVo()     -> audio/build/stems/vo.wav + vo_lines.json
//   audio/crowd/render.mjs   export async function renderCrowd()  -> audio/build/stems/crowd.wav
//   audio/mix.mjs            export async function mix()          -> out/audio_master.wav
// A missing module is skipped with a notice; a failing stage is reported and (unless --force) blocks the mix.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AUDIO, ROOT, STEMS, OUT, ensure } from './lib/paths.mjs';

const STAGES = [
  { id: 'music', file: 'music/render.mjs', fn: 'renderMusic', outs: [path.join(STEMS, 'music.wav')] },
  { id: 'sfx', file: 'sfx/render.mjs', fn: 'renderSfx', outs: [path.join(STEMS, 'sfx.wav')] },
  { id: 'vo', file: 'vo/render.mjs', fn: 'renderVo', outs: [path.join(STEMS, 'vo.wav'), path.join(STEMS, 'vo_lines.json')] },
  { id: 'crowd', file: 'crowd/render.mjs', fn: 'renderCrowd', outs: [path.join(STEMS, 'crowd.wav')] },
  { id: 'mix', file: 'mix.mjs', fn: 'mix', outs: [path.join(OUT, 'audio_master.wav')] },
];

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const jobsArg = argv.findIndex((a) => a === '--jobs');
const JOBS = jobsArg >= 0 ? Math.max(1, parseInt(argv[jobsArg + 1], 10) || 2) : 2;
const asked = argv.filter((a) => !a.startsWith('--') && STAGES.some((s) => s.id === a));
const unknown = argv.filter((a) => !a.startsWith('--') && !STAGES.some((s) => s.id === a) && !(jobsArg >= 0 && a === argv[jobsArg + 1]));
const wanted = asked.length ? STAGES.filter((s) => asked.includes(s.id)) : STAGES;

const rel = (p) => path.relative(ROOT, p);
const secs = (ms) => (ms / 1000).toFixed(2) + ' s';
const exists = (s) => fs.existsSync(path.join(AUDIO, s.file));

function stemInfo(file) {
  // fast header-only duration + sampled peak for the summary line
  try {
    const st = fs.statSync(file);
    if (!file.endsWith('.wav')) return `${(st.size / 1024).toFixed(1)} KB`;
    const fd = fs.openSync(file, 'r');
    const hdr = Buffer.alloc(64);
    fs.readSync(fd, hdr, 0, 64, 0);
    fs.closeSync(fd);
    const rate = hdr.readUInt32LE(24), ch = hdr.readUInt16LE(22), bits = hdr.readUInt16LE(34);
    const dur = (st.size - 44) / (rate * ch * (bits / 8));
    return `${dur.toFixed(2)} s, ${rate / 1000} kHz, ${ch} ch, ${bits}-bit, ${(st.size / 1048576).toFixed(1)} MB`;
  } catch (e) {
    return `unreadable (${e.message})`;
  }
}

async function runStage(s) {
  const file = path.join(AUDIO, s.file);
  if (!fs.existsSync(file)) {
    console.log(`[${s.id}] SKIP  ${rel(file)} not found`);
    return { id: s.id, status: 'skipped', ms: 0 };
  }
  const t0 = process.hrtime.bigint();
  try {
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod[s.fn] !== 'function') throw new Error(`${rel(file)} does not export ${s.fn}()`);
    console.log(`[${s.id}] start ${rel(file)}`);
    const r = await mod[s.fn]({ stage: s.id });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const missing = s.outs.filter((o) => !fs.existsSync(o));
    if (missing.length) console.log(`[${s.id}] WARN  expected output missing: ${missing.map(rel).join(', ')}`);
    for (const o of s.outs) if (fs.existsSync(o)) console.log(`[${s.id}]   ${rel(o)}: ${stemInfo(o)}`);
    console.log(`[${s.id}] done  ${secs(ms)}${typeof r === 'string' ? '  -> ' + r : ''}`);
    return { id: s.id, status: missing.length ? 'warn' : 'ok', ms };
  } catch (e) {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.error(`[${s.id}] FAIL  after ${secs(ms)}: ${e && e.stack ? e.stack : e}`);
    return { id: s.id, status: 'failed', ms };
  }
}

function runChild(s) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const args = [fileURLToPath(import.meta.url), s.id, '--child'];
    const cmd = fs.existsSync('/usr/bin/nice') ? '/usr/bin/nice' : process.execPath;
    const full = cmd === process.execPath ? args : ['-n', '10', process.execPath, ...args];
    const p = spawn(cmd, full, { stdio: ['ignore', 'pipe', 'pipe'] });
    const prefix = (d) => String(d).split('\n').filter(Boolean).map((l) => `  | ${l}`).join('\n');
    p.stdout.on('data', (d) => console.log(prefix(d)));
    p.stderr.on('data', (d) => console.error(prefix(d)));
    p.on('close', (code) => resolve({ id: s.id, status: code === 0 ? 'ok' : 'failed', ms: Number(process.hrtime.bigint() - t0) / 1e6 }));
  });
}

async function verify() {
  const { readWav } = await import('./lib/core.mjs');
  const { measure, formatReport } = await import('./lib/meter.mjs');
  const files = [...STAGES.flatMap((s) => s.outs), path.join(OUT, 'audio_master.wav')].filter((f, i, a) => f.endsWith('.wav') && a.indexOf(f) === i);
  for (const f of files) {
    if (!fs.existsSync(f)) { console.log(`- ${rel(f)}: (missing)`); continue; }
    const b = readWav(f);
    console.log(`\n${rel(f)}  (${stemInfo(f)})\n${formatReport(measure(b)).split('\n').map((l) => '   ' + l).join('\n')}`);
  }
}

async function main() {
  if (flags.has('--help') || flags.has('-h')) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(1, 22).map((l) => l.slice(3)).join('\n'));
    return;
  }
  if (unknown.length) { console.error(`unknown argument(s): ${unknown.join(' ')}  (stages: ${STAGES.map((s) => s.id).join(' ')})`); process.exit(2); }
  ensure(STEMS);
  ensure(OUT);
  if (flags.has('--list')) {
    for (const s of STAGES) console.log(`${s.id.padEnd(6)} ${exists(s) ? 'present' : 'missing'}  ${s.file}  ->  ${s.outs.map(rel).join(', ')}`);
    return;
  }
  if (flags.has('--verify')) return verify();

  const T0 = process.hrtime.bigint();
  const results = [];
  const sources = wanted.filter((s) => s.id !== 'mix');
  const wantMix = wanted.some((s) => s.id === 'mix');

  if (flags.has('--par') && sources.length > 1 && !flags.has('--child')) {
    console.log(`running ${sources.map((s) => s.id).join(' ')} in parallel (jobs=${JOBS}, niced)`);
    const queue = [...sources];
    const worker = async () => { while (queue.length) { const s = queue.shift(); if (!exists(s)) { console.log(`[${s.id}] SKIP  ${s.file} not found`); results.push({ id: s.id, status: 'skipped', ms: 0 }); continue; } results.push(await runChild(s)); } };
    await Promise.all(Array.from({ length: Math.min(JOBS, sources.length) }, worker));
  } else {
    for (const s of sources) results.push(await runStage(s));
  }
  if (wantMix) {
    const bad = results.filter((r) => r.status === 'failed');
    if (bad.length && !flags.has('--force')) {
      console.error(`[mix] SKIP  stage(s) failed: ${bad.map((r) => r.id).join(', ')} (use --force to mix anyway)`);
      results.push({ id: 'mix', status: 'skipped', ms: 0 });
    } else results.push(await runStage(STAGES.find((s) => s.id === 'mix')));
  }

  if (!flags.has('--child')) {
    console.log('\n== timings');
    for (const r of results) console.log(`  ${r.id.padEnd(6)} ${r.status.padEnd(8)} ${r.status === 'skipped' ? '' : secs(r.ms)}`);
    console.log(`  total  ${secs(Number(process.hrtime.bigint() - T0) / 1e6)}`);
  }
  if (results.some((r) => r.status === 'failed')) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
