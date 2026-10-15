import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** every file under dir (relative path -> sha256), skipping the named top-level entries */
export function snapshotDir(dir, skip = [], rel = '') {
  const out = {};
  for (const n of readdirSync(path.join(dir, rel)).sort()) {
    const r = path.join(rel, n);
    if (!rel && skip.includes(n)) continue;
    if (statSync(path.join(dir, r)).isDirectory()) Object.assign(out, snapshotDir(dir, skip, r));
    else out[r] = createHash('sha256').update(readFileSync(path.join(dir, r))).digest('hex');
  }
  return out;
}
