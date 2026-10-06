// M4e amendment 4 items 4 and 6 and negatives (e), (g); amendment 5 item 1 and negative (e): Resume of a stopped or cap-halted run
// (the SAME run id), the cap as a new write-once signed version, the two-click hash-bound door. $0: a fake modelStep in-process for the
// runner, and the real `bin/fwdloop` children with the test model step over real HTTP for the door. Everything removed, every child killed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readHistory, readAudit } from '../src/books.js';
import {
  runFlow, continueRun, makeParkingAskStep, readHaltRecord, requestStop, HALT_FILE,
} from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { valuesHash, writeRunValues, pickRunValues } from '../src/runvalues.js';
import {
  killChildrenAfter, rq, until, world,
} from './m4e-world.mjs';

killChildrenAfter();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** A signed job #2 flow with cap `cap` in a scratch root. */
function mk(tag, cap = '0.0105') {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-am4r-${tag}-`));
  const w = {
    base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src'),
  };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`).replace('cap $0.25', `cap $${cap}`);
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: prose, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-06T00:00:00Z', catalogue: CAT,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.flowDir = path.join(w.root, 'job2');
  w.runDir = path.join(w.flowDir, 'runs', 'run-1');
  w.sources = [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }];
  return w;
}
function step(onCall) {
  const calls = [];
  const fn = async (ctx) => {
    let emits; let text;
    if (ctx.goal.includes('resume .docx')) { emits = 'resume-text'; text = 'resume text'; } else if (ctx.goal.includes('job description markdown')) { emits = 'jd-text'; text = 'jd text'; } else {
      emits = 'resume-summary';
      text = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
    }
    calls.push(emits);
    if (onCall) await onCall(emits);
    return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
  };
  return { fn, calls };
}
const args = (w, modelStep, extra = {}) => ({
  root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, ...extra,
});
/** Sign the human's new cap as version `v` of this run, the way the door does (the hash binds flow, signature, run, version, values). */
function signCap(w, version, capUsd) {
  const values = { capUsd, destination: w.dest, askWaits: { 4: '30m' } };
  const sig = JSON.parse(readFileSync(path.join(w.flowDir, 'signature.json'), 'utf8')).flow;
  const hash = valuesHash({
    flow: 'job2', flowSignatureHash: sig, runId: 'run-1', version, values,
  });
  const r = writeRunValues(w.runDir, {
    flow: 'job2', flowSignatureHash: sig, runId: 'run-1', version, values, hash, signedBy: 'hamr', at: '2026-10-06T00:00:00Z',
  });
  assert.equal(r.ok, true, r.ok ? '' : r.red);
  return hash;
}

