// F152 (pre-registered in docs/logs/FINDINGS.md): read-only scan of hamr's drafting folders for the am38 trigger red.
// Reads only. Writes nothing itself; the caller redirects stdout to poc/am38/out/scan.txt.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { plainPlanCheck } from '../../src/plain-checks.js';

const root = process.argv[2] ?? join(homedir(), '.config/fwdloop/flows/.drafts');
const TRIGGER = /send at line \d+ .*is not granted a catalogue primitive of class "write"/;
const rd = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const lastLine = (p) => {
  if (!existsSync(p)) return '(no prose.txt)';
  const ls = readFileSync(p, 'utf8').split('\n').filter((l) => /^\d+\.\s/.test(l));
  return ls.length ? ls[ls.length - 1] : '(none)';
};
let red = 0, trig = 0, nonTrig = 0, tried = 0;
const rows = [];
for (const d of readdirSync(root).filter((x) => x.startsWith('d-')).sort()) {
  const tries = readdirSync(join(root, d)).filter((x) => x === 'draft' || /^draft-\d+$/.test(x));
  for (const t of tries) {
    const log = rd(join(root, d, t, 'log.json'));
    if (!log) continue;
    tried++;
    const reds = Array.isArray(log.reds) ? log.reds.map(String) : [];
    if (log.ok === true || reds.length === 0) continue;
    red++;
    const isTrig = reds.some((r) => TRIGGER.test(r));
    isTrig ? trig++ : nonTrig++;
    const prose = join(root, d, t, 'prose.txt');
    rows.push([d, t, plainPlanCheck(reds[0]).reason, isTrig ? 'y' : 'n', lastLine(existsSync(prose) ? prose : join(root, d, 'prose.txt'))].join(' | '));
  }
}
console.log('folder | try | first-red reason today | trigger? | last job line');
for (const r of rows) console.log(r);
console.log(`\ntries read: ${tried}; red tries: ${red}; with trigger: ${trig}; without trigger: ${nonTrig}`);
