// F97 runner: 4 jobs x 3 drafts through the REAL `fwdloop draft` (scratch copy), deepseek-flash. Key from env (set by the caller), never printed.
// Usage: node f97.mjs <scratch-repo> <work-dir> ; aborts when cumulative spend passes $0.10 (incl. SPENT_BEFORE already spent by 4 accidental smoke drafts).
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const [repo, work] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const SPENT_BEFORE = 0.0114; // the 4 smoke drafts (see FINDINGS F97 pre-registration)
const LIMIT = 0.10;
let spent = SPENT_BEFORE;
mkdirSync(work, { recursive: true });
for (const job of ['a', 'b', 'c', 'd']) {
  for (const n of [1, 2, 3]) {
    if (spent > LIMIT) { console.log('ABORT: spend guard', spent); process.exit(2); }
    const out = join(work, `draft-${job}${n}`);
    const r = spawnSync('node', [join(repo, 'bin/fwdloop'), 'draft', join(here, 'jobs', `j-${job}.txt`), '--out', out, '--root', join(work, 'root'), '--name', `f97-${job}${n}`, '--model', 'deepseek-flash'], { env: process.env, encoding: 'utf8', timeout: 300000 });
    appendFileSync(join(work, 'cli-out.txt'), `=== ${job}${n} exit ${r.status}\n${r.stdout}${r.stderr}\n`);
    const sp = join(out, 'draft-spend.json');
    const c = existsSync(sp) ? JSON.parse(readFileSync(sp, 'utf8')).cost : null;
    if (typeof c === 'number') spent += c;
    console.log(job + n, 'exit', r.status, 'cost', c, 'cum', spent.toFixed(4));
  }
}
