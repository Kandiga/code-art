// mux.mjs — mux the rendered video with the mastered audio: H.264 (copied) + AAC 256k, exactly 60.0 s.
//   node tools/mux.mjs --video out/amrita_video_1080p.mp4 --audio out/audio_master.wav --out out/amrita_promo_60s_1080p.mp4
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1]]); return a; }, []));
const v = path.resolve(ROOT, args.video), a = path.resolve(ROOT, args.audio), o = path.resolve(ROOT, args.out);
const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', v, '-i', a, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2', '-af', 'apad=whole_dur=60,atrim=0:60', '-t', '60', '-movflags', '+faststart', o], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status);
const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate:stream=codec_name,width,height,sample_rate,channels', '-of', 'default=nw=1', o], { encoding: 'utf8' });
console.log(p.stdout);
