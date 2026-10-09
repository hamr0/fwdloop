// M4e amendment 14 piece A (docs/wiki/the-module-ladder.md, "M4e", "Amendment 14 — SIGNED"): Revise reopens the card; no notes. The panel's
// REVISE door over real HTTP against the real `fwdloop draft` child with the test draft provider. $0, no network, scratch HOME.
// Negatives (a) (c) (d) (e) (g) and items 3, 4, 6. The page and the readout's sections line are later pieces.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, readdirSync, readFileSync,
} from 'node:fs';
import path from 'node:path';

import { isFwdloopAlive } from '../src/liveness.js';
import {
  JOB, killChildrenAfter, until, world, tmp,
} from './m4e-world.mjs';

killChildrenAfter();

const NOTE_MARK = 'NOTEMARK-zq81';
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const settle = (w, id) => until(async () => { const j = await state(w, id); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
async function greenWorld(opts = {}) {
  const log = path.join(tmp('log'), 'calls.jsonl');
  const w = await world({ ...opts, extraEnv: { FWDLOOP_TEST_DRAFT_LOG: log, ...(opts.extraEnv ?? {}) } });
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  const g = await settle(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g));
  await childGone(w, id);
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { w, id, g, calls };
}
const edited = (w, mark) => w.card({ job: JOB.replace('Read my resume,', `Read my resume ${mark},`) });
/** Revise with an edited card and wait for the child to finish. */
async function reviseAndSettle(w, id, card) {
  const r = await w.post(`/api/author/${id}/revise`, card);
  assert.equal(r.status, 202, r.text);
  const s = await until(async () => { const j = await state(w, id); return j.phase !== 'revising' && ['green', 'red', 'stopped'].includes(j.phase) ? j : null; });
  await childGone(w, id);
  return s;
}

test('(c) a revise\'s model request carries the card only: no old plan JSON and no note text', async () => {
  const { w, id, g, calls } = await greenWorld();
  const oldPlan = JSON.parse(readFileSync(path.join(w.dir(id), 'draft', 'declaration.json'), 'utf8'));
  const s = await reviseAndSettle(w, id, edited(w, 'EDITED-LINE-k7'));
  assert.equal(s.phase, 'green');
  assert.notEqual(s.hash, g.hash, 'a new plan, a new hash');
  const [first, second] = calls();
  assert.ok(second, 'the revise made a model call');
  const wire = JSON.stringify(second);
  assert.ok(wire.includes('EDITED-LINE-k7'), 'the edited line is in the request');
  assert.ok(!wire.includes(JSON.stringify(oldPlan.steps[0])), 'the old plan is not in the request');
  assert.ok(!wire.includes('Current plan') && !wire.includes('asks for a change') && !wire.includes(NOTE_MARK), 'no note framing, no note');
  const userOf = (c) => c.find((m) => m.role === 'user').content;
  assert.equal(userOf(second), userOf(first), 'the user turn is the same as a first draft\'s');
});

test('(e) a red revise: sign of ANY hash (the old green one included) is refused at $0, nothing signed; the view reports nothing signable and keeps the edited card', async () => {
  const { w, id, g } = await greenWorld({ limit: 5 });
  const s = await reviseAndSettle(w, id, edited(w, 'REDMARK'));
  assert.equal(s.phase, 'red');
  assert.ok(s.reds.length > 0, 'the reds show');
  assert.equal(s.hash, undefined, 'no plan hash to sign');
  assert.equal(s.readout, undefined);
  assert.match(s.card.job, /REDMARK/, 'the card keeps the human\'s edits');
  const before = readdirSync(w.root).sort();
  for (const hash of [g.hash, 'f'.repeat(64), '']) {
    const r = await w.post(`/api/author/${id}/sign`, { hash });
    assert.equal(r.status, 409, `sign ${hash.slice(0, 8)}: ${r.text}`);
    assert.equal(r.json().refused, 'not-green');
  }
  assert.equal((await w.post(`/api/author/${id}/sign-prepare`, {})).status, 409, 'the first click is refused too');
  assert.deepEqual(readdirSync(w.root).sort(), before, 'nothing signed');
  assert.equal(existsSync(path.join(w.dir(id), 'signed.json')), false);
});

test('(a) a POST to revise carrying a note is refused at $0: no model call, nothing written', async () => {
  const { w, id, calls } = await greenWorld();
  const filesBefore = readdirSync(w.dir(id)).sort();
  const n0 = calls().length;
  for (const body of [{ text: NOTE_MARK }, { ...edited(w, 'X'), text: NOTE_MARK }, { ...edited(w, 'X'), note: NOTE_MARK }]) {
    const r = await w.post(`/api/author/${id}/revise`, body);
    assert.equal(r.status, 400, r.text);
    assert.equal(r.json().refused, 'note');
  }
  assert.equal(calls().length, n0, 'no model call');
  assert.deepEqual(readdirSync(w.dir(id)).sort(), filesBefore, 'nothing written');
});

test('(d) two revises used; a third is refused at $0 with no model call; Start over (a new draft of the same card) gives 2 new revises and is one draft call', async () => {
  const { w, id, calls } = await greenWorld({ limit: 5 });
  const s1 = await reviseAndSettle(w, id, edited(w, 'ONE'));
  assert.equal(s1.revisesLeft, 1);
  const s2 = await reviseAndSettle(w, id, edited(w, 'TWO'));
  assert.equal(s2.revisesLeft, 0);
  assert.equal(calls().length, 3);
  const files = readdirSync(w.dir(id)).sort();
  const r = await w.post(`/api/author/${id}/revise`, edited(w, 'THREE'));
  assert.equal(r.status, 409);
  assert.equal(r.json().refused, 'no-revises-left');
  assert.equal(calls().length, 3, 'no model call');
  assert.deepEqual(readdirSync(w.dir(id)).sort(), files, 'nothing written');
  // Start over keeps the fields: the same draft door, the card as it now is
  const so = await w.post('/api/author/draft', s2.card);
  assert.equal(so.status, 202, so.text);
  const ns = await settle(w, so.json().draftId);
  assert.equal(ns.phase, 'green');
  assert.equal(ns.revisesLeft, 2);
  assert.match(ns.card.job, /TWO/);
  assert.equal(calls().length, 4, 'one draft call');
});

test('revise runs the same card checks as a draft: a key value and a bad cap are refused at $0', async () => {
  const { w, id, calls } = await greenWorld();
  const files = readdirSync(w.dir(id)).sort();
  const n0 = calls().length;
  const key = await w.post(`/api/author/${id}/revise`, w.card({ job: `${JOB}\nand ${'sk-canary-M4E-piece2b-3c9d1e7a5b2f4860bb77'}` }));
  assert.equal(key.status, 400);
  assert.ok(!key.text.includes('sk-canary'), 'the key is never echoed');
  const cap = await w.post(`/api/author/${id}/revise`, w.card({ capUsd: '0' }));
  assert.equal(cap.status, 400);
  assert.equal(cap.json().refused, 'card');
  assert.equal(calls().length, n0);
  assert.deepEqual(readdirSync(w.dir(id)).sort(), files);
});

test('(g) a refresh after a revise brings back the newest plan, revises left and the card as last submitted; the revise is booked once in setup.jsonl at sign with the card and no note row', async () => {
  const { w, id } = await greenWorld({ limit: 5 });
  const s = await reviseAndSettle(w, id, edited(w, 'LAST-SUBMITTED'));
  const live = (await w.get('/api/author/live')).json().draft;
  assert.equal(live.hash, s.hash);
  assert.equal(live.plan, 'draft-1');
  assert.equal(live.revisesLeft, 1);
  assert.match(live.card.job, /LAST-SUBMITTED/);
  const ok = await w.post(`/api/author/${id}/sign`, { hash: s.hash });
  assert.equal(ok.status, 202, ok.text);
  const rows = readFileSync(path.join(w.root, 'job2', 'setup.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => r.kind), ['card', 'draft', 'card', 'revise', 'sign']);
  assert.match(rows[2].card.job, /LAST-SUBMITTED/);
  assert.equal(rows[3].hash, s.hash);
  assert.equal(rows[3].verdict, 'green');
  assert.ok(rows[3].costUsd > 0);
});
