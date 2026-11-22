// M19 S9 (docs/wiki/the-module-ladder.md, "M19" S9, section 3.7, amendment D): every shape row has Drop, the person's own `~` row too; a dropped rule reads "You dropped it." under NOT CHECKED with an Add back button;
// a dropped [agent] field reads `<field> (you dropped it)` under SUGGESTED with Add; Drop and Add back rebuild the list at $0 from the draft's saved files and call no AI.
// Cases of the tag's tests/shape-add-back.test.js that fwd can run (the block and the page's own functions), then the real route on a green shape plan (test/m19-s9-world.mjs). Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { CheckBlock, REASON } from '../src/checkblock.js';
import { buildShapes } from '../src/shapebuild.js';
import { cardOfBlock } from '../src/cardlist.js';
import { ncRowsOf } from '../src/checklook.js';
import { draftingSpent } from '../src/draftspend.js';
import { killChildrenAfter } from './m4e-world.mjs';
import { shapePlan, settle, readIn, readJsonIn, RAW_ENTRY } from './m19-s9-world.mjs';

killChildrenAfter();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML_TEXT = readFileSync(path.join(HERE, '../src/panel/index.html'), 'utf8');
const HTML = HTML_TEXT.split('\n');
const fnSource = (/** @type {string} */ name) => {
  const i = HTML.findIndex((l) => new RegExp(`^\\s*function ${name}\\(`).test(l));
  assert.ok(i >= 0, `the page has ${name}`);
  const indent = HTML[i].match(/^\s*/)?.[0] ?? '';
  if (HTML[i].trimEnd().endsWith('}') && !HTML[i].trimEnd().endsWith('{')) return HTML[i];
  let j = i + 1;
  while (j < HTML.length && HTML[j] !== `${indent}}`) j++;
  return HTML.slice(i, j + 1).join('\n');
};
const page = () => {
  const ctx = vm.createContext({});
  vm.runInContext(['escapeXml', 'glyphClass', 'stateDotHTML', 'tagWordOf', 'byTagOf', 'ckTagHtml', 'ckRowHtml', 'ckGroupHtml', 'planFoldHtml', 'planLegend', 'planViewHtml', 'planControlHTML', 'sheetBlockLines', 'planOfState'].map(fnSource).join('\n'), ctx);
  return /** @type {any} */ (ctx);
};
const text = (/** @type {string} */ h) => h.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

const NR = { max: 128, forbidden: ['.', ':', '[', ']'], reserved: null };
const TEXT = 'Resume of Ada. Skills: python, sql. Resume of Alan. Skills: logic.';
const LINES = [{ n: 1, text: 'Read each resume against the job description', rules: ['the blurb is under 60 words', 'matching words is a list of at most 5 words', 'the candidate has a name'] }];
const f = (/** @type {any} */ o) => ({ required: true, bounds: {}, fromRule: null, ...o });
const SUGGEST = { line: 1, fields: [
  f({ name: 'blurb', kind: 'text', bounds: { maxWords: 59 }, fromRule: 1 }),
  f({ name: 'matching', kind: 'list', bounds: { of: 'text', maxEntries: 5 }, fromRule: 2 }),
  f({ name: 'name', kind: 'text', bounds: { minChars: 1 }, fromRule: 3 }),
], extraFields: [f({ name: 'resume', kind: 'text', required: false })], itemCountFrom: null };
function blockOf(withShape = true) {
  const b = new CheckBlock({ texts: { page: TEXT }, labels: ['page'], asks: false, split: true });
  b.fromJob(LINES); b.setGuards(['changed-from-seed'], ['output/']); b.reconcile();
  if (withShape) b.setShape(buildShapes({ lines: LINES, labels: ['page'], suggestions: [SUGGEST], nameRules: NR }));
  return b;
}
const row = (/** @type {CheckBlock} */ b, /** @type {string} */ k) => b.rows.find((r) => r.key === k);
const fieldNames = (/** @type {CheckBlock} */ b) => b.rows.filter((r) => r.kind === 'shape').map((r) => r.key).sort();

