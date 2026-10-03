// Stand-in for `bin/fwdloop` in the one-resume-at-a-time tests (M4c-fix items 1 and 7): a resume that
// stays alive. Appends one line to SPAWN_COUNT_FILE per start. The FIRST start writes "first-reason" to
// stderr and stays alive until RELEASE_FILE exists (or 20 s); later starts exit 0 at once unless
// SLEEP_ALL=1, in which case every start stays alive. It never touches a book, a key or a provider.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

appendFileSync(process.env.SPAWN_COUNT_FILE, `${process.argv.slice(2).join(' ')}\n`);
const n = readFileSync(process.env.SPAWN_COUNT_FILE, 'utf8').trim().split('\n').length;
if (n > 1 && process.env.SLEEP_ALL !== '1') process.exit(0);
process.stderr.write('first-reason\n');
const t0 = Date.now();
setInterval(() => {
  if (existsSync(process.env.RELEASE_FILE) || Date.now() - t0 > 20000) process.exit(0);
}, 20);
