// Stand-in for `bin/fwdloop` in the key-hygiene test (M4c-fix item 22c): a CLEAN resume (exit 0) that
// misbehaves by echoing the provider key from its environment to stdout AND stderr. It writes
// "echoed" to the file named by ECHOED_FILE once both writes are flushed, then stays alive until
// RELEASE_FILE exists (or 20 s) so the test can scan the log while it still exists, and exits 0.
// It never touches a book or a provider.
import { existsSync, writeFileSync } from 'node:fs';

const key = process.env.DEEPSEEK_API_KEY ?? '';
process.stdout.write(`key=${key}\n`);
process.stderr.write(`key=${key}\n`, () => writeFileSync(process.env.ECHOED_FILE, 'echoed'));
const t0 = Date.now();
setInterval(() => {
  if (existsSync(process.env.RELEASE_FILE) || Date.now() - t0 > 20000) process.exit(0);
}, 20);
