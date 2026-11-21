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
  assert.ok(after.notChecked.items.includes('line 3: phrase "Rust engineer"'), JSON.stringify(after.notChecked)); // M19 am9 item 4: a row that is not a rule reads `<kind> "<words>"`; its reason is the signed row's
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

test('M17 am4 (C1): the AI\'s own Not-checked note is on no card state, and a Drop/Add rebuild does not bring it back', async () => {
  const note = 'line 3: whether the tone suits the role';
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_SUGGEST: SUGGEST, FWDLOOP_TEST_DRAFT_LEDGER: LEDGER, FWDLOOP_TEST_DRAFT_NOTCHECKED: JSON.stringify([note]) } });
  writeFileSync(path.join(w.inDir, 'resume.md'), '# Resume\n\nJo Doe, a Rust engineer for ten years.\n');
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  await settle(w, id, ['questions-open']);
  await childGone(w, id);
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'agree' })).status, 202);
  const g = await settle(w, id, ['green', 'red', 'stopped']);
  await childGone(w, id);
  assert.equal(g.phase, 'green');
  assert.ok(!g.notChecked.items.includes(note), JSON.stringify(g.notChecked));
  assert.equal(g.notChecked.by?.[note], undefined);
  assert.equal((await w.post(`/api/author/${id}/row-edit`, { op: 'add', key: g.list.suggested[0].key })).status, 200);
  const after = await until(async () => { const j = await state(w, id); return j?.phase === 'green' && j.plan !== g.plan ? j : null; });
  assert.ok(!after.notChecked.items.includes(note) && after.notChecked.by?.[note] === undefined, 'a rebuild does not bring it back');
});

test('P4c: a Not-checked note code wrote is [default], a note the person chose is [you]; an AI note is not there (M17 am4, C1); every note of a list plan has exactly one tag (break: drop the noteBy map in src/drafter.js and this reds)', async () => {
  const { fileURLToPath } = await import('node:url');
  const { raw } = await import('./fixtures/m10-map/load.mjs');
  const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'm10-map');
  const MAP = JSON.stringify({ facts: [...JSON.parse(raw(3)).facts, { name: 'sections', from: 'line 3 rule 1', shape: 'phrase', words: ['Select flight'] }] });
  const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR+on+2026-11-18+one+way&hl=en&curr=USD';
  const ai = 'line 3: whether the tone suits the role';
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_MAP: MAP, FWDLOOP_TEST_DRAFT_PAGE: path.join(FIX, 'page-ams-lhr.txt'), FWDLOOP_TEST_DRAFT_NOTCHECKED: JSON.stringify([ai]) } });
  const job = ['Read my resume,', '~ under $150', '~ not a red-eye', '~ nonstop', 'and read the JD to compare it against,', 'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,', '~ plain words only', 'Ask 30m: check it with me,', '~nothing goes out before I accept', 'write it out'].join('\n');
  const id = (await w.post('/api/author/draft', w.card({ flowName: 'job2', job, inputs: `${w.card().inputs}\nflights: ${ADDRESS}` }))).json().draftId;
  let g = await settle(w, id, ['questions-open', 'green', 'red', 'stopped']);
  await childGone(w, id);
  assert.equal(g.phase, 'questions-open');
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'drop' })).status, 202); // the person leaves the rule Not checked
  g = await settle(w, id, ['green', 'red', 'stopped']);
  await childGone(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
  const by = g.notChecked.by ?? {};
  const untagged = [...g.notChecked.items, ...g.notChecked.readNotes].filter((t) => !['you', 'agent', 'default'].includes(by[t]));
  assert.deepEqual(untagged, [], `every note has a tag: ${JSON.stringify(g.notChecked)}`);
  assert.equal(by[ai], undefined, 'the AI\'s own note is dropped');
  assert.ok(![...g.notChecked.items, ...g.notChecked.readNotes].includes(ai));
  assert.ok(Object.values(by).includes('you'), `a note answering the person's own choice stays [you]: ${JSON.stringify(by)}`);
  assert.equal(by[g.notChecked.readNotes[0]], 'default', 'a note code wrote (the page look) reads [default]');
});

