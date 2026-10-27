// M12 piece 1: at the Run door a ticket input is one ticket of the signed list, typed per run; one that is not under the list is refused at $0, naming the input.
// Real HTTP against the real panel; $0, no network. Forced reds are named in the commit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { killChildrenAfter, world, rq, HERE } from './m4e-world.mjs';
import { writeFlow } from '../src/flow.js';
import { writeModelRecord } from '../src/flowmodel.js';
import { loadCatalogue } from '../src/catalogue.js';
import { sandboxSend } from './send-sandbox.js';

killChildrenAfter();
const LIST = 'https://github.com/hamr0/bareloop/issues?q=is:open+label:fwdloop';
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
async function worldWithTickets() {
  const w = await world();
  const prose = sandboxSend(fixture('job2-with-sources.signed.txt')).replace(/guardrail: source jd = file:.*\n?/, `guardrail: source jd = tickets:${LIST}\n`);
  const cat = loadCatalogue();
  const wr = writeFlow({ root: w.root, name: 'job2', proseText: prose, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-27T12:00:00Z', catalogue: cat.primitives });
  assert.equal(wr.ok, true, wr.ok ? '' : wr.reds.join('\n'));
  writeModelRecord(wr.dir ?? path.join(w.root, 'job2'), { slot: 'DEEPSEEK_API_KEY', model: 'fake-ticked' });
  writeFileSync(path.join(w.inDir, 'resume.md'), '# R\n');
  w.seedPassed('job2');
  return w;
}
const run = (w, inputs) => rq(w.h.port, { method: 'POST', url: '/api/author/run', body: { flow: 'job2', inputs, runId: 'r1' } });
const resume = (w) => ({ role: 'resume', path: path.join(w.inDir, 'resume.md') });

test('run door: a ticket address not under the signed list is refused at $0, naming the input and the list; nothing starts', async () => {
  const w = await worldWithTickets();
  for (const bad of ['https://github.com/hamr0/bareloop/issues', 'https://github.com/hamr0/bareloop/issues/57/x', 'https://github.com/hamr0/other/issues/57', 'https://evil.example/hamr0/bareloop/issues/57', path.join(w.inDir, 'jd.md')]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await run(w, [resume(w), { role: 'jd', path: bad }]);
    assert.equal(r.status, 400, `${bad} ${r.body}`);
    const j = r.json();
    assert.equal(j.refused, 'run');
    assert.deepEqual(j.refusals.map((x) => x.field), ['inputs.1'], bad);
    assert.ok(j.refusals[0].say.includes('"jd"') && j.refusals[0].say.includes(LIST), j.refusals[0].say);
  }
  assert.deepEqual(w.starts(), []);
});

test('run door: a ticket role left blank is refused (the run must say which ticket); a ticket under the list is accepted and starts', async () => {
  const w = await worldWithTickets();
  const blank = await run(w, [resume(w), { role: 'jd', path: '' }]);
  assert.equal(blank.status, 400);
  assert.deepEqual(w.starts(), []);
  const ok = await run(w, [resume(w), { role: 'jd', path: 'https://github.com/hamr0/bareloop/issues/57' }]);
  assert.equal(ok.status, 202, ok.body);
  const st = JSON.parse(readFileSync(path.join(w.root, '.starts', ok.json().startId, 'start.json'), 'utf8'));
  assert.deepEqual(st.sources, [{ role: 'resume', path: path.join(w.inDir, 'resume.md') }, { role: 'jd', path: 'https://github.com/hamr0/bareloop/issues/57' }]);
});

test('run door: the flow entry names the ticket roles and their lists, never as pages; the last ticket is not offered again', async () => {
  const w = await worldWithTickets();
  const f = (await w.get('/api/author/flows')).json().flows.find((x) => x.flow === 'job2');
  assert.deepEqual(f.tickets, { jd: LIST });
  assert.deepEqual(f.pages, {});
});
