// M6 piece B: each run saves a write-once copy of the job it ran, when it starts (`<run>/job/{prose.txt,declaration.json,signature.json}`),
// and its Job tab shows THAT copy. Editing the job later never changes what an old run's Job tab says; a run from before M6 (no copy) shows
// the current job and says so. Units on the two flow.js functions, then the real panel and the real `fwdloop run` child.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { loadCatalogue } from '../src/catalogue.js';
import {
  readFlow, readRunJobCopy, writeFlow, writeRunJobCopy,
} from '../src/flow.js';
import { runFlow, makeParkingAskStep } from '../src/runner.js';
import { readHistory } from '../src/books.js';
import { sendViaPrimitive } from '../src/send.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();
const CAT = loadCatalogue().primitives;
const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

function signedFlowDir() {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m6b-'));
  const w = writeFlow({ root, name: 'f', proseText: fx('job1.m1.signed.txt'), declaration: JSON.parse(fx('job1.m1.declaration.json')), signedBy: 'h', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT });
  assert.equal(w.ok, true, JSON.stringify(w.reds));
  const runDir = path.join(w.dir, 'runs', 'run-1');
  mkdirSync(runDir, { recursive: true });
  return { root, flowDir: w.dir, runDir };
}

test('writeRunJobCopy: the three signed files, byte for byte, write-once; readRunJobCopy verifies them against the copied signature', () => {
  const x = signedFlowDir();
  assert.deepEqual(readRunJobCopy(x.runDir, CAT), { present: false });
  const w = writeRunJobCopy(x.flowDir, x.runDir);
  assert.equal(w.ok, true, JSON.stringify(w));
  for (const f of ['prose.txt', 'declaration.json', 'signature.json']) {
    assert.equal(readFileSync(path.join(x.runDir, 'job', f), 'utf8'), readFileSync(path.join(x.flowDir, f), 'utf8'), f);
  }
  const r = readRunJobCopy(x.runDir, CAT);
  assert.equal(r.present, true);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.lines.length, 6);
  assert.equal(r.signature.flow, readFlow({ root: x.root, name: 'f', catalogue: CAT }).signature.flow);
  // write-once: a second write is refused and the copy is untouched
  const again = writeRunJobCopy(x.flowDir, x.runDir);
  assert.equal(again.ok, false);
  assert.match(again.red, /already/);
});

test('writeRunJobCopy: a flow whose files no longer match its signature is never copied (nothing is written)', () => {
  const x = signedFlowDir();
  writeFileSync(path.join(x.flowDir, 'prose.txt'), fx('job1.m1.signed.txt').replace('cap $0.25', 'cap $0.30'));
  const w = writeRunJobCopy(x.flowDir, x.runDir);
  assert.equal(w.ok, false);
  assert.equal(existsSync(path.join(x.runDir, 'job')), false);
});

test('readRunJobCopy: a copy edited after the run started is refused by name, never shown as the job', () => {
  const x = signedFlowDir();
  writeRunJobCopy(x.flowDir, x.runDir);
  writeFileSync(path.join(x.runDir, 'job', 'prose.txt'), fx('job1.m1.signed.txt').replace('cap $0.25', 'cap $9'));
  const r = readRunJobCopy(x.runDir, CAT);
  assert.equal(r.present, true);
  assert.equal(r.ok, false);
  assert.match(r.reds.join('\n'), /prose\.txt does not match its signed hash/);
  rmSync(path.join(x.runDir, 'job', 'signature.json'));
  assert.equal(readRunJobCopy(x.runDir, CAT).ok, false, 'a copy with a file missing is not a copy');
});

const jobOf = async (w, runId) => (await w.get(`/api/runs/job2/${runId}/job`)).json();
const waitParked = (w, startId) => until(async () => { const v = (await w.get(`/api/author/start/${startId}`)).json(); return v.state === 'parked' ? v : null; });