/** the flights job of the P4c test above, with one rule answered by `choice` (a button) */
async function flightsPlanAnswered(answer, ai) {
  const { fileURLToPath } = await import('node:url');
  const { raw } = await import('./fixtures/m10-map/load.mjs');
  const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'm10-map');
  const MAP = JSON.stringify({ facts: [...JSON.parse(raw(3)).facts, { name: 'sections', from: 'line 3 rule 1', shape: 'phrase', words: ['Select flight'] }] });
  const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR+on+2026-11-18+one+way&hl=en&curr=USD';
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_MAP: MAP, FWDLOOP_TEST_DRAFT_PAGE: path.join(FIX, 'page-ams-lhr.txt'), FWDLOOP_TEST_DRAFT_NOTCHECKED: JSON.stringify([ai]), FWDLOOP_TEST_DRAFT_SUGGEST: SUGGEST, FWDLOOP_TEST_DRAFT_LEDGER: LEDGER } });
  writeFileSync(path.join(w.inDir, 'resume.md'), '# Resume\n\nJo Doe, a Rust engineer for ten years.\n');
  const job = ['Read my resume,', '~ under $150', '~ not a red-eye', '~ nonstop', 'and read the JD to compare it against,', 'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,', '~ plain words only', 'Ask 30m: check it with me,', '~nothing goes out before I accept', 'write it out'].join('\n');
  const id = (await w.post('/api/author/draft', w.card({ flowName: 'job2', job, inputs: `${w.card().inputs}\nflights: ${ADDRESS}` }))).json().draftId;
  let g = await settle(w, id, ['questions-open', 'green', 'red', 'stopped']);
  await childGone(w, id);
  assert.equal(g.phase, 'questions-open');
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, ...answer })).status, 202);
  g = await settle(w, id, ['green', 'red', 'stopped']);
  await childGone(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
  return { w, id, g };
}

test('P4d: after a Drop it answer, Drop and Add rebuild the same plan at $0 (200, a new draft, no AI call), and the note still says the person chose Not checked (break: leave the left choice out of the rebuild and this reds)', async () => {
  const { w, id, g } = await flightsPlanAnswered({ choice: 'drop' }, 'line 3: whether the tone suits the role');
  const spent = draftingSpent(w.dir(id)).usd;
  const pid = read(w, id, 'pid.json');
  const chose = (s) => [...s.notChecked.items, ...s.notChecked.readNotes].filter((t) => /You chose to leave it Not checked/.test(t));
  assert.ok(chose(g).length >= 1, JSON.stringify(g.notChecked));
  const sug = g.list.suggested[0];
  assert.ok(sug, JSON.stringify(g.list));
  const add = await w.post(`/api/author/${id}/row-edit`, { op: 'add', key: sug.key });
  assert.equal(add.status, 200, add.text);
  const a = await settle(w, id, ['green', 'red', 'stopped']);
  assert.equal(a.phase, 'green');
  assert.notEqual(a.plan, g.plan);
  assert.deepEqual(chose(a), chose(g), 'the person\'s Not checked note is unchanged');
  const row = a.list.rows.find((r) => r.by === 'agent' && r.drop === true);
  assert.ok(row, JSON.stringify(a.list));
  const drop = await w.post(`/api/author/${id}/row-edit`, { op: 'drop', key: row.key });
  assert.equal(drop.status, 200, drop.text);
  const d = await settle(w, id, ['green', 'red', 'stopped']);
  assert.notEqual(d.plan, a.plan);
  // not the first plan's hash: a dropped Suggested row reads "You dropped it." where the first plan never offered it as dropped
  assert.ok(d.list.suggested.some((x) => x.key === sug.key && x.dropped === true), JSON.stringify(d.list));
  assert.deepEqual(chose(d), chose(g));
  assert.equal(draftingSpent(w.dir(id)).usd, spent, '$0');
  assert.equal(read(w, id, 'pid.json'), pid, 'no draft child');
});

test('P4d: after an own-words answer, Add rebuilds the plan at $0 (200, a new draft)', async () => {
  const { w, id, g } = await flightsPlanAnswered({ choice: 'rule', answer: 'departs between 05:00 and 23:59' }, 'line 3: whether the tone suits the role');
  const sug = g.list.suggested[0];
  assert.ok(sug, JSON.stringify(g.list));
  const add = await w.post(`/api/author/${id}/row-edit`, { op: 'add', key: sug.key });
  assert.equal(add.status, 200, add.text);
  const a = await settle(w, id, ['green', 'red', 'stopped']);
  assert.equal(a.phase, 'green');
  assert.notEqual(a.plan, g.plan);
});
