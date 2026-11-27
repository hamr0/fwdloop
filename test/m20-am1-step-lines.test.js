// M20 am1 items 5-6 + am2 (F265 failed, F266 passed): the drafting step lines in child.log, the times joined to draftStepList's list by id, and "Drafted in M:SS · $X".
// Unit tests on src/draftspend.js, then a real panel and a real `fwdloop draft` child with the fake draft provider ($0).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { draftStepList } from '../src/draft-steps.js';
import { draftedLine, makeStepWriter, mmss, stepped, withDraftTimes } from '../src/draftspend.js';
import { killChildrenAfter, until, world, JOB } from './m4e-world.mjs';
import { childGone } from './m19-s9-world.mjs';

killChildrenAfter();
const T0 = Date.parse('2026-11-25T10:00:00.000Z');
const iso = (ms) => new Date(T0 + ms).toISOString();
const ev = (kind, o) => `fwdloop: ${kind} ${JSON.stringify(o)}`;
const dirWith = (lines) => { const d = mkdtempSync(path.join(tmpdir(), 'fwdloop-m20-steps-')); writeFileSync(path.join(d, 'child.log'), `${lines.join('\n')}\n`); return d; };
const LIST = [
  { id: 'thinking', label: 'thinking off', status: 'done', details: [] },
  { id: 'inputs', label: 'inputs · a', status: 'done', details: [] },
  { id: 'drafted', label: 'drafted · m · 1 round · $0.0005', status: 'done', details: [] },
  { id: 'checks', label: 'plan checks', status: 'done', details: [] },
  { id: 'checks-fix', label: 'Fix: x', status: 'done', details: [], note: true },
];
const LINES = [
  ev('step-start', { no: 0, id: 'inputs', label: 'inputs · a', at: iso(0) }), ev('step-end', { no: 0, status: 'done', label: 'inputs · a', at: iso(1000) }),
  ev('step-start', { no: 1, id: 'drafted', label: 'drafted · m · 0 rounds · cost unknown', at: iso(1000) }), ev('step-end', { no: 1, status: 'done', label: 'drafted · m · 1 round · $0.0005', at: iso(43000) }),
  ev('step-start', { no: 2, id: 'checks', label: 'plan checks', at: iso(43000) }), ev('step-end', { no: 2, status: 'done', label: 'plan checks', at: iso(43500) }),
];

test('mmss and 30 s steps (no ticking clock)', () => {
  assert.equal(mmss(42000), '0:42');
  assert.equal(mmss(125000), '2:05');
  assert.equal(stepped(29999), 0);
  assert.equal(stepped(30000), 30000);
  assert.equal(stepped(89999), 60000);
});

test('after the draft: the list is draftStepList\'s unchanged, times joined by id; thinking and a Fix note show none', () => {
  const r = withDraftTimes({ dir: dirWith(LINES), running: false, list: LIST });
  assert.deepEqual(r.list.map((x) => x.label), LIST.map((x) => x.label));
  assert.deepEqual(r.list.map((x) => x.time), [null, 'took 0:01', 'took 0:42', 'took 0:00', null]);
  assert.equal(r.draftSoFar, null);
});

test('joined by id, not by place: the same lines under a list with an extra first line give the same times', () => {
  const shifted = [{ id: 'extra', label: 'e', status: 'done', details: [] }, ...LIST];
  const r = withDraftTimes({ dir: dirWith(LINES), running: false, list: shifted });
  assert.deepEqual(r.list.map((x) => [x.id, x.time]).filter((x) => x[1]), [['inputs', 'took 0:01'], ['drafted', 'took 0:42'], ['checks', 'took 0:00']]);
});

test('a second line with the same id takes the first unused step line, in order', () => {
  const two = [...LINES, ev('step-start', { no: 3, id: 'drafted', label: 'again', at: iso(50000) }), ev('step-end', { no: 3, status: 'done', label: 'again', at: iso(110000) })];
  const list = [LIST[2], LIST[2]];
  assert.deepEqual(withDraftTimes({ dir: dirWith(two), running: false, list }).list.map((x) => x.time), ['took 0:42', 'took 1:00']);
});

