// F265 ($0): step lines from the `fwdloop draft` child into child.log, read back by the panel. Runs inside the prototype root (test/p2.test.mjs).
// Real panel, real `bin/fwdloop draft` child with the test fake draft provider; no provider call.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { draftStepList } from '../src/draft-steps.js';
import { killChildrenAfter, until, world, JOB } from './m4e-world.mjs';

killChildrenAfter();
const jf = (f) => JSON.parse(readFileSync(f, 'utf8'));
const listing = (d) => readdirSync(d, { recursive: true }).filter((n) => !/pages/.test(n)).sort();
const poll = (w, id) => async () => (await w.get(`/api/author/${id}`)).json();

test('a live: while the child runs, steps so far, exactly one running', async () => {
  const w = await world({ mode: 'hang', extraEnv: { FWDLOOP_TEST_DRAFT_THINKING_STATUS: 'applied' } });
  const r = await w.post('/api/author/draft', w.card({ job: JOB }));
  assert.equal(r.status, 202, r.text);
  const id = r.json().draftId;
  const j = await until(async () => { const s = await poll(w, id)(); return s?.steps?.length >= 2 ? s : null; }, 60000);
  console.log('LIVE', JSON.stringify(j.steps.map((s) => [s.no, s.label, s.status])));
  assert.equal(j.phase, 'drafting');
  assert.equal(j.steps.filter((s) => s.status === 'running').length, 1, 'one running');
});

for (const endLabel of ['0', '1']) {
  test(`b after the draft ends (end line label ${endLabel}): labels equal draftStepList's`, async () => {
    const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_THINKING_STATUS: 'applied', P2_END_LABEL: endLabel } });
    const r = await w.post('/api/author/draft', w.card({ job: JOB }));
    const id = r.json().draftId;
    const j = await until(async () => { const s = await poll(w, id)(); return s?.phase === 'green' ? s : null; }, 60000);
    const dir = path.join(w.dir(id), 'draft');
    const want = draftStepList({ log: jf(path.join(dir, 'log.json')), declaration: jf(path.join(dir, 'declaration.json')) }).filter((x) => !x.note);
    console.log('ENDED', endLabel, JSON.stringify(j.steps.map((s) => [s.no, s.label, s.status])), 'WANT', JSON.stringify(want.map((x) => x.label)));
    console.log('LISTING', endLabel, JSON.stringify(listing(w.dir(id))));
    assert.ok(want.length >= 3, `at least 3 steps, got ${want.length}`);
    assert.equal(j.steps.length, want.length, 'same count');
    assert.ok(j.steps.every((s) => s.endedAt !== null), 'every step has an end');
    j.steps.forEach((s, i) => assert.equal(endLabel === '1' ? s.endLabel : s.label, want[i].label, `step ${i} label`));
    // c: a draft with no step lines returns no times
    const log = path.join(w.dir(id), 'child.log');
    writeFileSync(log, readFileSync(log, 'utf8').split('\n').filter((l) => !/^fwdloop: step-(start|end) /.test(l)).join('\n'));
    const old = await poll(w, id)();
    assert.deepEqual(old.steps, [], 'no lines, no steps');
  });
}