// ---- the block: the tag's three cases and its two refusals ---------------------------------------------------------------------------------------------------------
test('Drop then Add back returns the [you] shape row to Checked exactly as before, and the drop leaves the record (break: Add back does not delete the drop and this reds)', () => {
  const b = blockOf();
  const before = JSON.stringify({ r: row(b, 'L1.~2'), f: fieldNames(b) });
  assert.deepEqual(b.rowChoice('L1.~2', 'drop'), { ok: true });
  assert.equal(row(b, 'L1.~2')?.reason, REASON.dropped);
  assert.equal(REASON.dropped, 'You dropped it.');
  assert.deepEqual(b.droppedRulesView().map((x) => x.key), ['L1.~2']);
  assert.deepEqual(b.rowChoice('L1.~2', 'add'), { ok: true });
  assert.equal(row(b, 'L1.~2')?.state, 'built');
  assert.equal(JSON.stringify({ r: row(b, 'L1.~2'), f: fieldNames(b) }), before);
  assert.deepEqual(b.shapeDroppedRecord(), []);
  assert.deepEqual(b.droppedRulesView(), []);
});

test('a Revise after Add back does not re-drop it; a Revise after a plain Drop still does (break: the record keeps an added-back rule and this reds)', () => {
  const b = blockOf();
  b.rowChoice('L1.~2', 'drop');
  const kept = b.shapeDroppedRecord();
  assert.equal(kept.length, 1);
  b.rowChoice('L1.~2', 'add');
  const fresh = blockOf();
  fresh.carryShapeDropped(b.shapeDroppedRecord());
  assert.equal(row(fresh, 'L1.~2')?.state, 'built');
  const still = blockOf();
  still.carryShapeDropped(kept);
  assert.equal(row(still, 'L1.~2')?.state, 'not-checked');
});

test('the tag\'s two refusals, word for word: Add back of a rule not dropped, a second Drop of a dropped one (break: change one word of either and this reds)', () => {
  const b = blockOf();
  assert.deepEqual(b.rowChoice('L1.~3', 'add'), { ok: false, why: 'that check is already on the card' });
  assert.deepEqual(b.droppedRulesView(), []);
  assert.deepEqual(b.rowChoice('L1.~2', 'drop'), { ok: true });
  assert.deepEqual(b.rowChoice('L1.~2', 'drop'), { ok: false, why: 'that check is already dropped' });
});

// ---- the card: Drop is offered on every shape row but code's own, Add back only on a person-dropped rule -------------------------------------------------------------
test('the card offers a Drop on a [you] shape row and an [agent] one, never on the $ count row; only the dropped rule is restorable (break: restorable lists every rule and this reds)', () => {
  const b = blockOf();
  const card = cardOfBlock(b);
  const drop = (/** @type {string} */ k) => card.rows.find((r) => r.key === k)?.drop;
  assert.equal(drop('L1.~1'), true);
  assert.equal(drop('L1.~3'), true);
  assert.equal(drop('L1.$floor'), false, 'a code floor row has no Drop');
  assert.equal(card.restorable, undefined, 'a card with no dropped rule has no restorable key (the saved card of every other job is what it was)');
  b.rowChoice('L1.~2', 'drop');
  assert.deepEqual(cardOfBlock(b).restorable, [{ key: 'L1.~2', line: 1, text: 'matching words is a list of at most 5 words' }]);
  assert.equal(cardOfBlock(b).rows.find((r) => r.key === 'L1.~2')?.state, 'not-checked');
});

test('the page draws "Add back" on the dropped rule\'s Not checked row, through the control only; the read-only drawing has none (break: draw it without the control and the read-only half reds)', () => {
  const b = blockOf();
  b.rowChoice('L1.~2', 'drop');
  const list = { lines: [1], ...cardOfBlock(b) };
  const state = {
    list, planLines: [{ n: 1, text: LINES[0].text, rules: LINES[0].rules }], checked: [], always: [],
    notChecked: { items: [], rows: ncRowsOf([`not checked · "matching words is a list of at most 5 words" — ${REASON.dropped}`, 'not checked · "the candidate has a name" — something else'], {}) },
  };
  const p = page();
  const plan = p.planOfState(state, list);
  assert.deepEqual(plan.ncRows.filter((/** @type {any} */ r) => r.addBack !== undefined).map((/** @type {any} */ r) => [r.text, r.addBack]), [['matching words is a list of at most 5 words', 'L1.~2']]);
  const withCtl = p.planViewHtml(plan, p.planControlHTML);
  assert.equal((withCtl.match(/data-rowop="add"/g) ?? []).length, 1, 'one Add back button, on the dropped rule only');
  assert.match(withCtl, /data-rowkey="L1\.~2"[^>]*>Add back<\/button>/);
  assert.match(text(withCtl), /matching words is a list of at most 5 words.*You dropped it\./);
  const readOnly = p.planViewHtml(plan);
  assert.ok(!/Add back|data-rowop/.test(readOnly), 'the Audit, readout and signed Job tab draw no button');
});

