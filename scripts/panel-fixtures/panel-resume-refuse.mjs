// Stand-in for `bin/fwdloop` that refuses like a resume that is NOT the lock
// refusal (signature changed while parked). Appends one line to the file named
// by SPAWN_COUNT_FILE each time it is started, so a test can count spawns.
import { appendFileSync } from 'node:fs';

if (process.env.SPAWN_COUNT_FILE) appendFileSync(process.env.SPAWN_COUNT_FILE, `${process.argv.slice(2).join(' ')}\n`);
process.stderr.write('fwdloop: refused — resume: signature mismatch for run "run-1" — the flow changed while parked\n');
process.exit(1);
