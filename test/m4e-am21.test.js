// M4e amendment 22 (SIGNED 2026-10-09; removes amendment 21 item 1's list entry): a flow the preflight refuses is never listed in
// Run a signed flow (amendment 7 item 7), and the run door still refuses it up front (409). $0: no provider, scratch world.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, readFileSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { signFlow } from '../src/signature.js';
import { killChildrenAfter, world } from './m4e-world.mjs';

killChildrenAfter();

/** Re-sign a flow in place after `mut` changed its declaration: what a flow signed before the validator tightened looks like. */
function resign(flowDir, mut) {
  const decl = JSON.parse(readFileSync(path.join(flowDir, 'declaration.json'), 'utf8'));
  mut(decl);
  const declarationText = `${JSON.stringify(decl, null, 2)}\n`;
  const proseText = readFileSync(path.join(flowDir, 'prose.txt'), 'utf8');
  const sig = signFlow({ proseText, declarationText, signedBy: 'hamr', signedAt: '2026-10-06T00:00:00Z' });
  assert.equal(sig.ok, true);
  writeFileSync(path.join(flowDir, 'declaration.json'), declarationText);
  writeFileSync(path.join(flowDir, 'signature.json'), `${JSON.stringify(sig.signature, null, 2)}\n`);
}
const unwire = (d) => { d.steps[0].primitives = [...(d.steps[0].primitives ?? []), 'compress']; };

test('22 a signed flow the preflight refuses is NOT in the Run-a-signed-flow list; a runnable one with a passed run is', async () => {
  const w = await world();
  const bad = await w.signedFlow({ flowName: 'bad' });
  await w.signedFlow({ flowName: 'good' });
  w.seedPassed('good');
  w.seedPassed('bad', 'seed');
  resign(bad.flowDir, unwire);
  const list = (await w.get('/api/author/flows')).json();
  assert.deepEqual(list.flows.map((f) => f.flow), ['good'], 'the refused flow is not listed');
  // its reason still shows on Run again
  const run = await w.get('/api/author/run-again?flow=bad&runId=seed');
  assert.equal(run.status, 409, run.text);
  assert.match(run.json().say, /^"bad" will not run: preflight: step ".*" \(line \d+\) grants verb "compress"/);
});

test('22 the run door still refuses a refused flow up front: 409, nothing is created', async () => {
  const w = await world();
  const bad = await w.signedFlow({ flowName: 'bad' });
  resign(bad.flowDir, unwire);
  const r = await w.post('/api/author/run', { flow: 'bad', inputs: w.inputs(), runId: 'r1' });
  assert.equal(r.status, 409, r.text);
  assert.deepEqual(w.starts(), []);
  assert.equal(existsSync(path.join(bad.flowDir, 'runs', 'r1')), false);
});

