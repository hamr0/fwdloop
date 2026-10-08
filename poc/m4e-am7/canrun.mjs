// M4e amendment 7 item 7 POC — $0, fake model, no key. Never shipped.
// Riskiest assumption: ONE function (src/canrun.js `canFlowRun`) can stand in for "would the run's preflight accept this flow", and it
// refuses an unwired-verb flow in the SAME words runFlow's own preflight does (the live case: job2-live-1, step resume-summary, verb compress).
// Run: node poc/m4e-am7/canrun.mjs   (PASS/FAIL per row, exit 1 on a FAIL)
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCatalogue } from '../../src/catalogue.js';
import { readFlow, writeFlow } from '../../src/flow.js';
import { runFlow } from '../../src/runner.js';
import { canFlowRun } from '../../src/canrun.js';
import { sandboxSend } from '../../test/send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '../../test/fixtures');
let fails = 0;
const row = (id, ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${msg}`); if (!ok) fails += 1; };

const cat = loadCatalogue();
const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-canrun-poc-'));
try {
  const make = (name, unwire) => {
    const declaration = JSON.parse(readFileSync(path.join(FIX, 'job2.m1.declaration.json'), 'utf8'));
    if (unwire) declaration.steps.find((s) => s.emits === 'resume-summary').primitives = ['compress'];
    const w = writeFlow({
      root, name, proseText: sandboxSend(readFileSync(path.join(FIX, 'job2-with-sources.signed.txt'), 'utf8')),
      declaration, signedBy: 'hamr', signedAt: '2026-09-24T12:00:00Z', catalogue: cat.primitives,
    });
    if (!w.ok) throw new Error(w.reds.join('; '));
  };
  make('good', false);
  make('unwired', true);

  const good = canFlowRun(readFlow({ root, name: 'good', catalogue: cat.primitives }));
  row('good', good.ok === true, 'a wired flow can run');

  const bad = canFlowRun(readFlow({ root, name: 'unwired', catalogue: cat.primitives }));
  row('unwired-refused', bad.ok === false, `the unwired flow cannot run: ${bad.red}`);

  const pre = await runFlow({
    root, name: 'unwired', runId: 'run-1', sources: [], catalogue: cat.primitives,
    modelStep: async () => { throw new Error('no model call'); }, askStep: async () => ({}), sendStep: async () => ({}), primitives: {}, businessDate: '2026-06-01',
  });
  row('same-words', pre.outcome === 'preflight-red' && pre.red === bad.red, `preflight says: ${pre.red}`);

  const none = canFlowRun(readFlow({ root, name: 'nothere', catalogue: cat.primitives }));
  row('unreadable-refused', none.ok === false, `a flow that does not read cannot run: ${none.red}`);
} finally { rmSync(root, { recursive: true, force: true }); }
process.exit(fails ? 1 : 0);
