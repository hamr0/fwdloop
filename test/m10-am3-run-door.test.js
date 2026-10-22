// M10 amendment 3: at the Run door a page input shows its signed address (read-only) and a different address is refused at $0, naming the input.
// File inputs stay per-run. Real HTTP against the real panel and the real `bin/fwdloop run` child (test model step); $0, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { killChildrenAfter, world, rq, until } from './m4e-world.mjs';

killChildrenAfter();
const SIGNED = 'http://127.0.0.1:1/signed-page';
const worldWithPage = async () => {
  const w = await world();
  await w.signedFlow({ inputs: `resume: ${path.join(w.inDir, 'resume.md')}\njd: ${SIGNED}` });
  return w;
};
const run = (w, inputs, over = {}) => rq(w.h.port, { method: 'POST', url: '/api/author/run', body: { flow: 'job2', inputs, runId: 'r1', ...over } });
const resume = (w) => ({ role: 'resume', path: path.join(w.inDir, 'resume.md') });

test('run door: a different address for a page input is refused at $0, naming the input; nothing is created', async () => {
  const w = await worldWithPage();
  const r = await run(w, [resume(w), { role: 'jd', path: 'https://evil.example/x' }]);
  assert.equal(r.status, 400, r.body);
  const j = r.json();
  assert.equal(j.refused, 'run');
  assert.deepEqual(j.refusals.map((x) => x.field), ['inputs.1']);
  assert.match(j.refusals[0].say, /the input "jd" is a web page signed as http:\/\/127\.0\.0\.1:1\/signed-page/);
  assert.deepEqual(w.starts(), []);
  // a file path for a page role is a different address too
  assert.equal((await run(w, [resume(w), { role: 'jd', path: path.join(w.inDir, 'jd.md') }])).status, 400);
});

test('run door: the page row may be blank, absent, or the signed address; the start carries the signed address; a file role is still per-run', async () => {
  const w = await worldWithPage();
  w.seedPassed('job2');
  const sent = [];
  for (const [n, inputs] of [[1, [resume(w), { role: 'jd', path: '' }]], [2, [resume(w)]], [3, [resume(w), { role: 'jd', path: SIGNED }]]]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await w.post('/api/author/run', { flow: 'job2', inputs, runId: `r${n}` });
    assert.equal(r.status, 202, r.text);
    sent.push(r.json().startId);
    // one start at a time per flow: wait for this child to finish (it stops at its page fetch) before the next
    // eslint-disable-next-line no-await-in-loop
    const end = await until(async () => { const j = (await w.get(`/api/author/start/${sent[n - 1]}`)).json(); return j?.phase !== 'starting' ? j : null; }, 90000);
    // the child fetched the SIGNED address and stopped at $0 naming the input
    assert.equal(end.phase, 'refused');
    assert.match(end.say, /input "jd": http:\/\/127\.0\.0\.1:1\/signed-page/);
  }
  for (const id of sent) {
    const st = JSON.parse(readFileSync(path.join(w.root, '.starts', id, 'start.json'), 'utf8'));
    assert.deepEqual(st.sources, [{ role: 'resume', path: path.join(w.inDir, 'resume.md') }, { role: 'jd', path: SIGNED }]);
  }
});

test('run door: the flow entry shows the signed address as the page input\'s value', async () => {
  const w = await worldWithPage();
  w.seedPassed('job2');
  const f = (await w.get('/api/author/flows')).json().flows.find((x) => x.flow === 'job2');
  assert.equal(f.lastSources.jd, SIGNED);
  assert.equal(f.lastSources.resume, '');
  assert.deepEqual(f.pages, { jd: SIGNED }, 'the page marks which inputs are web pages, so the Run row is read-only');
});
