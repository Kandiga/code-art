// tiny test harness shared by the lib tests (no dependencies)
import fs from 'node:fs';
import path from 'node:path';
import { TMP } from '../paths.mjs';
export const OUTDIR = path.join(TMP, 'libtest');
fs.mkdirSync(OUTDIR, { recursive: true });
let pass = 0, fail = 0;
const lines = [];
export function check(name, cond, detail = '') {
  if (cond) pass++; else fail++;
  const s = `${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`;
  lines.push(s);
  console.log(s);
  return cond;
}
export function section(t) { console.log(`\n== ${t}`); }
export function summary(label) {
  console.log(`\n${label}: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
  return { pass, fail };
}
export const timeIt = (label, fn) => {
  const t = process.hrtime.bigint();
  const r = fn();
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  console.log(`   [${label}] ${ms.toFixed(0)} ms`);
  return { r, ms };
};
export const f1 = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : String(v));
