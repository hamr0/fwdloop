// M9 piece 3 (docs/wiki/the-module-ladder.md, "M9" items 1, 2 and am1): setting the signed trigger. Over real HTTP against the M4e world.
// $0: the fake draft provider is never called by a trigger change (asserted by the drafts folder staying as it was).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, readFileSync, symlinkSync, writeFileSync, mkdirSync,
} from 'node:fs';
import path from 'node:path';

import { readFlow, writeFlow } from '../src/flow.js';
import { hasGreenRunForJob } from '../src/panel/authortrigger.js';
import { readSchedule } from '../src/schedule.js';
import { killChildrenAfter, until } from './m4e-world.mjs';
import {
  CAT, DAILY, clockOf, greenWorld, ls, seedGreen, seenOf, setTrigger,
} from './m9-trigger-world.mjs';
import { world } from './m4e-world.mjs';

killChildrenAfter();
const text = (f) => readFileSync(f, 'utf8');

test('Must fail: the trigger door is refused, at $0, on a job with no green run, and says what to do', async () => {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  const flowDir = path.join(w.root, 'job2');
  const before = [text(path.join(flowDir, 'prose.txt')), text(path.join(flowDir, 'signature.json'))];
  const draftsBefore = ls(path.join(w.root, '.drafts'));
  const p = await w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY });
  assert.equal(p.status, 409, p.text);
  assert.equal(p.json().refused, 'no-green-run');
  assert.match(p.json().say, /run it once by hand and get it right first/i);
  const s = await w.post('/api/author/trigger', { flow: 'job2', trigger: DAILY, hash: 'x'.repeat(64) });
  assert.equal(s.status, 409, s.text);
  assert.equal(s.json().refused, 'no-green-run');
  assert.deepEqual([text(path.join(flowDir, 'prose.txt')), text(path.join(flowDir, 'signature.json'))], before, 'nothing signed');
  assert.deepEqual(ls(path.join(w.root, '.drafts')), draftsBefore, 'no drafter call');
  assert.deepEqual(w.starts(), [], 'nothing started');
  assert.equal(existsSync(path.join(flowDir, 'schedule.json')) || existsSync(path.join(flowDir, 'schedule-ledger.jsonl')), false, 'nothing armed');
});

test('a run that passed an older, different job is not "one green run" either (seeded pre-copy run with another signature)', async () => {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  w.seedPassed('job2'); // signatureHash 'x', no job copy
  const r = await w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY });
  assert.equal(r.json().refused, 'no-green-run');
});

test('set: two clicks, hash-bound; writes schedule.json and arms it; the job (prose, steps, signature) is byte-identical; $0; runs untouched (M9 am20)', async () => {
  const { w, flowDir, read } = await greenWorld();
  const before = { prose: text(path.join(flowDir, 'prose.txt')), decl: text(path.join(flowDir, 'declaration.json')), sigFile: text(path.join(flowDir, 'signature.json')), hash: read().signature.flow };
  const draftsBefore = ls(path.join(w.root, '.drafts'));
  const runsBefore = ls(path.join(flowDir, 'runs'));
  const p = await w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY });
  assert.equal(p.status, 200, p.text);
  assert.match(p.json().hash, /^[0-9a-f]{64}$/);
  assert.equal(read().signature.flow, before.hash, 'the first click signs nothing');
  const stale = await w.post('/api/author/trigger', { flow: 'job2', trigger: { ...DAILY, minute: 5 }, hash: p.json().hash });
  assert.equal(stale.status, 409);
  assert.equal(stale.json().refused, 'stale-hash');
  assert.equal(read().signature.flow, before.hash, 'a hash for another trigger signs nothing');
  const s = await w.post('/api/author/trigger', { flow: 'job2', trigger: DAILY, hash: p.json().hash });
  assert.equal(s.status, 200, s.text);
  const after = read();
  assert.equal(after.ok, true);
  assert.deepEqual(readSchedule(flowDir).trigger, DAILY, 'the schedule is its own signed file');
  assert.equal(after.signature.flow, before.hash, 'the job keeps its signature');
  assert.equal(text(path.join(flowDir, 'prose.txt')), before.prose, 'the prose is byte-identical');
  assert.equal(text(path.join(flowDir, 'signature.json')), before.sigFile);
  assert.equal(text(path.join(flowDir, 'declaration.json')), before.decl, 'the steps are byte-identical');
  assert.deepEqual(ls(path.join(flowDir, 'runs')), runsBefore);
  assert.deepEqual(ls(path.join(w.root, '.drafts')), draftsBefore, 'no drafter call');
  assert.deepEqual(w.starts(), [], 'nothing started');
  assert.ok(existsSync(path.join(flowDir, 'setup.jsonl')), 'the job\'s setup record is kept');
  // armed for THIS signing
  assert.ok(clockOf(flowDir).some((r) => r.kind === 'armed'));
});

