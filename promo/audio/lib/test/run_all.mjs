// Runs every lib test in sequence (niced by the caller if desired). node audio/lib/test/run_all.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
for (const t of ['test_theory', 'test_meter', 'test_dsp', 'test_determinism']) {
  const r = spawnSync(process.execPath, [path.join(here, t + '.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} test file(s) FAILED` : '\nALL LIB TESTS PASSED');
process.exit(failed ? 1 : 0);