test('page source: the tag\'s one place that draws "Add back" is the confirm card control, and the Drop label stays "Drop" (break: a second "Add back" string and this reds)', () => {
  assert.match(HTML_TEXT, /right: ctl && r\.addBack \? ctl\("add", r\.addBack, "Add back"\) : ""/);
  assert.equal((HTML_TEXT.match(/"Add back"/g) ?? []).length, 1);
  assert.match(HTML_TEXT, /\(label \|\| \(op === "add" \? "Add" : "Drop"\)\)/);
});

test('a dropped [agent] field reads `<field> (you dropped it)` under SUGGESTED with an Add button, and Add brings the row back as it was (break: the page loses the words and this reds)', () => {
  const b = blockOf();
  const key = 'L1.shape.resume';
  const cardRow = () => JSON.stringify(cardOfBlock(b).rows.find((r) => r.key === key));
  const rowBefore = cardRow();
  assert.equal(row(b, key)?.state, 'built', 'a field named in the job is on');
  assert.equal(cardOfBlock(b).rows.find((r) => r.key === key)?.drop, true);
  assert.deepEqual(b.rowChoice(key, 'drop'), { ok: true });
  const sug = cardOfBlock(b).suggested.find((x) => x.key === key);
  assert.deepEqual(sug, { key, line: 1, text: 'resume · text', dropped: true });
  const p = page();
  const h = p.planViewHtml({ lines: [{ n: 1, text: 'one', rules: [], leads: [], checks: [], extra: [] }], suggested: [sug], ncRows: [], notChecked: [], notCheckedBy: {}, readNotes: [], alwaysOn: [] }, p.planControlHTML);
  assert.match(text(h), /resume · text \(you dropped it\)/);
  assert.match(h, /data-rowop="add" data-rowkey="L1\.shape\.resume">Add<\/button>/);
  assert.deepEqual(b.rowChoice(key, 'add'), { ok: true });
  assert.equal(cardRow(), rowBefore, 'the card draws the row as it was');
  assert.deepEqual(b.shapeDroppedRecord(), []);
});

test('a block with no shape is what it was: only a `!` row has a Drop, a `~` rule keeps the old refusal, nothing is restorable (break: offer Drop on every built rule row and this reds)', () => {
  const b = new CheckBlock({ texts: { Changelog: '## [0.54.1] - 2026-11-04\n### Fixed\n- one\n- two\n' }, labels: ['Changelog'], asks: true });
  b.fromJob([{ n: 1, text: 'Summarise the latest release', rule: 'the version must be named', rules: ['the version must be named', 'exactly 3 bullets'] }]);
  b.addLook([
    { line: 1, name: 'release heading', shape: 'phrase', source: 'Changelog', words: ['### Fixed'] },
    { line: 1, name: 'version', shape: 'phrase', source: 'Changelog', words: ['### Fixed'], forRule: 1 },
  ], []);
  b.reconcile();
  const card = cardOfBlock(b);
  assert.ok(card.rows.some((r) => r.by === 'you' && r.state === 'built'), 'fixture: a built [you] rule row');
  assert.deepEqual(card.rows.filter((r) => r.drop).map((r) => r.key), ['L1.fact.release heading'], 'only the `!` fact row has a Drop');
  assert.equal(card.restorable, undefined);
  assert.deepEqual(b.rowChoice('L1.~1', 'drop'), { ok: false, why: 'that check comes from a rule you wrote; edit the job to change it' });
  assert.deepEqual(b.rowChoice('L1.fact.release heading', 'drop'), { ok: true });
});

