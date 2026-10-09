// M4e amendment 34: the Job tab holds two blocks. "What you asked" is the human's signed words only; "What the plan does" is read from the signed flow's
// own files (declaration.json for the steps and their checks, the setup.jsonl sign row for "Not checked"). $0. The layout itself is a browser walk.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/index.js';
import { loadCatalogue } from '../src/catalogue.js';
import { getRunJob } from '../src/panel/data.js';
import { NOT_CHECKED_LABEL, checkedLines } from '../src/checked.js';
import { SETUP_FILE } from '../src/setup.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const CAT = loadCatalogue().primitives;
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');

function world(setupRows) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-am34-'));
  const decl = JSON.parse(fixture('job2.m1.declaration.json'));
  const w = writeFlow({
    root, name: 'f', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: decl, signedBy: 'hamr', signedAt: '2026-10-09T12:00:00Z', catalogue: CAT,
  });
  assert.equal(w.ok, true, JSON.stringify(w.reds));
  mkdirSync(path.join(w.dir, 'runs', 'run-1'), { recursive: true });
  if (setupRows) writeFileSync(path.join(w.dir, SETUP_FILE), `${setupRows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return { root, decl, job: () => getRunJob({ root, flow: 'f', runId: 'run-1', catalogue: CAT }) };
}
const SIGN = (items) => ({ kind: 'sign', n: 0, at: '2026-10-09T12:00:00Z', signedBy: 'hamr', hash: 'h', flowHash: 'fh', notChecked: { label: NOT_CHECKED_LABEL, items } });

test('the plan has one row per step: from line, reads, makes, may do, and the check as "Checked" said at sign', () => {
  const x = world([SIGN(['tone'])]);
  const { plan } = x.job();
  assert.equal(plan.steps.length, 5);
  const checked = checkedLines(x.decl, { hasAsk: true });
  plan.steps.forEach((s, i) => {
    assert.equal(s.line, x.decl.steps[i].fromLine);
    assert.deepEqual(s.reads, x.decl.steps[i].reads);
    assert.equal(s.makes, x.decl.steps[i].emits);
    assert.deepEqual(s.check, checked[i].sentences, 'the check is checkedLines, not new wording');
  });
  assert.deepEqual(plan.steps[0].mayDo, ['readDocx']);
  assert.deepEqual(plan.steps[3].mayDo, [], 'the ask step grants nothing: the page says "nothing (pure stop)"');
});

test('the ask step carries its wait; other steps do not', () => {
  const { plan } = world([SIGN([])]).job();
  assert.equal(plan.steps[3].ask, true);
  assert.equal(plan.steps[3].waitMs, 1800000);
  assert.equal(plan.steps.filter((s) => s.ask).length, 1);
});

test('Not checked is read word for word from the setup.jsonl sign row, label always', () => {
  const { plan } = world([SIGN(['tone', 'the JD match'])]).job();
  assert.deepEqual(plan.notChecked, { label: NOT_CHECKED_LABEL, items: ['tone', 'the JD match'], recorded: true });
});

test('a flow signed before amendment 36 says "not recorded", never an empty list', () => {
  for (const rows of [null, [{ kind: 'sign', n: 0, at: 'x', signedBy: 'hamr', hash: 'h' }]]) {
    const { plan } = world(rows).job();
    assert.equal(plan.notChecked.recorded, false);
    assert.equal(plan.notChecked.label, NOT_CHECKED_LABEL);
    assert.deepEqual(plan.notChecked.items, []);
  }
});

test('no Success field any more: the job carries no `success` rows', () => {
  assert.equal('success' in world([SIGN([])]).job(), false);
});

test('the page: two blocks, no Success box, the plan block holds a Not checked label', () => {
  assert.match(PAGE, /What you asked/);
  assert.match(PAGE, /What the plan does/);
  assert.doesNotMatch(PAGE, /details-success/);
  assert.match(PAGE, /Not checked \(the AI's own reading\)/);
  assert.match(PAGE, /nothing \(pure stop\)/);
  assert.match(PAGE, /ASK · waits /);
  assert.match(PAGE, /not recorded \(signed before amendment 34\)/);
});