test('while it runs: the started steps in order, a running one "M:SS so far" in 30 s steps, "Drafting so far"', () => {
  const live = LINES.slice(0, 3); // inputs ended, drafted running
  const dir = dirWith(live);
  const a = withDraftTimes({ dir, running: true, list: null, nowMs: T0 + 1000 + 29000 });
  assert.deepEqual(a.list.map((x) => [x.id, x.status, x.time]), [['inputs', 'done', 'took 0:01'], ['drafted', 'running', '0:00 so far']]);
  assert.equal(a.draftSoFar, 'Drafting so far: 0:30');
  const b = withDraftTimes({ dir, running: true, list: null, nowMs: T0 + 1000 + 61000 });
  assert.equal(b.list[1].time, '1:00 so far');
  assert.equal(b.draftSoFar, 'Drafting so far: 1:00');
});

test('no step lines: no times, no line (an old draft)', () => {
  const dir = dirWith(['fwdloop: something else']);
  assert.deepEqual(withDraftTimes({ dir, running: false, list: LIST }).list.map((x) => x.time), [null, null, null, null, null]);
  assert.equal(withDraftTimes({ dir, running: true, list: null }).draftSoFar, null);
  assert.equal(draftedLine({ dir, spentUsd: 0.1, complete: true }), null);
});

test('a torn line is skipped, the rest is read', () => {
  const dir = dirWith([ev('step-start', { no: 0, id: 'inputs', label: 'i', at: iso(0) }), 'fwdloop: step-end {"no":0,"sta', ev('step-start', { no: 1, id: 'drafted', label: 'd', at: iso(0) })]);
  assert.deepEqual(withDraftTimes({ dir, running: true, list: null, nowMs: T0 }).list.map((x) => [x.id, x.status]), [['inputs', 'running'], ['drafted', 'running']]);
});

test('Drafted in M:SS · $X: first start to last end, the draft\'s own spend, "at least" when unpriced, none without a cost', () => {
  const dir = dirWith(LINES);
  assert.equal(draftedLine({ dir, spentUsd: 0.0022, complete: true }), 'Drafted in 0:43 \u00B7 $0.0022');
  assert.equal(draftedLine({ dir, spentUsd: 0.05, complete: false }), 'Drafted in 0:43 \u00B7 at least $0.05');
  assert.equal(draftedLine({ dir, spentUsd: null, complete: false }), null);
});

test('Drafted in across a session: first start to last end over the first draft and every revise log', () => {
  const dir = dirWith(LINES);
  writeFileSync(path.join(dir, 'revise-1.log'), `${[ev('step-start', { no: 0, id: 'plan', label: 'revise 1', at: iso(100000) }), ev('step-end', { no: 0, status: 'done', label: 'revise 1', at: iso(160000) })].join('\n')}\n`);
  assert.equal(draftedLine({ dir, spentUsd: 0.01, complete: true }), 'Drafted in 2:40 \u00B7 $0.01');
  const r = withDraftTimes({ dir, file: 'revise-1.log', wholeId: 'plan', running: false, list: [{ id: 'plan', label: 'revise 1', status: 'done', details: [] }, { id: 'plan-fix', label: 'Fix: x', status: 'done', details: [], note: true }] });
  assert.deepEqual(r.list.map((x) => x.time), ['took 1:00', null]);
});

test('the one writer: one start per id, labels from draftStepList, thinking and notes get no line', () => {
  const out = [];
  const write = makeStepWriter((k, r) => out.push([k, r]));
  const part = { ok: false, reds: [], rounds: 0, modelId: 'm', costUsd: null, spendComplete: false, thinking: { asked: 'off', status: 'applied' }, inputs: [{ role: 'a', detail: 'x' }], log: [] };
  write(part, null, false);
  write(part, null, false);
  const fin = { ...part, ok: true, rounds: 2, costUsd: 0.01, spendComplete: true, log: [{ round: 1, kind: 'first', outcome: 'valid' }] };
  write(fin, { steps: [] }, true);
  assert.deepEqual(out.map(([k, r]) => [k, r.id ?? r.no]), [['step-start', 'inputs'], ['step-end', 0], ['step-start', 'drafted'], ['step-end', 1], ['step-start', 'checks'], ['step-end', 2]]);
  const want = draftStepList({ log: fin, declaration: { steps: [] } }).filter((x) => x.id !== 'thinking' && !x.note);
  assert.deepEqual(out.filter(([k]) => k === 'step-end').map(([, r]) => r.label), want.map((x) => x.label));
});

// ---- a real panel and a real child ($0) ----
const poll = (w, id) => async () => (await w.get(`/api/author/${id}`)).json();

