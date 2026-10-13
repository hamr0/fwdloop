// M9 piece 3 (docs/wiki/the-module-ladder.md, "M9" items 1, 2 and am1): setting the signed trigger. Over real HTTP against the M4e world.
// $0: the fake draft provider is never called by a trigger change (asserted by the drafts folder staying as it was).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, readFileSync, symlinkSync, writeFileSync, mkdirSync,
} from 'node:fs';
import path from 'node:path';

import { readFlow, writeFlow } from '../src/flow.js';
import { stripTrigger } from '../src/trigger-line.js';
import { hasGreenRunForJob, triggerLedgerDir } from '../src/panel/authortrigger.js';
import { killChildrenAfter, until } from './m4e-world.mjs';
import {
  CAT, DAILY, greenWorld, ls, readJsonl, seedGreen, setTrigger,
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
  assert.equal(existsSync(path.join(flowDir, 'triggers')), false, 'nothing armed');
});

test('a run that passed an older, different job is not "one green run" either (seeded pre-copy run with another signature)', async () => {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  w.seedPassed('job2'); // signatureHash 'x', no job copy
  const r = await w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY });
  assert.equal(r.json().refused, 'no-green-run');
});

test('set: two clicks, hash-bound; re-signs the SAME plan with only the trigger line added; $0; runs and steps untouched', async () => {
  const { w, flowDir, read } = await greenWorld();
  const before = { prose: text(path.join(flowDir, 'prose.txt')), decl: text(path.join(flowDir, 'declaration.json')), hash: read().signature.flow };
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
  assert.deepEqual(after.arbiter.trigger, DAILY);
  assert.notEqual(after.signature.flow, before.hash);
  assert.equal(stripTrigger(text(path.join(flowDir, 'prose.txt'))).trimEnd(), before.prose.trimEnd(), 'the prose differs by the trigger line only');
  assert.equal(text(path.join(flowDir, 'declaration.json')), before.decl, 'the steps are byte-identical');
  assert.deepEqual(ls(path.join(flowDir, 'runs')), runsBefore);
  assert.deepEqual(ls(path.join(w.root, '.drafts')), draftsBefore, 'no drafter call');
  assert.deepEqual(w.starts(), [], 'nothing started');
  assert.ok(existsSync(path.join(flowDir, 'setup.jsonl')), 'the job\'s setup record is kept');
  // armed for THIS signed trigger
  const led = triggerLedgerDir(flowDir, after.signature.flow);
  assert.ok(readJsonl(path.join(led, 'clock.jsonl')).some((r) => r.kind === 'armed'));
});

test('Must fail (item 2): changing only the trigger keeps the green run; an edit of the steps does not (one function, both directions)', async () => {
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

test('Must fail (am1): a job with a trigger is edited and signed: it is By hand again, and the door is shut until a new green run', async () => {
  const { w, flowDir, read } = await greenWorld();
  assert.equal((await setTrigger(w, DAILY)).status, 200);
  const entry = (await w.get('/api/author/flows')).json().flows.find((f) => f.flow === 'job2');
  assert.equal(entry.edit.ok, true, JSON.stringify(entry.edit));
  const card = { ...w.card(), ...entry.edit.card, flowName: 'job2', editOf: { flow: 'job2', flowHash: entry.edit.flowHash }, capUsd: '0.30' };
  const d = await w.post('/api/author/draft', card);
  assert.equal(d.status, 202, d.text);
  const id = d.json().draftId;
  const g = await until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  assert.equal(g.phase, 'green', JSON.stringify(g));
  const s = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
  assert.equal(s.status, 202, s.text);
  assert.equal(read().arbiter.trigger, null, 'By hand again');
  assert.doesNotMatch(text(path.join(flowDir, 'prose.txt')), /trigger/);
  assert.equal(hasGreenRunForJob(flowDir), false);
  const r = await w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY });
  assert.equal(r.json().refused, 'no-green-run');
});

test('refused while a run of the job is waiting at its ask, with the Edit sentence; nothing signed', async () => {
  const { w, flowDir, read } = await greenWorld();
  const run = await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs(), runId: '' });
  assert.equal(run.status, 202, run.text);
  await until(async () => { const v = (await w.get(`/api/author/start/${run.json().startId}`)).json(); return v.state === 'parked' ? v : null; });
  const hash = read().signature.flow;
  const p = await w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY });
  assert.equal(p.status, 409, p.text);
  assert.equal(p.json().refused, 'run-live');
  assert.match(p.json().say, /finish or stop run-1 first/);
  assert.equal(read().signature.flow, hash);
  assert.equal(existsSync(path.join(flowDir, 'triggers')), false);
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
  const led = triggerLedgerDir(path.join(w.root, 'job2'), read().signature.flow);
  assert.equal(readJsonl(path.join(led, 'seen.jsonl')).filter((r) => r.kind === 'baseline').length, 3);
  assert.equal((await setTrigger(w, { kind: 'file-updated', role: 'resume', path: f })).status, 200);
  assert.deepEqual(read().arbiter.trigger, { kind: 'file-updated', role: 'resume', path: f });
});

test('By hand (null) puts the job back to no trigger through the same two clicks, and a re-signed trigger gets a fresh ledger folder', async () => {
  const { w, flowDir, read } = await greenWorld();
  assert.equal((await setTrigger(w, DAILY)).status, 200);
  const first = triggerLedgerDir(flowDir, read().signature.flow);
  assert.equal((await setTrigger(w, { ...DAILY, hour: 10 })).status, 200);
  const second = triggerLedgerDir(flowDir, read().signature.flow);
  assert.notEqual(first, second, 'an older trigger\'s ledger never carries into a new one');
  assert.equal((await setTrigger(w, null)).status, 200);
  assert.equal(read().arbiter.trigger, null);
  assert.doesNotMatch(text(path.join(flowDir, 'prose.txt')), /trigger/);
});