test('F2 a schedule action (set, change, cancel) keeps the Job tab reading this job\'s record: same "Not checked" list, recorded:true; setup.jsonl is not touched', async () => {
  const { w, flowDir } = await greenWorld();
  const plan = async (runId) => (await w.get(`/api/runs/job2/${runId}/job`)).json().plan.notChecked;
  const first = await plan('seed-pass');
  assert.equal(first.recorded, true, 'before: the signing wrote its record');
  const old = text(path.join(flowDir, 'setup.jsonl'));
  assert.equal((await setTrigger(w, DAILY)).status, 200);
  assert.equal(text(path.join(flowDir, 'setup.jsonl')), old, 'setup.jsonl is byte-identical: no re-sign, no row');
  seedGreen(w, 'job2', 'after-set');
  assert.deepEqual(await plan('after-set'), first, 'a run of the schedule-signed job reads the same record');
  assert.deepEqual(await plan('seed-pass'), first, 'and so does the run before it');
  assert.equal((await setTrigger(w, null)).status, 200, 'cancel');
  seedGreen(w, 'job2', 'after-cancel');
  assert.deepEqual(await plan('after-cancel'), first, 'after Cancel schedule too');
  assert.deepEqual(await plan('after-set'), first);
});

test('F3 a legacy green run (no job copy, signatureHash = the signature) stays green through schedule actions, until a real Edit; Cancel is never refused for no-green-run (am5)', async () => {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  const flowDir = path.join(w.root, 'job2');
  const read = () => readFlow({ root: w.root, name: 'job2', catalogue: CAT });
  w.seedPassed('job2', 'legacy', { signatureHash: read().signature.flow });
  assert.equal(hasGreenRunForJob(flowDir), true, 'legacy run counts for the job it ran');
  assert.equal((await setTrigger(w, DAILY)).status, 200);
  assert.equal(hasGreenRunForJob(flowDir), true, 'after Sign schedule');
  assert.equal((await setTrigger(w, { kind: 'weekdays', hour: 8, minute: 30 })).status, 200);
  assert.equal(hasGreenRunForJob(flowDir), true, 'after modify');
  // no green run at all (history gone): Cancel is still allowed, both clicks
  writeFileSync(path.join(flowDir, 'history.jsonl'), '');
  assert.equal(hasGreenRunForJob(flowDir), false);
  assert.equal((await setTrigger(w, DAILY)).json().refused, 'no-green-run', 'setting still needs the green run');
  const c = await setTrigger(w, null);
  assert.equal(c.status, 200, c.text);
  assert.equal(existsSync(path.join(flowDir, 'schedule.json')), false);
  // a real Edit (the steps changed) clears green (am1)
  writeFileSync(path.join(flowDir, 'history.jsonl'), `${JSON.stringify({ runId: 'legacy', at: '2026-10-06T10:00:00.000Z', outcome: 'complete', spentUsd: 0.02, spendComplete: true, capUsd: 0.25, wallMs: 1, signatureHash: read().signature.flow })}\n`);
  assert.equal(hasGreenRunForJob(flowDir), true, 'after Cancel schedule');
  const changed = writeFlow({
    root: w.root, name: 'job2', proseText: text(path.join(flowDir, 'prose.txt')).replace('write it out.', 'write it out, then tidy it.'),
    declaration: JSON.parse(text(path.join(flowDir, 'declaration.json'))), signedBy: 'else', signedAt: '2026-10-10T12:00:00Z', catalogue: CAT, replaces: { flowHash: read().signature.flow },
  });
  assert.equal(changed.ok, true, JSON.stringify(changed.reds));
  assert.equal(hasGreenRunForJob(flowDir), false, 'a real Edit clears it');
});

test('Must fail (item 2): changing only the schedule keeps the green run; an edit of the steps does not (one function, both directions)', async () => {
  const { w, flowDir, read } = await greenWorld();
  assert.equal(hasGreenRunForJob(flowDir), true);
  assert.equal((await setTrigger(w, DAILY)).status, 200);
  assert.equal(hasGreenRunForJob(flowDir), true, 'trigger only: still green');
  assert.equal((await setTrigger(w, { kind: 'weekdays', hour: 8, minute: 30 })).status, 200, 'and it can be changed again with no new run');
  // a step change (the plan itself) is not the same job
  const prose = text(path.join(flowDir, 'prose.txt'));
  const changed = writeFlow({
    root: w.root, name: 'job2', proseText: prose.replace('write it out.', 'write it out, then tidy it.'),
    declaration: JSON.parse(text(path.join(flowDir, 'declaration.json'))), signedBy: 'else', signedAt: '2026-10-10T12:00:00Z', catalogue: CAT, replaces: { flowHash: read().signature.flow },
  });
  assert.equal(changed.ok, true, JSON.stringify(changed.reds));
  assert.equal(hasGreenRunForJob(flowDir), false, 'the steps changed: the green run no longer counts');
  const r = await w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY });
  assert.equal(r.json().refused, 'no-green-run', 'and the door is shut again');
});

