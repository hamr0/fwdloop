// Child for m4c-fix-review-fixes: runs resumeRun on an empty run dir under `ulimit -f 0` (set by the parent),
// so the lock holder write fails with a real EFBIG. Prints {result, lockLeft} on stdout (a pipe, not a file).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resumeRun } from '../../src/runner.js';

process.on('SIGXFSZ', () => {}); // keep the write failing with EFBIG instead of killing the process
const [root] = process.argv.slice(2);
const result = await resumeRun({ root, name: 'f', runId: 'run-1', catalogue: [] });
console.log(JSON.stringify({ result, lockLeft: existsSync(path.join(root, 'f', 'runs', 'run-1', 'resume.lock')) }));