test('am4 (e) runner: a cap-halted run continues as the SAME run under a new signed cap — done step not re-run, spend so far counts, the flow\'s signed files and the first leg\'s records unchanged', async () => {
  const w = mk('e');
  const { fn, calls } = step();
  const r1 = await runFlow({ ...args(w, fn, { askStep: makeParkingAskStep() }), sources: w.sources });
  assert.equal(r1.outcome, 'cap-halt', r1.red);
  assert.deepEqual(calls, ['resume-text']);
  const before = {
    prose: sha(path.join(w.flowDir, 'prose.txt')), sig: sha(path.join(w.flowDir, 'signature.json')), art1: sha(path.join(w.runDir, 'artifacts', 'resume-text.json')), audit: readFileSync(path.join(w.runDir, 'audit.jsonl'), 'utf8'),
  };
  assert.equal(readHaltRecord(w.runDir).halt.outcome, 'cap-halt');
  // the same cap: refused by name, nothing consumed, nothing spent
  const same = await continueRun(args(w, fn));
  assert.equal(same.outcome, 'cap-halt', 'under the same cap it halts again at the same step (nothing new was signed)');
  assert.deepEqual(calls, ['resume-text'], 'no model call was made');
  assert.equal(readdirSync(w.runDir).filter((n) => /^halt/.test(n)).sort().join(), 'halt.1.consumed.json,halt.json', 'a second halt record replaced the consumed one');
  // sign the new cap, continue
  signCap(w, 1, 0.25);
  const r2 = await continueRun(args(w, fn));
  assert.equal(r2.outcome, 'paused', r2.red);
  assert.deepEqual(calls, ['resume-text', 'jd-text', 'resume-summary'], 'step 1 was not re-run; the cut step ran once');
  assert.ok(Math.abs(r2.spentUsd - 0.003) < 1e-9, `spend so far counts: ${r2.spentUsd}`);
  assert.equal(sha(path.join(w.flowDir, 'prose.txt')), before.prose);
  assert.equal(sha(path.join(w.flowDir, 'signature.json')), before.sig);
  assert.equal(sha(path.join(w.runDir, 'artifacts', 'resume-text.json')), before.art1);
  assert.ok(readFileSync(path.join(w.runDir, 'audit.jsonl'), 'utf8').startsWith(before.audit), 'audit.jsonl was only appended to');
  assert.deepEqual(readdirSync(path.join(w.flowDir, 'runs')), ['run-1'], 'no second run exists');
  const hist = readHistory(w.flowDir).filter((h) => h.runId === 'run-1').map((h) => h.outcome);
  assert.deepEqual(hist, ['cap-halt', 'cap-halt'], 'history stays append-only; the second leg paused (no row yet)');
  const state = JSON.parse(readFileSync(path.join(w.runDir, 'state.json'), 'utf8'));
  assert.ok(Math.abs(state.spent - 0.003) < 1e-9);
  assert.equal(pickRunValues(w.runDir).version, 1, 'the run resumes under version 1');
  // never overwritten: a second write of version 1 is refused and the file keeps its bytes
  const v1 = sha(path.join(w.runDir, 'signed-values-r1.json'));
  const again = writeRunValues(w.runDir, JSON.parse(readFileSync(path.join(w.runDir, 'signed-values-r1.json'), 'utf8')));
  assert.equal(again.ok, false);
  assert.match(again.red, /never overwritten/);
  assert.equal(sha(path.join(w.runDir, 'signed-values-r1.json')), v1);
});

test('am4 (e) runner: a cap at or below what is already spent is refused by name at $0 — no model call, the halt record stays', async () => {
  const w = mk('e2');
  const { fn, calls } = step();
  const r1 = await runFlow({ ...args(w, fn, { askStep: makeParkingAskStep() }), sources: w.sources });
  assert.equal(r1.outcome, 'cap-halt');
  signCap(w, 1, 0.001); // exactly what is spent
  const r = await continueRun(args(w, fn));
  assert.equal(r.outcome, 'refused');
  assert.match(r.red, /not above what run "run-1" has already spent/);
  assert.deepEqual(calls, ['resume-text']);
  assert.equal(existsSync(path.join(w.runDir, HALT_FILE)), true, 'refused before the halt record was consumed');
  assert.equal(readAudit(w.runDir).length, 2, 'no row was added (the first step and the cap-halt row)');
});

test('am4 (d)+(e): a STOPPED run continues too, at the step it was cut before; a tampered signed-values file is refused', async () => {
  const w = mk('s', '0.25');
  const { fn, calls } = step(async (emits) => { if (emits === 'resume-text') requestStop(w.runDir); });
  const r1 = await runFlow({ ...args(w, fn, { askStep: makeParkingAskStep() }), sources: w.sources });
  assert.equal(r1.outcome, 'stopped', r1.red);
  // a hand-edited values file (same cap, destination swapped) does not match its hash
  signCap(w, 1, 0.25);
  const f = path.join(w.runDir, 'signed-values-r1.json');
  writeFileSync(f, readFileSync(f, 'utf8').replace(`"${w.dest}"`, '"/tmp"'));
  const bad = await continueRun(args(w, fn));
  assert.equal(bad.outcome, 'refused');
  assert.match(bad.red, /does not match its own hash/);
  assert.equal(existsSync(path.join(w.runDir, HALT_FILE)), true);
  // with a good version 2 (the highest wins) the run goes on from step 2 and parks
  signCap(w, 2, 0.25);
  const ok = await continueRun(args(w, step().fn));
  assert.equal(ok.outcome, 'paused', ok.red);
  assert.deepEqual(calls, ['resume-text'], 'the first leg ran step 1 only');
});

