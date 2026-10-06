// M4e amendment 3 item 3 (docs/wiki/the-module-ladder.md, "M4e", "Amendment 3", "Revise the plan" and negatives (d) (e) (f) (g) (h) (i)):
// the panel's REVISE door over real HTTP against the real `fwdloop draft --revise-from` child with the test draft provider. $0, no
// network, scratch HOME/config home, every child killed, every dir removed. The drafter-side checks are in test/m4e-revise.test.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, readdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { readFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { spendSummary } from '../src/monthly.js';
import { ceilingCostUsd } from '../src/provider.js';
import { isFwdloopAlive } from '../src/liveness.js';
import { MODEL, RATES } from './drafter-fixture.mjs';
import {
  CANARY, killChildrenAfter, until, world, tmp,
} from './m4e-world.mjs';

killChildrenAfter();

const flowOf = (w, name) => readFlow({ root: w.root, name, catalogue: loadCatalogue().primitives });
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const phaseOf = (w, id, phases) => until(async () => { const j = await state(w, id); return phases.includes(j?.phase) ? j : null; });
/** Wait until the draft's child (first draft or a change) is gone, so the money hold is settled and a new change is not "still finishing". */
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
async function greenWorld(opts = {}) {
  const logDir = tmp('log');
  const log = path.join(logDir, 'revise-calls.jsonl');
  const w = await world({ ...opts, extraEnv: { FWDLOOP_TEST_REVISE_LOG: log, ...(opts.extraEnv ?? {}) } });
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  const g = await phaseOf(w, id, ['green', 'red', 'stopped']);
  assert.equal(g.phase, 'green', JSON.stringify(g));
  await childGone(w, id);
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0);
  return { w, id, g, calls };
}
const revise = (w, id, text) => w.post(`/api/author/${id}/revise`, { text });
/** Revise and wait for the change to settle (green with a different state, or red/stopped note). */
async function reviseAndSettle(w, id, text) {
  const r = await revise(w, id, text);
  assert.equal(r.status, 202, r.text);
  const n = r.json().n;
  const s = await until(async () => { const j = await state(w, id); return j.phase !== 'revising' && j.notes?.some((x) => x.n === n && x.phase !== 'running') ? j : null; });
  await childGone(w, id);
  return s;
}

test('(d) a revise with a note returns a new plan with a new hash; the note is kept on disk and listed; one change used; the old hash signs nothing', async () => {
  const { w, id, g, calls } = await greenWorld();
  const s = await reviseAndSettle(w, id, 'check the sections in the other order');
  assert.equal(s.phase, 'green');
  assert.notEqual(s.hash, g.hash, 'a new plan, a new hash');
  assert.equal(s.plan, 'draft-1');
  assert.equal(s.changesLeft, 1);
  assert.deepEqual(s.notes.map((x) => [x.n, x.text.trim(), x.phase]), [[1, 'check the sections in the other order', 'green']]);
  assert.equal(readFileSync(path.join(w.dir(id), 'note-1.txt'), 'utf8').trim(), 'check the sections in the other order');
  assert.equal(readFileSync(path.join(w.dir(id), 'draft-1', 'note.txt'), 'utf8').trim(), 'check the sections in the other order', 'kept with the draft it made');
  assert.equal(calls(), 1, 'one drafter call');
  // sign with the OLD hash: refused by name, nothing signed
  const before = readdirSync(w.root).sort();
  const old = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
  assert.equal(old.status, 409);
  assert.equal(old.json().refused, 'stale-hash');
  assert.deepEqual(readdirSync(w.root).sort(), before, 'nothing signed');
  assert.equal(existsSync(path.join(w.dir(id), 'signed.json')), false);
  // the page's first click shows the NEW hash; the second click signs THAT plan (the revised one), not the first
  const prep = (await w.post(`/api/author/${id}/sign-prepare`, {})).json();
  assert.equal(prep.hash, s.hash);
  const ok = await w.post(`/api/author/${id}/sign`, { hash: prep.hash });
  assert.equal(ok.status, 202, ok.text);
  const flow = flowOf(w, 'job2');
  assert.ok(flow.ok, JSON.stringify(flow));
  assert.deepEqual(flow.declaration.steps[2].close.shape.sections, ['soft skills', 'professional skills', 'summary of work history blurb'], 'the signed flow is the revised plan');
});

