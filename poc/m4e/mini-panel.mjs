// Tiny POC "panel": spawns ONE `bin/fwdloop` child exactly like src/panel/resume.js tryOnce does
// (detached, own process group, stdio -> a log file, array argv, no shell, unref), records the pid, then idles
// until the orchestrator SIGKILLs it. Config comes as one JSON argv: { args, logPath, pidFile, env, merge }.
//   merge:true  -> the child env is keysForDoor()'s MERGED env (shell + keys file), like createResumer's loadEnv.
//   merge:false -> the child env is the panel's own env as is (the keys file is NOT merged in).
import { spawn } from 'node:child_process';
import { closeSync, openSync, writeFileSync } from 'node:fs';
import { keysForDoor } from '../../src/keysfile.js';
import { procStartOf } from '../../src/liveness.js';
import { BIN } from './common.mjs';

const cfg = JSON.parse(process.argv[2]);
let env = { ...process.env, ...(cfg.env ?? {}) };
if (cfg.merge) {
  const loaded = keysForDoor({ env });
  if (!loaded.ok) { process.stderr.write(`panel: keys refusal: ${loaded.refusal}\n`); process.exit(2); }
  env = loaded.env; // ONE object: spawn env
}
const fd = openSync(cfg.logPath, 'a', 0o600);
const child = spawn(process.execPath, [BIN, ...cfg.args], { detached: true, stdio: ['ignore', fd, fd], env });
child.unref();
closeSync(fd);
writeFileSync(cfg.pidFile, JSON.stringify({ pid: child.pid, procStart: procStartOf(child.pid), panelPid: process.pid }));
process.stdout.write(`SPAWNED ${child.pid}\n`);
setInterval(() => {}, 1000); // the panel stays up until killed
