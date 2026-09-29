#!/usr/bin/env node
// Runs the full `npm test` with TMPDIR pointed at a fresh empty dir, then
// asserts nothing is left behind. Exit 1 (and lists the leftovers) if any.
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'fwdloop-tmpclean-'));
const scratch = join(base, 'scratch');
mkdirSync(scratch);
{
  const r = spawnSync('npm', ['test'], {
    env: { ...process.env, TMPDIR: scratch }, stdio: ['ignore', 'ignore', 'inherit'],
  });
  const left = readdirSync(scratch).filter((n) => n !== 'node-compile-cache'); // node's own cache, not ours
  console.log(`npm test exit=${r.status}; leftover entries in TMPDIR: ${left.length}`);
  for (const n of left.slice(0, 20)) console.log('  ' + n);
  rmSync(base, { recursive: true, force: true });
  process.exit(r.status === 0 && left.length === 0 ? 0 : 1);
}
