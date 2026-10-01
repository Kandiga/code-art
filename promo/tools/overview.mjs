// overview.mjs — contact sheets of a rendered video.
//   node tools/overview.mjs --video out/x.mp4 --every 2 --cols 6 --w 480 --out out/stills/overview.png [--start 0 --dur 60] [--label]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const every = Number(args.every ?? 2), cols = Number(args.cols ?? 6), w = Number(args.w ?? 480), start = Number(args.start ?? 0), dur = Number(args.dur ?? 60 - start);
const n = Math.floor(dur / every), rows = Math.ceil(n / cols), out = path.resolve(ROOT, args.out || 'out/stills/overview.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
const label = `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf:text='%{expr\\:trunc(${start}+n*${every}*1)}s':x=6:y=h-th-6:fontsize=${Math.round(w / 22)}:fontcolor=white:box=1:boxcolor=black@0.6`;
const vf = `fps=1/${every},scale=${w}:-1${args.label === false ? '' : ',' + label},tile=${cols}x${rows}:padding=3:color=0x222222`;
const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(start), '-t', String(dur), '-i', path.resolve(ROOT, args.video), '-vf', vf, '-frames:v', '1', out], { stdio: 'inherit' });
console.log(r.status === 0 ? 'OVERVIEW ' + out : 'failed');