test('am4 (e) door: Resume over HTTP — cap-halted run, same run id, the new cap is a new write-once version; too-low cap, extra fields, no/stale hash all refuse at $0 and write nothing', async () => {
  const w = await world({ limit: 5 });
  const { flowDir } = await w.signedFlow({ capUsd: '0.05' });
  const runDir = path.join(flowDir, 'runs', 'r1');
  const start = (await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs(), runId: 'r1' })).json();
  assert.equal(start.ok, true);
  const detail = await until(async () => { const d = (await w.get('/api/runs/job2/r1')).json(); return d?.glyph === '[■]' ? d : null; });
  assert.equal(detail.outcome, 'cap-halt');
  assert.equal(detail.controls.canResume, true);
  assert.equal(detail.word, 'stopped');
  const filesBefore = { prose: sha(path.join(flowDir, 'prose.txt')), sig: sha(path.join(flowDir, 'signature.json')) };
  const starts = () => w.starts().length;
  const startsBefore = starts();
  const none = () => assert.equal(existsSync(path.join(runDir, 'signed-values-r1.json')), false, 'nothing signed');

  // a cap at or below spend so far ($0.001), and below one round: refused with the sentences
  const low = await w.post('/api/author/resume-prepare', { flow: 'job2', runId: 'r1', capUsd: '0.001' });
  assert.equal(low.status, 400);
  assert.match(low.json().refusals[0].say, /^The cap must be above what is already spent \(at least \$0\.05\)\.$/);
  const ok = await w.post('/api/author/resume-prepare', { flow: 'job2', runId: 'r1', capUsd: '0.05' });
  assert.equal(ok.status, 200, 'the "at least" sum named above is itself accepted');
  const note = (await w.get('/api/author/monthly-check?cap=0.001&spent=0.001')).json();
  assert.match(note.text, /at least \$0\.05\)\.$/);
  const small = await w.post('/api/author/resume-prepare', { flow: 'job2', runId: 'r1', capUsd: '0.02' });
  assert.match(small.json().refusals[0].say, /needs at least \$0\.05 per run/);
  const nan = await w.post('/api/author/resume-prepare', { flow: 'job2', runId: 'r1', capUsd: 'lots' });
  assert.equal(nan.status, 400);
  // a Resume that changes anything but the cap is refused as a resume and sends the human to a new run / a new flow
  for (const extra of [{ destination: w.outDir }, { inputs: w.inputs() }, { job: 'x' }, { askWaits: { 4: '2h' } }, { askWait: '2h' }]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await w.post('/api/author/resume', { flow: 'job2', runId: 'r1', capUsd: '0.25', hash: 'x', ...extra });
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.equal(r.json().refused, 'not-a-resume');
    assert.match(r.json().say, /new run of this flow|new flow/);
  }
  none();
  // click 1 writes nothing and gives a hash
  const prep = await w.post('/api/author/resume-prepare', { flow: 'job2', runId: 'r1', capUsd: '0.25' });
  assert.equal(prep.status, 200, prep.text);
  const { hash } = prep.json();
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(prep.json().version, 1);
  none();
  // one click is not a signature: no hash / a wrong hash / another cap's hash sign nothing and start nothing
  for (const bad of [{}, { hash: 'abc' }, { hash: hash.replace(/^./, hash[0] === 'a' ? 'b' : 'a') }]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await w.post('/api/author/resume', { flow: 'job2', runId: 'r1', capUsd: '0.25', ...bad });
    assert.equal(r.status, 409, JSON.stringify(bad));
    assert.equal(r.json().refused, 'stale-hash');
  }
  const other = (await w.post('/api/author/resume-prepare', { flow: 'job2', runId: 'r1', capUsd: '0.30' })).json().hash;
  assert.equal((await w.post('/api/author/resume', { flow: 'job2', runId: 'r1', capUsd: '0.25', hash: other })).status, 409);
  assert.equal((await rq(w.h.port, { method: 'POST', url: '/api/author/resume', body: { flow: 'job2', runId: 'r1', capUsd: '0.25', hash }, headers: { origin: 'http://evil.example' } })).status, 403);
  none();
  assert.equal(starts(), startsBefore, 'no continue process was started by any refusal');
  assert.equal(existsSync(path.join(runDir, HALT_FILE)), true);
  // the second click
  const go = await w.post('/api/author/resume', { flow: 'job2', runId: 'r1', capUsd: '0.25', hash });
  assert.equal(go.status, 202, go.text);
  assert.equal(go.json().signed, true);
  assert.equal(go.json().runId, 'r1', 'the SAME run');
  const end = await until(async () => { const d = (await w.get('/api/runs/job2/r1')).json(); return d?.glyph === '[·]' && d.controls.canStop === false ? d : null; });
  assert.match(end.label, /waiting on you/);
  assert.deepEqual(readdirSync(path.join(flowDir, 'runs')), ['r1'], 'still one run');
  assert.equal(JSON.parse(readFileSync(path.join(runDir, 'signed-values-r1.json'), 'utf8')).values.capUsd, 0.25);
  assert.equal(JSON.parse(readFileSync(path.join(runDir, 'signed-values-r1.json'), 'utf8')).hash, hash);
  assert.equal(sha(path.join(flowDir, 'prose.txt')), filesBefore.prose);
  assert.equal(sha(path.join(flowDir, 'signature.json')), filesBefore.sig);
  const spendRows = readFileSync(path.join(runDir, 'spend.jsonl'), 'utf8').trim().split('\n').length;
  assert.equal(spendRows, 3, 'three priced rounds in all: step 1 once, then the two the cap had cut');
  // the run is parked now: Resume is not offered and the door refuses
  const parked = await w.post('/api/author/resume-prepare', { flow: 'job2', runId: 'r1', capUsd: '0.25' });
  assert.equal(parked.status, 409);
  assert.equal(parked.json().refused, 'not-resumable');
});

