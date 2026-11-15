// M16 am4 (docs/wiki/the-module-ladder.md, "M16 amendment 4" (2) and (3)): a CSV job's sheet checks are rows on the plan's list, with a tag, and Drop and Add at $0. With no Drop or Add nothing the
// job checks changes. Fake provider, the synthetic sheet test/fixtures/m10b-sheets/aging.csv, $0. Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draftToDir, signDraft, specHash, buildReadout } from '../src/authoring.js';
import { draft } from '../src/drafter.js';
import { parseSignedText } from '../src/signed-text.js';
import { validateDeclaration } from '../src/declaration.js';
import { loadCatalogue } from '../src/catalogue.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { checkListReds, cardLinesOf, listLinesOf } from '../src/checklistsign.js';
import { rowEditPlan } from '../src/planrebuild.js';
import { sheetCheckReds, sheetCheckWordReds } from '../src/sheetchecks.js';
import { tableChecksFailingOnInput } from '../src/sheetrun.js';
import { parseCsv, sheetTable } from '../src/csv.js';
import { checkedLines } from '../src/checked.js';
import { readSheetDropped, recordPath } from '../src/pickrecord.js';
import { RATES, MODEL, fakeProvider, textReply, toolReply } from './drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGING_CSV = path.join(HERE, 'fixtures', 'm10b-sheets', 'aging.csv');
const ISO = [{ column: 'Due date', format: 'YYYY-MM-DD' }];
const BANDS = [{ name: 'Current', lte: 0 }, { name: '1-30', gte: 1, lte: 30 }, { name: '31-60', gte: 31, lte: 60 }, { name: '61-90', gte: 61, lte: 90 }, { name: '90+', gt: 90 }];
const PROSE = `1. Read the aging report
2. Put each invoice in its overdue bucket as of 2026-10-11: Current, 1-30, 31-60, 61-90, 90+,
   guardrail: every invoice appears exactly once; flag amounts over 500
3. ask 1h: check it with me
4. Write it out

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 4 to file:poc/m0/out
guardrail: source aging = file:${AGING_CSV}
`;
/** three sheet checks: two cover a rule of the person's, one covers none (the AI's own) */
const CHECKS = () => [
  { id: 'nodup', rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Invoice #', covers: [1] },
  { id: 'over', rule: 'cells', table: 'aging', claim: 'over', op: 'rows', where: [{ column: 'Amount', cmp: 'gt', value: 500 }], covers: [2] },
  { id: 'bands', rule: 'cells', table: 'aging', claim: 'bands', op: 'band', column: 'Due date', asOf: '2026-10-11', dateFormats: ISO, bands: BANDS, covers: [] },
];
const decl = (sheet) => ({
  steps: [
    { primitives: ['read'], reads: [], emits: 'aging_text', fromLine: 1, close: { class: 'hitl' } },
    { primitives: ['read'], reads: ['aging'], emits: 'bucket_assignment', fromLine: 2, close: { class: 'green', sheet } },
    { primitives: [], reads: ['bucket_assignment'], emits: 'human_ok', fromLine: 3, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['bucket_assignment', 'human_ok'], emits: 'bucket_report', fromLine: 4, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 2: 'green' },
  unjudgeable: {},
  refused: [],
});
const reply = (text) => ({ ...textReply(text), usage: { inputTokens: 1000, outputTokens: 200 } });
const NO_WORDS = reply(JSON.stringify({ facts: [] }));
const tmp = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-m16am4-'));
const readJson = (dir, f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
const snapshot = (dir) => Object.fromEntries(readdirSync(dir).filter((f) => !f.endsWith('.log')).map((f) => [f, readFileSync(path.join(dir, f), 'utf8')]));

/** a green CSV plan folder, drafted through the real writer with a fake provider; returns its dir and the provider (the call count is the proof of "no AI") */
async function csvPlan(checks = CHECKS()) {
  const work = tmp();
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, PROSE);
  const provider = fakeProvider([NO_WORDS, toolReply(decl(checks))]);
  const dir = path.join(work, 'draft');
  const root = path.join(work, 'flows');
  mkdirSync(root);
  const r = await draftToDir({ proseFile, dir, root, name: 'aging', provider, rates: RATES, modelId: MODEL, env: {}, slot: 'DEEPSEEK_API_KEY' });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  return { dir, root, provider, work };
}
const sheetRows = (d) => d.checkList.filter((r) => r.kind === 'sheet');
const tags = (d) => Object.fromEntries(sheetRows(d).map((r) => [r.key, r.by]));
const doors = (dir) => {
  const parsed = parseSignedText(readFileSync(path.join(dir, 'prose.txt'), 'utf8'));
  return { arbiter: parsed.arbiter, lines: parsed.lines, catalogue: loadCatalogue().primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true };
};

test('a CSV plan\'s sheet checks are rows on the list: [you] where a check covers a rule of the person\'s, [agent] where it covers none (break: leave the sheet checks off the list, or tag every one [agent])', async () => {
  const { dir } = await csvPlan();
  const d = readJson(dir, 'declaration.json');
  assert.deepEqual(tags(d), { 'L2.sheet.l2r1': 'you', 'L2.sheet.l2r2': 'you', 'L2.sheet.l2a1': 'agent' });
  assert.deepEqual(sheetRows(d).map((r) => r.part.part), [0, 1, 2], 'each row points at its own check, in the close\'s order');
  assert.deepEqual(validateDeclaration(d, doors(dir)).ok, true);
  // the card the draft saved: the same three rows, words from fwd\'s sheet-check words, Drop offered on the [agent] row only
  const card = readJson(dir, 'log.json').checkCard;
  const rows = card.rows.filter((r) => r.line === 2);
  assert.deepEqual(rows.map((r) => [r.key, r.by, r.drop]), [['L2.sheet.l2r2', 'you', false], ['L2.sheet.l2r1', 'you', false], ['L2.sheet.l2a1', 'agent', true]]);
  const lead = checkedLines(d, { lines: doors(dir).lines, csvRoles: ['aging'] }).find((l) => l.line === 2);
  assert.ok(lead.sheet.checked.every((c, i) => c.text.startsWith(rows[i].text)), 'the row words are the sheet block\'s own words');
  assert.ok(cardLinesOf(d).has(2), 'the card draws a list on the sheet line');
  assert.equal(listLinesOf(d).has(2), false, 'a sheet row does not make its line a block line');
});

test('a sheet check that is not on the list is refused at sign and at the run-start door (break: let checkListReds skip the sheet parts)', async () => {
  const { dir } = await csvPlan();
  const d = readJson(dir, 'declaration.json');
  const missing = { ...d, checkList: d.checkList.filter((r) => r.key !== 'L2.sheet.l2a1') };
  assert.ok(checkListReds(missing).some((r) => r.includes('line 2') && r.includes('l2a1')), checkListReds(missing).join('\n'));
  // the door sign and the run start share
  const v = validateDeclaration(missing, doors(dir));
  assert.equal(v.ok, false);
  assert.ok(v.reds.some((r) => r.includes('checkList line 2')), v.reds.join('\n'));
  // a row that points at a check the close does not have
  const ghost = { ...d, checkList: [...d.checkList, { ...sheetRows(d)[0], key: 'L2.sheet.ghost', part: { line: 2, part: 9 } }] };
  assert.ok(checkListReds(ghost).some((r) => r.includes('points at a check the close does not run')));
  // sign itself: re-hash the tampered plan so only the list is wrong
  const dj = (o) => `${JSON.stringify(o, null, 2)}\n`;
  const parsed = parseSignedText(readFileSync(path.join(dir, 'prose.txt'), 'utf8'));
  const target = readJson(dir, 'target.json');
  const declarationText = dj(missing);
  const readoutText = buildReadout({ declaration: missing, arbiter: parsed.arbiter, lines: parsed.lines, name: target.name, modelId: MODEL, costUsd: 0, rounds: 1, spendComplete: true, root: target.root });
  const h = specHash({ proseText: readFileSync(path.join(dir, 'prose.txt'), 'utf8'), declarationText, inputFactsText: readFileSync(path.join(dir, 'input-facts.json'), 'utf8'), readoutText, targetText: readFileSync(path.join(dir, 'target.json'), 'utf8') });
  writeFileSync(path.join(dir, 'declaration.json'), declarationText);
  writeFileSync(path.join(dir, 'readout.txt'), readoutText);
  writeFileSync(path.join(dir, 'spec.hash'), `${h.hash}\n`);
  const s = signDraft({ dir, approve: h.hash, signedBy: 'test', env: {} });
  assert.equal(s.ok, false);
  assert.ok(s.reds.some((r) => r.includes('checkList line 2')), s.reds.join('\n'));
});

test('Drop of an [agent] sheet row: $0, no provider call, a NEW plan without that check, the old plan byte for byte; a [you] sheet row has no Drop (break: let Drop reach a [you] row, call the provider, or write into the old plan)', async () => {
  const { dir, provider } = await csvPlan();
  const calls = provider.calls.length;
  const before = snapshot(dir);
  // a [you] row: no Drop
  const refused = rowEditPlan({ planDir: dir, op: 'drop', key: 'L2.sheet.l2r1' });
  assert.equal(refused.ok, false);
  assert.match(refused.say, /rule you wrote/);
  const made = rowEditPlan({ planDir: dir, op: 'drop', key: 'L2.sheet.l2a1' });
  assert.equal(made.ok, true, made.say);
  assert.equal(provider.calls.length, calls, 'a Drop calls no AI');
  assert.deepEqual(snapshot(dir), before, 'the old plan is never written');
  const nd = JSON.parse(made.files['declaration.json']);
  assert.deepEqual(nd.steps[1].close.sheet.map((c) => c.id), ['l2r2', 'l2r1']);
  assert.deepEqual(sheetRows(nd).map((r) => r.key), ['L2.sheet.l2r2', 'L2.sheet.l2r1']);
  assert.deepEqual(validateDeclaration(nd, doors(dir)).ok, true);
  assert.equal(made.files['spec.hash'].trim(), made.hash);
  assert.notEqual(made.hash, before['spec.hash'].trim());
  // the card: the dropped check is offered back (Add), the other rows stay
  const card = JSON.parse(made.files['log.json']).checkCard;
  assert.deepEqual(card.rows.filter((r) => r.line === 2).map((r) => r.key), ['L2.sheet.l2r2', 'L2.sheet.l2r1']);
  assert.deepEqual(card.suggested.map((x) => [x.key, x.dropped === true]), [['L2.sheet.l2a1', true]]);
});

test('Add re-adds a dropped [agent] sheet row at its place; the list is the one it was (break: Add puts it at the end, or does not clear the dropped record)', async () => {
  const [nodup, over, bands] = CHECKS();
  const { dir } = await csvPlan([nodup, bands, over]); // the AI's own check sits in the middle
  const dropped = rowEditPlan({ planDir: dir, op: 'drop', key: 'L2.sheet.l2a1' });
  assert.equal(dropped.ok, true, dropped.say);
  // the new plan folder, as the panel writes it (records are write-once)
  const work2 = tmp();
  const dir2 = path.join(work2, 'draft-1');
  mkdirSync(dir2);
  for (const [f, t] of Object.entries(dropped.files)) writeFileSync(path.join(dir2, f), t);
  const added = rowEditPlan({ planDir: dir2, op: 'add', key: 'L2.sheet.l2a1' });
  assert.equal(added.ok, true, added.say);
  const nd = JSON.parse(added.files['declaration.json']);
  const old = readJson(dir, 'declaration.json');
  assert.deepEqual(nd.steps, old.steps, 'the close is the original one');
  assert.deepEqual(nd.checkList, old.checkList, 'the list is the original one');
  assert.equal(added.hash, readFileSync(path.join(dir, 'spec.hash'), 'utf8').trim(), 'Drop then Add is the plan it began as');
  assert.equal(JSON.parse(added.files['log.json']).checkCard.suggested.length, 0);
  // Add of something that was never dropped is refused, writing nothing
  const bad = rowEditPlan({ planDir: dir, op: 'add', key: 'L2.sheet.l2a1' });
  assert.equal(bad.ok, false);
});

test('with no Drop or Add a CSV job checks exactly as before am4: the close, the sheet reds and the word reds are the ones of the same checks with no list (break: let the list change a close or a sheet red)', async () => {
  const { dir } = await csvPlan();
  const d = readJson(dir, 'declaration.json');
  // the pre-am4 shape: the same declaration with no sheet rows on the list
  const pre = { ...d, checkList: d.checkList.filter((r) => r.kind !== 'sheet') };
  assert.deepEqual(d.steps, pre.steps);
  // M17 am2: code writes the checks (it names them and sets `covers`); the typed fields are the AI's suggestion exactly
  const [nodup, over, bands] = CHECKS();
  assert.deepEqual(d.steps[1].close.sheet, [{ ...over, id: 'l2r2', claim: 'l2r2' }, { ...nodup, id: 'l2r1' }, { ...bands, id: 'l2a1', claim: 'l2a1', covers: [], row: 'agent' }], 'the sheet checks are signed as code built them');
  const tables = { aging: sheetTable(parseCsv(readFileSync(AGING_CSV, 'utf8'))) };
  const line = { n: 2, text: 'x', guardrail: 'every invoice appears exactly once; flag amounts over 500' };
  const verdict = (x) => JSON.stringify([sheetCheckReds(x.steps[1].close.sheet, 2, tables), sheetCheckWordReds(x.steps[1].close.sheet, line)]);
  assert.equal(verdict(d), verdict(pre));
  assert.deepEqual(await tableChecksFailingOnInput(d, tables), await tableChecksFailingOnInput(pre, tables));
  // the door's own answer on the plan, with and without the sheet rows: green both ways
  assert.equal(validateDeclaration(d, doors(dir)).ok, true);
  assert.equal(validateDeclaration(pre, doors(dir)).ok, true, 'a plan whose list has no sheet rows (from before am4) is not examined for them');
  // a red stays red: a sheet check that fails on the sheet fails the same with or without its row
  const bad = { ...d, steps: d.steps.map((st) => (st.fromLine === 2 ? { ...st, close: { ...st.close, sheet: st.close.sheet.map((c) => (c.id === 'l2r2' ? { ...c, where: [{ column: 'Amount', cmp: 'gt', value: 5000000 }] } : c)) } } : st)) };
  assert.equal(verdict(bad), verdict({ ...bad, checkList: pre.checkList }));
});

test('a Revise keeps a sheet Drop: the new AI check with the same id starts dropped again, under Suggested with Add, and Add puts it back (hamr 2026-11-14; break: do not carry sheetDropped into the next draft)', async () => {
  const { dir, work, root } = await csvPlan();
  const dropped = rowEditPlan({ planDir: dir, op: 'drop', key: 'L2.sheet.l2a1' });
  assert.equal(dropped.ok, true, dropped.say);
  const dir2 = path.join(work, 'draft-1');
  mkdirSync(dir2);
  for (const [f, t] of Object.entries(dropped.files)) writeFileSync(path.join(dir2, f), t);
  // the Revise: a fresh draft that follows draft-1 (`--carry <record>`), the AI writing the same three checks again
  const carried = readSheetDropped(recordPath(dir2));
  assert.deepEqual(carried.map((d) => d.key), ['L2.sheet.l2a1'], 'the record keeps the drop');
  const dir3 = path.join(work, 'draft-2');
  const provider = fakeProvider([NO_WORDS, toolReply(decl(CHECKS()))]);
  const r = await draftToDir({ proseFile: path.join(work, 'prose.txt'), dir: dir3, root, name: 'aging', provider, rates: RATES, modelId: MODEL, env: {}, slot: 'DEEPSEEK_API_KEY', carriedSheetDropped: carried });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const d = readJson(dir3, 'declaration.json');
  assert.deepEqual(d.steps[1].close.sheet.map((c) => c.id), ['l2r2', 'l2r1'], 'the AI suggested the band check again; it starts dropped');
  assert.deepEqual(sheetRows(d).map((x) => x.key), ['L2.sheet.l2r2', 'L2.sheet.l2r1']);
  assert.equal(validateDeclaration(d, doors(dir3)).ok, true);
  const card = readJson(dir3, 'log.json').checkCard;
  assert.deepEqual(card.suggested.map((x) => [x.key, x.dropped === true]), [['L2.sheet.l2a1', true]]);
  assert.deepEqual(readSheetDropped(recordPath(dir3)).map((x) => x.key), ['L2.sheet.l2a1'], 'and the next Revise carries it again');
  // Add puts it back where it was
  const added = rowEditPlan({ planDir: dir3, op: 'add', key: 'L2.sheet.l2a1' });
  assert.equal(added.ok, true, added.say);
  assert.deepEqual(JSON.parse(added.files['declaration.json']).steps[1].close.sheet.map((c) => c.id), ['l2r2', 'l2r1', 'l2a1']);
  // with no carried drop the same draft keeps all three (the carry is what drops it)
  const dir4 = path.join(work, 'draft-3');
  const r4 = await draftToDir({ proseFile: path.join(work, 'prose.txt'), dir: dir4, root, name: 'aging', provider: fakeProvider([NO_WORDS, toolReply(decl(CHECKS()))]), rates: RATES, modelId: MODEL, env: {}, slot: 'DEEPSEEK_API_KEY' });
  assert.equal(r4.ok, true);
  assert.equal(readJson(dir4, 'declaration.json').steps[1].close.sheet.length, 3);
});