test('a real run saves its copy at start; after the job is edited and signed, the OLD run\'s Job tab still shows the old lines; a run from before M6 says so', async () => {
  const w = await world({ limit: 5 });
  const flowDir = path.join(w.root, 'job2');
  await w.signedFlow();
  w.seedPassed('job2');   // a run folder with no job copy: "before M6"
  const r1 = await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs(), runId: 'one' });
  assert.equal(r1.status, 202, r1.text);
  await waitParked(w, r1.json().startId);
  assert.deepEqual(readdirSync(path.join(flowDir, 'runs', 'one', 'job')).sort(), ['declaration.json', 'prose.txt', 'signature.json']);
  const oldHash = JSON.parse(readFileSync(path.join(flowDir, 'signature.json'), 'utf8')).flow;
  assert.equal(JSON.parse(readFileSync(path.join(flowDir, 'runs', 'one', 'job', 'signature.json'), 'utf8')).flow, oldHash);

  // edit through the panel: cap 0.25 -> 0.30, sign (replace)
  const entry = (await w.get('/api/author/flows')).json().flows.find((f) => f.flow === 'job2');
  const d = await w.post('/api/author/draft', { ...w.card(), ...entry.edit.card, flowName: 'job2', capUsd: '0.30', editOf: { flow: 'job2', flowHash: entry.edit.flowHash } });
  assert.equal(d.status, 202, d.text);
  const id = d.json().draftId;
  const g = await until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return j?.phase === 'green' ? j : null; });
  // the first run is parked on its ask: the replaced job must not disturb what it shows
  const s = await w.post(`/api/author/${id}/sign`, { hash: g.hash, runId: 'two' });
  assert.equal(s.status, 202, s.text);
  await waitParked(w, s.json().startId);

  const oldTab = await jobOf(w, 'one');
  const newTab = await jobOf(w, 'two');
  assert.equal(oldTab.capUsd, 0.25, 'the old run still shows the job it ran');
  assert.equal(newTab.capUsd, 0.30);
  assert.equal(oldTab.jobFrom, 'run');
  assert.equal(oldTab.signature.hash, oldHash);
  assert.notEqual(newTab.signature.hash, oldHash);
  assert.equal(newTab.jobFrom, 'run');
  const before = await jobOf(w, 'seed-pass');
  assert.equal(before.jobFrom, 'current', 'a run from before M6 has no copy');
  assert.match(before.jobFromWhy, /started before runs kept a copy of their job/);
  assert.equal(before.capUsd, 0.30, 'and shows the job as it is now');
  assert.equal(oldTab.jobFromWhy, null);
});

test('the Job tab says which job it shows, in the words the server sends', async () => {
  const page = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
  assert.match(page, /id="details-jobfrom"/);
  assert.match(page, /This is the job as this run started it\./);
  assert.match(page, /job\.jobFromWhy/);
});

// F3 (review): the copy must be the job this run verified at its start. A swap between the read and the copy halts the run.
test('a job replaced between the run\'s read and its copy: the run halts preflight-red, keeps no copy, spends nothing', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-m6f3-'));
  const root = path.join(base, 'flows'); const dest = path.join(base, 'dest'); const src = path.join(base, 'src');
  for (const d of [root, dest, src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text.'); writeFileSync(path.join(src, 'jd.md'), 'JD text.');
  const prose = fx('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${dest}`);
  const decl = JSON.parse(fx('job2.m1.declaration.json'));
  const first = writeFlow({ root, name: 'job2', proseText: prose, declaration: decl, signedBy: 'hamr', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT });
  assert.equal(first.ok, true, JSON.stringify(first.reds));
  const oldHash = readFlow({ root, name: 'job2', catalogue: CAT }).signature.flow;
  let swapped = false;
  // existing seam: runFlow reads `primitiveReds.length` after its read of the job and before the copy; the getter swaps the job there
  const primitiveReds = { get length() {
    const r = writeFlow({ root, name: 'job2', proseText: prose.replace('cap $0.25', 'cap $0.30'), declaration: decl, signedBy: 'hamr', signedAt: '2026-10-10T11:00:00Z', catalogue: CAT, replaces: { flowHash: oldHash } });
    assert.equal(r.ok, true, JSON.stringify(r.reds));
    swapped = true;
    return 0;
  } };
  const modelStep = async () => { throw new Error('no step may run'); };
  const r = await runFlow({
    root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, primitiveReds, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(),
    sources: [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }],
  });
  assert.equal(swapped, true, 'the seam fired');
  assert.equal(r.outcome, 'preflight-red', JSON.stringify(r));
  assert.match(r.red, /the job was replaced while this run was starting/);
  const runDir = path.join(root, 'job2', 'runs', 'run-1');
  assert.equal(existsSync(path.join(runDir, 'job')), false, 'no mismatched copy is kept');
  assert.equal(readHistory(path.join(root, 'job2')).at(-1).signatureHash, oldHash);
});
