// M16 P4 item 3 (docs/wiki/the-module-ladder.md, "M16" item 5 and am3 (4)): the plan card's Drop and Add through the panel's real HTTP door and a real `fwdloop draft` child (fake provider, $0).
// A Drop or an Add rebuilds the list at $0 from the plan's saved files, writes a NEW plan folder, calls no AI and books $0; signing reads the new plan. Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { signDraft } from '../src/authoring.js';
import { isFwdloopAlive } from '../src/liveness.js';
import { draftingSpent } from '../src/draftspend.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';
import { BOX_JOB } from './m4e-box-fixture.mjs';

killChildrenAfter();
const JOB = BOX_JOB.replace('200ish each,', '200ish each,\n~ exactly 3 bullets');
const SUGGEST = JSON.stringify({ checks: [{ line: 3, guardrail: 1, rule: 'listItems', value: 3 }] });
const LEDGER = JSON.stringify({ extra: [{ line: 3, kind: 'phrase', phrase: 'Rust engineer', source: 'resume' }] });
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const settle = (w, id, phases) => until(async () => { const j = await state(w, id); return phases.includes(j?.phase) ? j : null; });
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
const read = (w, id, rel) => readFileSync(path.join(w.dir(id), rel), 'utf8');
const snapshot = (w, id, plan) => Object.fromEntries(readdirSync(path.join(w.dir(id), plan)).filter((f) => !f.endsWith('.log')).map((f) => [f, readFileSync(path.join(w.dir(id), plan, f), 'utf8')]));
/** a green plan with a Suggested phrase on line 3 (the resume holds the words), after one Agree */
async function greenPlan() {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_SUGGEST: SUGGEST, FWDLOOP_TEST_DRAFT_LEDGER: LEDGER } });
  writeFileSync(path.join(w.inDir, 'resume.md'), '# Resume\n\nJo Doe, a Rust engineer for ten years.\n');
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  await settle(w, id, ['questions-open']);
  await childGone(w, id);
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'agree' })).status, 202);
  const g = await settle(w, id, ['green', 'red', 'stopped']);
  await childGone(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
  return { w, id, g };
}

test('Add then Drop: $0, no AI call and no draft child; a NEW plan each time, the old plan\'s files byte for byte; signing reads the newest plan', async () => {
  const { w, id, g } = await greenPlan();
  assert.ok(g.list && g.list.suggested.length === 1, JSON.stringify(g.list));
  const sug = g.list.suggested[0];
  assert.equal(sug.line, 3);
  const before = snapshot(w, id, g.plan);
  const spentBefore = draftingSpent(w.dir(id)).usd;
  const kids = readdirSync(w.dir(id)).filter((f) => f === 'pid.json');
  const pidBefore = read(w, id, 'pid.json');
  const add = await w.post(`/api/author/${id}/row-edit`, { op: 'add', key: sug.key });
  assert.equal(add.status, 200, add.text);
  const after = await settle(w, id, ['green', 'red', 'stopped']);
  assert.equal(after.phase, 'green', JSON.stringify(after));
  assert.notEqual(after.plan, g.plan, 'break: rewrite the old plan in place and this reds');
  assert.notEqual(after.hash, g.hash);
  assert.deepEqual(snapshot(w, id, g.plan), before, 'break: write into the old plan folder and this reds');
  assert.equal(draftingSpent(w.dir(id)).usd, spentBefore, 'a Drop or an Add books $0');
  assert.equal(read(w, id, 'pid.json'), pidBefore, 'no `fwdloop draft` child was started');
  assert.deepEqual(kids, readdirSync(w.dir(id)).filter((f) => f === 'pid.json'));
  // the added row is on the list now, tagged [agent], with a Drop
  const row = after.list.rows.find((r) => r.by === 'agent' && /Rust engineer/.test(r.text));
  assert.ok(row && row.drop === true, JSON.stringify(after.list));
  assert.equal(after.list.suggested.length, 0);
  // the new plan's log has the human row and no model round of its own
  const log = JSON.parse(read(w, id, `${after.plan}/log.json`));
  assert.equal(log.log.at(-1).kind, 'row-edit-human');
  assert.equal(log.log.at(-1).op, 'add');
  // Drop it again: a third plan; the Suggested row is back, marked as dropped
  const drop = await w.post(`/api/author/${id}/row-edit`, { op: 'drop', key: row.key });
  assert.equal(drop.status, 200, drop.text);
  const last = await settle(w, id, ['green', 'red', 'stopped']);
  assert.notEqual(last.plan, after.plan);
  assert.ok(!last.list.rows.some((r) => /Rust engineer/.test(r.text)));
  assert.ok(last.list.suggested.some((s) => s.key === row.key && s.dropped === true), JSON.stringify(last.list));
  // signing reads the newest plan's hash
  const signed = signDraft({ dir: path.join(w.dir(id), last.plan), approve: last.hash, signedBy: 'tester', env: {}, sessionDir: w.dir(id) });
  assert.equal(signed.ok, true, JSON.stringify(signed));
});

