// M4e amendment 21 (SIGNED 2026-10-09): 1 (a signed flow that will not run stays in the Signed list, greyed, no Run button, with
// Run again's own sentence), 2A (the Runs hint stays), 3 (an old-green/new-crash plan shape is refused at $0 at run start).
// $0: no provider, scratch world.
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

test('1 a signed flow that will not run is listed refused, with Run again\'s sentence; a flow that runs is listed unchanged', async () => {
  const w = await world();
  const bad = await w.signedFlow({ flowName: 'bad' });
  await w.signedFlow({ flowName: 'good' });
  w.seedPassed('good');
  w.seedPassed('bad', 'seed');
  resign(bad.flowDir, unwire);
  const list = (await w.get('/api/author/flows')).json();
  assert.deepEqual(list.flows.map((f) => f.flow).sort(), ['bad', 'good'], 'the refused flow does not vanish');
  const b = list.flows.find((f) => f.flow === 'bad');
  const g = list.flows.find((f) => f.flow === 'good');
  assert.equal(b.refused, true);
  assert.equal(g.refused, undefined, 'a runnable flow carries no flag');
  // the reason is the very sentence Run again's 409 gives for the same flow (one function makes it)
  const run = await w.get('/api/author/run-again?flow=bad&runId=seed');
  assert.equal(run.status, 409, run.text);
  assert.equal(b.say, run.json().say);
  assert.match(b.say, /^"bad" will not run: preflight: step ".*" \(line \d+\) grants verb "compress"/);
});

test('1 a refused flow is never startable: a POST naming it is refused and nothing is created', async () => {
  const w = await world();
  const bad = await w.signedFlow({ flowName: 'bad' });
  resign(bad.flowDir, unwire);
  const r = await w.post('/api/author/run', { flow: 'bad', inputs: w.inputs(), runId: 'r1' });
  assert.notEqual(r.status, 202, r.text);
  assert.deepEqual(w.starts(), []);
  assert.equal(existsSync(path.join(bad.flowDir, 'runs', 'r1')), false);
});

test('1 the page greys a refused row, shows its reason, and cannot pick it', () => {
  const html = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
  assert.match(html, /f\.refused === true \? f\.say/, 'flowChoices shows the reason as the row\'s second line');
  assert.match(html, /rw-refused/, 'a greyed row class');
  assert.match(html, /if\(!c \|\| c\.refused \|\|/, 'pickFlowChoice refuses a refused row');
});
