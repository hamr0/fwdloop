// A FRESH process that knows only paths. Reads files + isFwdloopAlive/runLiveness, prints JSON.
// usage: node reattach.mjs <runDir> [pidFile]
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runLiveness, isFwdloopAlive, readResumeLock } from '../../src/liveness.js';

const [runDir, pidFile] = process.argv.slice(2);
const j = (f) => { try { return JSON.parse(readFileSync(join(runDir, f), 'utf8')); } catch { return null; } };
const out = {
  runLiveness: runLiveness(runDir),
  pidsJsonl: existsSync(join(runDir, 'pids.jsonl')) ? readFileSync(join(runDir, 'pids.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : null,
  state: j('state.json'),
  askJson: j('ask.json'),
  files: readdirSync(runDir).sort(),
  lock: readResumeLock(runDir).state,
};
if (pidFile) { const p = j.call(null, '') ?? JSON.parse(readFileSync(pidFile, 'utf8')); out.panelRecordedPid = { pid: p.pid, alive: isFwdloopAlive(p.pid, p.procStart) }; }
console.log(JSON.stringify(out));
