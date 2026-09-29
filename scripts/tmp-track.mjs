// Test/POC scratch dirs: mkdtempSync that removes what it made when the
// process exits, so test runs never leave dirs in os.tmpdir() (tmpfs inodes).
// A POC that must KEEP its output must not use this.
import { mkdtempSync as mk, rmSync } from 'node:fs';

const made = [];
process.on('exit', () => {
  for (const d of made) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort at exit */ }
  }
});

export function mkdtempSync(prefix) {
  const d = mk(prefix);
  made.push(d);
  return d;
}