test('real child, hung mid-draft: the panel API lists the started steps, one running, "Drafting so far"', async () => {
  const w = await world({ mode: 'hang' });
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  const j = await until(async () => { const s = await poll(w, id)(); return s?.stepList?.length >= 2 ? s : null; }, 60000);
  assert.equal(j.phase, 'drafting');
  assert.equal(j.stepList.filter((s) => s.status === 'running').length, 1);
  assert.match(j.stepList.find((s) => s.status === 'running').time, /^\d+:\d\d so far$/);
  assert.match(j.draftSoFar, /^Drafting so far: \d+:[03]0$/);
});

test('real child, ended: the list is draftStepList\'s, times by id, "Drafted in", no new file; old draft has no times', async () => {
  const w = await world();
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  const j = await until(async () => { const s = await poll(w, id)(); return s?.phase === 'green' ? s : null; }, 60000);
  const dir = path.join(w.dir(id), 'draft');
  const jf = (f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  const want = draftStepList({ log: jf('log.json'), declaration: jf('declaration.json') });
  assert.deepEqual(j.stepList.map((x) => x.label), want.map((x) => x.label));
  for (const x of j.stepList) {
    if (x.id === 'thinking' || x.note) assert.equal(x.time, null);
    else assert.match(x.time, /^took \d+:\d\d$/, x.id);
  }
  assert.equal(j.draftSoFar, undefined);
  assert.match(j.draftedLine, /^Drafted in \d+:\d\d · (at least )?\$\d/);
  assert.deepEqual(readdirSync(w.dir(id)).sort(), ['card.json', 'child.log', 'draft', 'pid.json', 'prose.txt']);
  // an old draft (no step lines) shows no times and no line; the stopped-say never carries step lines
  const log = path.join(w.dir(id), 'child.log');
  writeFileSync(log, readFileSync(log, 'utf8').split('\n').filter((l) => !/^fwdloop: step-(start|end) /.test(l)).join('\n'));
  const old = await poll(w, id)();
  assert.ok(old.stepList.every((x) => x.time === null));
  assert.equal(old.draftedLine, undefined);
});

test('the page has no animated dots and prints the time, the so-far line and the drafted line', () => {
  const page = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
  assert.ok(!page.includes('step-dots'));
  for (const t of ['data-testid="step-time"', 'data-testid="drafting-so-far"', 'data-testid="drafted-line"']) assert.ok(page.includes(t), t);
});

test('real child: a revise shows its own live list, then times and the session\'s Drafted in line', async () => {
  const w = await world();
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  await until(async () => (await poll(w, id)())?.phase === 'green', 60000);
  await childGone(w, id);
  const first = (await poll(w, id)()).draftedLine;
  const r = await w.post(`/api/author/${id}/revise`, w.card({ job: JOB, capUsd: '0.30' }));
  assert.equal(r.status, 202, r.text);
  const j = await until(async () => { const s = await poll(w, id)(); return s?.revises?.length === 1 && s.revises[0].phase === 'green' && s.draftedLine ? s : null; }, 60000);
  const rv = j.revises[0];
  assert.ok(rv.lines.length >= 1);
  assert.match(rv.lines[0].time, /^took \d+:\d\d$/);
  // hamr's live walk: after a revise the FIRST draft's lines keep their times (the state's plan is draft-1, its stepList is still the first draft's)
  assert.equal(j.plan, 'draft-1');
  assert.ok(j.stepList.filter((x) => x.id !== 'thinking' && !x.note).every((x) => /^took \d+:\d\d$/.test(x.time)), JSON.stringify(j.stepList));
  assert.ok(readFileSync(path.join(w.dir(id), 'revise-1.log'), 'utf8').includes('fwdloop: step-start '));
  assert.match(j.draftedLine, /^Drafted in \d+:\d\d \u00B7 (at least )?\$\d/);
  assert.ok(first && j.draftedLine !== undefined);
});

test('real child, hung revise (HANGMARK): the revise lists its own started steps, one running, Drafting so far', async () => {
  const w = await world();
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  await until(async () => (await poll(w, id)())?.phase === 'green', 60000);
  await childGone(w, id);
  const r = await w.post(`/api/author/${id}/revise`, w.card({ job: JOB.replace('Read my resume,', 'Read my resume HANGMARK,') }));
  assert.equal(r.status, 202, r.text);
  const j = await until(async () => { const s = await poll(w, id)(); return s?.phase === 'revising' && s.revises?.[0]?.lines?.length >= 2 ? s : null; }, 60000);
  const lines = j.revises[0].lines;
  assert.equal(lines.filter((l) => l.status === 'running').length, 1);
  assert.match(lines.find((l) => l.status === 'running').time, /^\d+:\d\d so far$/);
  assert.match(j.draftSoFar, /^Drafting so far: \d+:[03]0$/);
});