test('M9 am20 item 3: a run waiting at its ask does not refuse a new schedule (it used to, with the Edit sentence); the job and the waiting run are untouched', async () => {
  const { w, flowDir, read } = await greenWorld();
  const run = await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs(), runId: '' });
  assert.equal(run.status, 202, run.text);
  await until(async () => { const v = (await w.get(`/api/author/start/${run.json().startId}`)).json(); return v.state === 'parked' ? v : null; });
  const hash = read().signature.flow;
  const s = await setTrigger(w, DAILY);
  assert.equal(s.status, 200, s.text);
  assert.equal(read().signature.flow, hash);
  assert.deepEqual(readSchedule(flowDir).trigger, DAILY);
  assert.equal((await w.get(`/api/author/start/${run.json().startId}`)).json().state, 'parked', 'the waiting run is still waiting');
});

test('a file trigger: the role must be one of the job\'s inputs; a missing folder, a folder where a file goes and a symlink are refused by name', async () => {
  const { w, read } = await greenWorld();
  const f = path.join(w.inDir, 'resume.md');
  const sub = path.join(w.inDir, 'inbox'); mkdirSync(sub);
  const link = path.join(w.inDir, 'link.md'); symlinkSync(f, link);
  const bad = [
    [{ kind: 'file-updated', role: 'nope', path: f }, /input/],
    [{ kind: 'file-updated', role: 'resume', path: path.join(w.inDir, 'nowhere', 'missing.md') }, /folder .* does not exist/],
    [{ kind: 'file-updated', role: 'resume', path: sub }, /not a file/],
    [{ kind: 'file-updated', role: 'resume', path: link }, /symlink/],
    [{ kind: 'new-file', role: 'jd', folder: f }, /not a folder/],
    [{ kind: 'new-file', role: 'jd', folder: path.join(w.inDir, 'missing') }, /does not exist/],
    [{ kind: 'daily', hour: 25, minute: 0 }, /hour/],
    ['0 9 * * *', /object|text/],
  ];
  const hash = read().signature.flow;
  for (const [t, re] of bad) {
    const r = await w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: t });
    assert.equal(r.status, 400, `${JSON.stringify(t)} ${r.text}`);
    assert.match(r.json().say, re);
  }
  assert.equal(read().signature.flow, hash, 'nothing signed');
  // good ones: the existing file; the folder, whose files at arm are the baseline (nothing in the seen ledger runs)
  writeFileSync(path.join(sub, 'a.csv'), 'a\n'); writeFileSync(path.join(sub, 'b.csv'), 'b\n'); writeFileSync(path.join(sub, 'c.csv'), 'c\n');
  assert.equal((await setTrigger(w, { kind: 'new-file', role: 'jd', folder: sub })).status, 200);
  assert.equal(seenOf(path.join(w.root, 'job2')).filter((r) => r.kind === 'baseline').length, 3);
  assert.equal((await setTrigger(w, { kind: 'file-updated', role: 'resume', path: f })).status, 200);
  assert.deepEqual(readSchedule(path.join(w.root, 'job2')).trigger, { kind: 'file-updated', role: 'resume', path: f });
});

test('By hand (null) removes schedule.json through the same two clicks, and a re-signed schedule is a NEW signing: an older one\'s rows never carry into it', async () => {
  const { w, flowDir, read } = await greenWorld();
  const sigBefore = read().signature.flow;
  assert.equal((await setTrigger(w, DAILY)).status, 200);
  const first = readSchedule(flowDir).sig;
  assert.equal((await setTrigger(w, { ...DAILY, hour: 10 })).status, 200);
  const second = readSchedule(flowDir).sig;
  assert.notEqual(first, second, 'a new signing');
  assert.equal(clockOf(flowDir).filter((r) => r.kind === 'armed').length, 1, 'this signing\'s own armed row only');
  assert.equal((await setTrigger(w, null)).status, 200);
  assert.equal(existsSync(path.join(flowDir, 'schedule.json')), false);
  assert.equal(read().signature.flow, sigBefore);
  assert.doesNotMatch(text(path.join(flowDir, 'prose.txt')), /trigger/);
  assert.equal((await setTrigger(w, { ...DAILY, hour: 10 })).status, 200, 'the same schedule again after a Cancel');
  assert.notEqual(readSchedule(flowDir).sig, second, 'is a new signing, not the old one back');
});
