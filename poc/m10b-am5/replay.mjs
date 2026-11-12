// M10b am5 POC 1 ($0, no key, no network): replay walk-m10am32-1's real sheet checks through the REAL run path
// (src/sheetrun.js readRunSheets + closeSheet -> bareguard createRubric/checkStep). Read only on the flow.
//   node poc/m10b-am5/replay.mjs [runDir]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readRunSheets, closeSheet } from '../../src/sheetrun.js';

const flow = join(homedir(), '.config/fwdloop/flows/walk-m10am32-1');
const runDir = process.argv[2] ?? join(flow, 'runs/run-1');
const plan = JSON.parse(readFileSync(join(flow, 'signed/declaration.json'), 'utf8'));
const step = plan.steps.find((s) => Array.isArray(s.close?.sheet));
const real = step.close.sheet.find((c) => c.rule === 'table' && c.op === 'noDuplicates');
if (!real) { console.log('FAIL: no table noDuplicates check in the signed plan'); process.exit(1); }
const good = { id: 'customer-not-empty', rule: 'table', table: real.table, op: 'noEmpty', column: 'Customer' };

// bareguard's `happened` check wants a non-empty answer: use the model's real claims from the run (the table check ignores them)
const claims = JSON.parse(readFileSync(join(runDir, 'line-checks.json'), 'utf8')).sheet.lines[0].claims;
let bad = 0;
for (const [label, check, want] of [['plan check (noDuplicates Customer)', real, 'red'], ['control (noEmpty Customer)', good, 'green']]) {
  const sheet = readRunSheets(runDir, [check]);
  const v = await closeSheet([check], claims, sheet);
  const ok = v.verdict === want;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: verdict=${v.verdict} want=${want} red=${JSON.stringify(v.red)}`);
}
process.exit(bad ? 1 : 0);