test('am4 (e) door: a Resume whose remaining cap does not fit the month is refused at $0 with the one refusal text; a run that is not stopped is not resumable', async () => {
  const w = await world({ limit: 0.3 });
  await w.signedFlow({ capUsd: '0.05' });
  const runDir = path.join(w.root, 'job2', 'runs', 'r1');
  await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs(), runId: 'r1' });
  await until(async () => (await w.get('/api/runs/job2/r1')).json()?.glyph === '[■]');
  const r = await w.post('/api/author/resume-prepare', { flow: 'job2', runId: 'r1', capUsd: '5' });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json().refusals[0].field, 'capUsd');
  assert.match(r.json().refusals[0].say, /left/i);
  assert.equal(existsSync(path.join(runDir, 'signed-values-r1.json')), false);
  // a run that never existed, and one whose flow is not signed
  assert.equal((await w.post('/api/author/resume-prepare', { flow: 'job2', runId: 'nope', capUsd: '0.25' })).status, 404);
  assert.equal((await w.post('/api/author/resume-prepare', { flow: 'nope', runId: 'r1', capUsd: '0.25' })).status, 400);
});

test('am4 (g): the only writers of a signed values version are the two human-hash doors (a source scan, so a new path to a cap needs a reviewed change here)', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = [...walk(path.join(HERE, '..', 'src')), path.join(HERE, '..', 'bin', 'fwdloop')].filter((f) => /\.(js|html)$|fwdloop$/.test(f));
  const callers = files.filter((f) => /\bwriteRunValues\(/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')) && !f.endsWith('runvalues.js'))
    .map((f) => path.relative(path.join(HERE, '..'), f)).sort();
  assert.deepEqual(callers, ['src/panel/authorresume.js', 'src/panel/authorstart.js']);
  // and nothing in the draft/revise doors or the drafter touches a values file
  for (const f of ['src/panel/author.js', 'src/drafter.js', 'src/authoring.js']) {
    assert.doesNotMatch(readFileSync(path.join(HERE, '..', f), 'utf8'), /signed-values|runvalues/, f);
  }
});