test('(e) a third change on one draft is refused and makes no model call', async () => {
  const { w, id, calls } = await greenWorld();
  await reviseAndSettle(w, id, 'first change');
  const s2 = await reviseAndSettle(w, id, 'second change');
  assert.equal(s2.changesLeft, 0);
  assert.equal(calls(), 2);
  const r = await revise(w, id, 'third change');
  assert.equal(r.status, 409);
  assert.equal(r.json().refused, 'no-changes-left');
  assert.equal(calls(), 2, 'no model call');
  assert.equal(existsSync(path.join(w.dir(id), 'note-3.txt')), false, 'no note written');
  assert.equal(existsSync(path.join(w.dir(id), 'draft-3')), false);
  assert.equal((await state(w, id)).changesLeft, 0);
});

for (const mode of ['ask-primitive', 'drop-ask', 'greedy']) {
  test(`(f) a change whose plan alters an ask or the card's own fields (${mode}) is red: its reds show, the last green plan stays signable`, async () => {
    const { w, id, g } = await greenWorld({ extraEnv: { FWDLOOP_TEST_REVISE_MODE: mode } });
    const s = await reviseAndSettle(w, id, 'make it different');
    assert.equal(s.phase, 'green', 'the card still shows a green plan');
    assert.equal(s.hash, g.hash, 'the last green plan is still the plan on the card');
    assert.equal(s.plan, 'draft');
    assert.equal(s.notes[0].phase, 'red');
    assert.ok(s.notes[0].reds.length > 0, 'the reds are shown');
    assert.equal(s.changesLeft, 1, 'a red change used a change (it was paid)');
    assert.equal(existsSync(path.join(w.dir(id), 'draft-1', 'spec.hash')), false);
    // the last green plan signs
    const ok = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
    assert.equal(ok.status, 202, ok.text);
    assert.ok(flowOf(w, 'job2').ok);
  });
}

test('(f) a change cannot rewrite a job line: the signed plan still carries every line verbatim', async () => {
  const { w, id } = await greenWorld({ extraEnv: { FWDLOOP_TEST_REVISE_MODE: 'goal' } });
  const s = await reviseAndSettle(w, id, 'change the first goal');
  const decl = JSON.parse(readFileSync(path.join(w.dir(id), s.plan, 'declaration.json'), 'utf8'));
  assert.equal(decl.steps[0].goal, 'Read my resume,', 'the goal is the signed line, not the model\'s words');
});

test('(g) a change is booked like a draft call: counted once in Money and the month total', async () => {
  const { w, id } = await greenWorld({ limit: 5 });
  const before = spendSummary({ home: w.home });
  await reviseAndSettle(w, id, 'a change');
  const after = spendSummary({ home: w.home });
  const round = (1000 / 1000) * RATES.in + (200 / 1000) * RATES.out;
  assert.ok(Math.abs(before.total.usd - round) < 1e-9, `first draft is one round: ${before.total.usd}`);
  assert.ok(Math.abs(after.total.usd - 2 * round) < 1e-9, `draft + change is two rounds, each once: ${after.total.usd}`);
  assert.ok(Math.abs(after.month.usd - 2 * round) < 1e-9, 'the month total too');
});

test('(g) over the monthly limit a change refuses at $0: no spend, no dir, no change used, the plan stays', async () => {
  // one ceiling round is $0.0288 and one paid round $0.00054: a $0.03 limit leaves 2c after the first draft's spend, not enough for the change's hold
  assert.equal(ceilingCostUsd(MODEL, undefined, { prices: { rates: RATES } }), 0.0288);
  const { w, id, g, calls } = await greenWorld();
  // the draft's own cap must fit the month (amendment 4 item 1), so the limit is lowered AFTER the first draft
  writeFileSync(path.join(w.home, 'config.json'), JSON.stringify({ monthlyLimitUsd: 0.03 }));
  const spent = spendSummary({ home: w.home }).total.usd;
  const s = await reviseAndSettle(w, id, 'a change');
  assert.equal(s.phase, 'green');
  assert.equal(s.hash, g.hash);
  assert.equal(s.notes[0].phase, 'stopped');
  assert.match(s.notes[0].say, /monthly|limit/i, s.notes[0].say);
  assert.equal(s.changesLeft, 2, 'a refusal at $0 used no change');
  assert.equal(calls(), 0, 'no model call');
  assert.equal(existsSync(path.join(w.dir(id), 'draft-1')), false);
  assert.equal(spendSummary({ home: w.home }).total.usd, spent, 'nothing spent');
});