test('a [you] row has no Drop and a built row no Add: refused in plain words, nothing is written, the same plan stays green', async () => {
  const { w, id, g } = await greenPlan();
  const names = readdirSync(w.dir(id)).sort();
  const you = g.list.rows.find((r) => r.by === 'you');
  assert.ok(you && you.drop === false, `the card offers no Drop on a rule of yours: ${JSON.stringify(g.list.rows)}`);
  const drop = await w.post(`/api/author/${id}/row-edit`, { op: 'drop', key: you.key });
  assert.equal(drop.status, 409);
  assert.match(drop.json().say, /^That check comes from a rule you wrote; edit the job to change it\. Nothing was changed\.$/, 'break: let Drop reach a `~` row and this reds');
  const addBuilt = await w.post(`/api/author/${id}/row-edit`, { op: 'add', key: you.key });
  assert.equal(addBuilt.status, 409);
  const nokey = await w.post(`/api/author/${id}/row-edit`, { op: 'drop', key: 'L9.nothing' });
  assert.equal(nokey.status, 409);
  const bad = await w.post(`/api/author/${id}/row-edit`, { op: 'delete', key: you.key });
  assert.equal(bad.status, 400);
  assert.deepEqual(readdirSync(w.dir(id)).sort(), names, 'a refusal writes nothing');
  assert.equal((await state(w, id)).hash, g.hash);
});

test('an input that changed since the draft: the list is not rebuilt on guesswork, the person is told and nothing is written', async () => {
  const { w, id, g } = await greenPlan();
  const names = readdirSync(w.dir(id)).sort();
  writeFileSync(path.join(w.inDir, 'resume.md'), '# Resume\n\nNothing about that here.\n');
  const r = await w.post(`/api/author/${id}/row-edit`, { op: 'add', key: g.list.suggested[0].key });
  assert.equal(r.status, 409, r.text);
  assert.match(r.json().say, /^The inputs of this plan have changed since it was drafted/);
  assert.deepEqual(readdirSync(w.dir(id)).sort(), names);
});

