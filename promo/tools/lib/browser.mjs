// Shared headless-Chromium launcher with a cross-process semaphore (max N concurrent browsers machine-wide),
// so many agents rendering stills at once cannot starve the 4 cores.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

export const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const GL_ARGS = [
  '--headless=new', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-webgl', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
];
const SEM_DIR = '/tmp/amrita_sem';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

export async function acquire(max = Number(process.env.AMRITA_MAX_BROWSERS || 3)) {
  fs.mkdirSync(SEM_DIR, { recursive: true });
  for (let spin = 0; ; spin++) {
    for (let i = 0; i < max; i++) {
      const d = `${SEM_DIR}/slot${i}`;
      try { fs.mkdirSync(d); fs.writeFileSync(`${d}/pid`, String(process.pid)); return d; } catch {
        try { const pid = Number(fs.readFileSync(`${d}/pid`, 'utf8')); if (!alive(pid)) fs.rmSync(d, { recursive: true, force: true }); } catch { /* racing */ }
      }
    }
    await sleep(400 + (spin % 5) * 100);
  }
}
export function release(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ok */ } }

export async function launch({ slot = true } = {}) {
  const sem = slot ? await acquire() : null;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: GL_ARGS });
  const close = browser.close.bind(browser);
  browser.close = async () => { try { await close(); } finally { if (sem) release(sem); } };
  process.on('exit', () => { if (sem) release(sem); });
  return browser;
}