test('(h) a note carrying a key value is refused and never sent: nothing written, no call, the key is never echoed', async () => {
  const { w, id, calls } = await greenWorld();
  const r = await revise(w, id, `please use ${CANARY} for it`);
  assert.equal(r.status, 400);
  assert.equal(r.json().refused, 'note-key');
  assert.ok(!r.text.includes(CANARY), 'the reply does not echo the key');
  assert.deepEqual(readdirSync(w.dir(id)).filter((n) => /^(note|draft-|revise-)/.test(n)), [], 'no note, no change folder, no log');
  assert.equal(calls(), 0);
  assert.equal((await state(w, id)).changesLeft, 2);
});

test('(i) a refresh during a change re-attaches the newest plan, its changes left and the notes; one change at a time; signing mid-change is refused', async () => {
  const { w, id, g, calls } = await greenWorld({ extraEnv: { FWDLOOP_TEST_REVISE_MODE: 'hang' } });
  const r = await revise(w, id, 'a slow change');
  assert.equal(r.status, 202);
  await until(() => calls() === 1);
  const live = (await w.get('/api/author/live')).json().draft;
  assert.equal(live.draftId, id);
  assert.equal(live.phase, 'revising');
  assert.equal(live.hash, g.hash, 'the plan on show is the last green one');
  assert.equal(live.changesLeft, 1, 'a change in flight is counted once its folder is claimed (before the paid call)');
  assert.deepEqual(live.notes.map((x) => [x.n, x.text.trim(), x.phase]), [[1, 'a slow change', 'running']]);
  const second = await revise(w, id, 'another');
  assert.equal(second.status, 409);
  assert.equal(second.json().refused, 'draft-live');
  assert.equal(calls(), 1, 'no second model call');
  const sign = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
  assert.equal(sign.status, 409, 'cannot sign while a change is being drafted');
  assert.equal(sign.json().refused, 'not-green');
  const ab = await w.post(`/api/author/${id}/abandon`, {});
  assert.equal(ab.status, 200, ab.text);
});

test('a refresh after two changes re-attaches the newest plan with 0 left and both notes', async () => {
  const { w, id } = await greenWorld();
  await reviseAndSettle(w, id, 'first');
  const s = await reviseAndSettle(w, id, 'second');
  const live = (await w.get('/api/author/live')).json().draft;
  assert.equal(live.hash, s.hash);
  assert.equal(live.plan, 'draft-2');
  assert.equal(live.changesLeft, 0);
  assert.deepEqual(live.notes.map((x) => x.text.trim()), ['first', 'second']);
});

test('an empty note, a change on a draft that is not green, and a change on a missing draft are refused at $0', async () => {
  const { w, id, calls } = await greenWorld();
  const empty = await revise(w, id, '   ');
  assert.equal(empty.status, 400);
  assert.equal(empty.json().refused, 'note-empty');
  assert.equal((await revise(w, 'd-0000000000-0000', 'x')).status, 404);
  assert.equal((await revise(w, 'nope', 'x')).status, 404);
  assert.equal((await w.post(`/api/author/${id}/revise`, 'not json')).status >= 400, true);
  const long = await revise(w, id, 'x'.repeat(2001));
  assert.equal(long.json().refused, 'note-long');
  assert.equal(calls(), 0);
  // a red first draft cannot be changed
  const w2 = await world({ mode: 'bad' });
  const id2 = (await w2.post('/api/author/draft', w2.card())).json().draftId;
  await phaseOf(w2, id2, ['red']);
  const red = await revise(w2, id2, 'x');
  assert.equal(red.status, 409);
  assert.equal(red.json().refused, 'not-green');
});
