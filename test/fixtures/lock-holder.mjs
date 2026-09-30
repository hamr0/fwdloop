// Test helper (not a test): a REAL live process whose command line is `node <dir>/fwdloop`, so
// `isFwdloopAlive` says true for it, plus the resume.lock text naming it (M4c amendment 2 (d)).
// `kill()` SIGKILLs it: the lock then names a dead holder. $0, no network.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { procStartOf } from '../../src/liveness.js';

/** @param {string} dir a scratch dir the test owns (the script is written inside it) */
export async function spawnHolder(dir) {
  mkdirSync(dir, { recursive: true });
  const script = path.join(dir, 'fwdloop');
  writeFileSync(script, 'setInterval(() => {}, 1e6);\n');
  const child = spawn(process.execPath, [script], { stdio: 'ignore' });
  let procStart = null;
  for (let i = 0; i < 100 && procStart === null; i += 1) {
    procStart = procStartOf(child.pid);
    // eslint-disable-next-line no-await-in-loop
    if (procStart === null) await new Promise((r) => { setTimeout(r, 20); });
  }
  if (procStart === null) throw new Error('holder process has no /proc start time');
  // the script must be running before a test asks whether it is alive
  await new Promise((r) => { setTimeout(r, 100); });
  return {
    pid: child.pid,
    procStart,
    lockText: JSON.stringify({ pid: child.pid, procStart }),
    /** SIGKILL and wait for the process to be gone (a second call is a no-op). */
    async kill() {
      if (child.exitCode !== null || child.signalCode !== null) return; // already gone
      const gone = new Promise((r) => { child.once('exit', r); });
      child.kill('SIGKILL');
      await gone;
    },
  };
}
