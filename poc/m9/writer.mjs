// Child: append `chunks` chunks of 4096 bytes every `ms` ms; print the last-write time.
import fs from 'node:fs';
const [file, chunks, ms] = [process.argv[2], +process.argv[3], +process.argv[4]];
let i = 0;
(function next() {
  fs.appendFileSync(file, String(i).padStart(4, '0') + 'x'.repeat(4091) + '\n');
  if (++i >= chunks) { process.stdout.write(`lastWrite ${Date.now()}\n`); return; }
  setTimeout(next, ms);
})();