test('Add on a line with no guardrail of the person\'s: the row is signed Not checked with the signed words (the class of a line comes from its guardrail), the plan still signs', async () => {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_LEDGER: LEDGER } });
  writeFileSync(path.join(w.inDir, 'resume.md'), '# Resume\n\nJo Doe, a Rust engineer for ten years.\n');
  const id = (await w.post('/api/author/draft', w.card({ job: BOX_JOB }))).json().draftId;
  const g = await settle(w, id, ['green', 'red', 'stopped', 'questions-open']);
  await childGone(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
  assert.equal(g.list.suggested.length, 1);
  assert.equal((await w.post(`/api/author/${id}/row-edit`, { op: 'add', key: g.list.suggested[0].key })).status, 200);
  const after = await settle(w, id, ['green', 'red', 'stopped']);
  assert.equal(after.phase, 'green', JSON.stringify(after));
  const decl = JSON.parse(read(w, id, `${after.plan}/declaration.json`));
  assert.ok(decl.checkList.some((r) => r.state === 'not-checked' && /^This line has no guardrail of yours/.test(r.reason)), 'break: build the row on a line with no guardrail and the sign proof refuses the plan');
  assert.ok(after.notChecked.items.some((x) => x.includes('This line has no guardrail of yours')), JSON.stringify(after.notChecked));
  assert.equal(decl.steps.find((s) => s.fromLine === 3).close.class, 'hitl');
  const signed = signDraft({ dir: path.join(w.dir(id), after.plan), approve: after.hash, signedBy: 'tester', env: {}, sessionDir: w.dir(id) });
  assert.equal(signed.ok, true, JSON.stringify(signed));
});

test('a Revise keeps the last draft\'s Add: the row is still on the list in draft 2, still [agent] with a Drop, and the Revise books no new Suggested for it', async () => {
  const { w, id, g } = await greenPlan();
  assert.equal((await w.post(`/api/author/${id}/row-edit`, { op: 'add', key: g.list.suggested[0].key })).status, 200);
  const added = await settle(w, id, ['green', 'red', 'stopped']);
  assert.ok(added.list.rows.some((r) => r.by === 'agent' && /Rust engineer/.test(r.text)), JSON.stringify(added.list));
  const card = JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8'));
  const r = await w.post(`/api/author/${id}/revise`, { ...card, capUsd: card.capUsd + 1 });
  assert.equal(r.status, 202, JSON.stringify(r.json()));
  await until(async () => (await state(w, id)).plan !== added.plan);
  const s = await settle(w, id, ['green', 'red', 'stopped', 'questions-open']);
  await childGone(w, id);
  assert.equal(s.phase, 'green', JSON.stringify(s.reds ?? s.questions ?? s));
  assert.ok(s.list.rows.some((x) => x.by === 'agent' && /Rust engineer/.test(x.text) && x.drop === true), 'break: do not carry the choices and the Add is gone from draft 2');
  assert.equal(s.list.suggested.length, 0);
  assert.match(read(w, id, `${s.plan}/picks-record.json`), /"rowChoices"/);
});

test('a Revise keeps the last draft\'s Drop: Add then Drop on draft 1, and draft 2 still shows the suggestion as dropped, not offered afresh', async () => {
  const { w, id, g } = await greenPlan();
  assert.equal((await w.post(`/api/author/${id}/row-edit`, { op: 'add', key: g.list.suggested[0].key })).status, 200);
  const added = await settle(w, id, ['green', 'red', 'stopped']);
  const row = added.list.rows.find((x) => x.by === 'agent' && /Rust engineer/.test(x.text));
  assert.equal((await w.post(`/api/author/${id}/row-edit`, { op: 'drop', key: row.key })).status, 200);
  await until(async () => (await state(w, id)).plan !== added.plan);
  const dropped = await settle(w, id, ['green', 'red', 'stopped']);
  assert.ok(dropped.list.suggested.some((x) => x.dropped === true), JSON.stringify(dropped.list));
  const card = JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8'));
  assert.equal((await w.post(`/api/author/${id}/revise`, { ...card, capUsd: card.capUsd + 1 })).status, 202);
  await until(async () => (await state(w, id)).plan !== dropped.plan);
  const s = await settle(w, id, ['green', 'red', 'stopped', 'questions-open']);
  await childGone(w, id);
  assert.equal(s.phase, 'green', JSON.stringify(s.reds ?? s.questions ?? s));
  assert.ok(s.list.suggested.some((x) => x.dropped === true), 'break: do not carry the choices and the suggestion comes back offered afresh');
});