// ---- the real route on a green shape plan: $0, no call, the same list ----------------------------------------------------------------------------------------------
test('route: Drop then Add back is $0 with no provider call and gives back the same signed list; the card says "You dropped it." with Add back (break: leave the shape replay out of the rebuild and this reds)', async () => {
  const { w, id, g, calls, deny } = await shapePlan();
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
  const list0 = (/** @type {string} */ plan) => { const d = readJsonIn(w, id, `${plan}/declaration.json`); return JSON.stringify([d.checkList, d.steps.map((/** @type {any} */ s) => [s.fromLine, s.close])]); };
  const listA = list0(g.plan);
  deny();
  const spent0 = draftingSpent(w.dir(id)).usd;
  const calls0 = calls();
  const pid0 = readIn(w, id, 'pid.json');
  const drop = await w.post(`/api/author/${id}/row-edit`, { op: 'drop', key: 'L3.~2' });
  assert.equal(drop.status, 200, drop.text);
  const s = await settle(w, id);
  assert.notEqual(s.plan, g.plan);
  const nc = s.notChecked.rows.find((/** @type {any} */ x) => x.text === 'status is one of in progress, closed, finished');
  assert.equal(nc.why, 'You dropped it.');
  assert.deepEqual(s.list.restorable.map((/** @type {any} */ x) => x.key), ['L3.~2']);
  const add = await w.post(`/api/author/${id}/row-edit`, { op: 'add', key: 'L3.~2' });
  assert.equal(add.status, 200, add.text);
  const s2 = await settle(w, id);
  assert.notEqual(s2.plan, s.plan);
  assert.equal(list0(s2.plan), listA, 'the list after Add back is the list before the Drop');
  for (const plan of [s.plan, s2.plan]) {
    const row = JSON.parse(readIn(w, id, `${plan}/spend.jsonl`).trim().split('\n').at(-1) ?? '{}');
    assert.deepEqual([row.costUsd, row.calls, row.rounds], [0, 0, 0]);
  }
  assert.equal(draftingSpent(w.dir(id)).usd, spent0);
  assert.equal(calls(), calls0, 'no provider call of any kind');
  assert.equal(readIn(w, id, 'pid.json'), pid0, 'no draft child');
  assert.equal(readJsonIn(w, id, `${s2.plan}/picks-record.json`).shapeDropped, undefined);
});

test('route: a plan with no saved shape answer in its log is not rebuilt: refused in plain words, nothing written, no call (break: guess a shape list and this reds)', async () => {
  const { w, id, g, calls, deny } = await shapePlan();
  const logPath = `${g.plan}/log.json`;
  const log = readJsonIn(w, id, logPath);
  log.log = log.log.filter((/** @type {any} */ e) => e.kind !== 'shape-map');
  writeFileSync(path.join(w.dir(id), logPath), `${JSON.stringify(log, null, 2)}\n`);
  deny();
  const names = readdirSync(w.dir(id)).sort().join();
  const calls0 = calls();
  const r = await w.post(`/api/author/${id}/row-edit`, { op: 'drop', key: 'L3.~2' });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json().refused, 'changed', 'refused as a plan whose list the saved files do not give back (never a guessed shape)');
  assert.match(r.json().say, /Nothing was changed\.$/);
  assert.equal(readdirSync(w.dir(id)).sort().join(), names);
  assert.equal(calls(), calls0);
});

test('route: an [agent] shape field with a word of the job is dropped to SUGGESTED and added back as it was, the same way (break: the replay builds no agent row and this reds)', async () => {
  const { w, id, g, deny } = await shapePlan({ raw: RAW_ENTRY });
  const key = 'L3.shape.entry';
  const before = g.list.rows.find((/** @type {any} */ r) => r.key === key);
  assert.ok(before && before.by === 'agent' && before.drop === true, JSON.stringify(g.list));
  deny();
  assert.equal((await w.post(`/api/author/${id}/row-edit`, { op: 'drop', key })).status, 200);
  const s = await settle(w, id);
  assert.deepEqual(s.list.suggested.find((/** @type {any} */ x) => x.key === key), { key, line: 3, text: 'entry · text', dropped: true });
  assert.ok(!s.list.rows.some((/** @type {any} */ r) => r.key === key));
  assert.equal((await w.post(`/api/author/${id}/row-edit`, { op: 'add', key })).status, 200);
  const s2 = await settle(w, id);
  assert.deepEqual(s2.list.rows.find((/** @type {any} */ r) => r.key === key), before);
});
