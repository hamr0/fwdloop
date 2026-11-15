// hamr 2026-11-14: ~ = [you], ! = [agent], $ = [default]. The tag of a check follows where it comes from, the SAME on every surface (plan card, Job tab, Audit grid and Checks fold, Result tab, signed
// readout), for a CSV plan's sheet checks too. $0, fake provider. Each test names the break that turns it red.
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


import { closeRecords } from '../src/try-checks.js';
import { auditChecksOf } from '../src/auditchecks.js';
import { tagged } from '../src/checkwords.js';

/** a green closer's per-check results for the three checks, as closeByClass hands them */
const closedOf = () => ({ verdict: 'green', checks: ['l2r2', 'l2r1', 'l2a1'].map((id) => ({ id, text: `${id} words`, ok: true, result: null })) });

test('a CSV plan: the same check carries the same tag on the card, the Job tab, the Audit grid and fold, the Result tab and the readout (break: let one surface say [agent] for every sheet check)', async () => {
  const { dir } = await csvPlan();
  const d = readJson(dir, 'declaration.json');
  const { lines, arbiter } = doors(dir);
  const expect = { nodup: 'you', over: 'you', bands: 'agent' };
  const tagWord = (by) => `[${by}]`;
  // plan card (the rows the draft saved)
  const card = readJson(dir, 'log.json').checkCard.rows.filter((r) => r.line === 2);
  assert.deepEqual(card.map((r) => r.by), ['you', 'you', 'agent']);
  // Job tab and Result tab block: the block's own text
  const block = checkedLines(d, { lines, csvRoles: ['aging'] }).find((l) => l.line === 2).sheet;
  assert.deepEqual(block.checked.map((c) => c.text.match(/\[(you|agent|default)\]$/)?.[0]), ['[you]', '[you]', '[agent]']);
  // the readout
  const readout = buildReadout({ declaration: d, arbiter, lines, name: 'aging', modelId: MODEL, costUsd: 0, rounds: 1, spendComplete: true, root: '/x' });
  const sheetLines = readout.split('\n').filter((l) => l.includes('sheet check:'));
  assert.deepEqual(sheetLines.map((l) => l.match(/\[(you|agent|default)\]$/)?.[0]), ['[you]', '[you]', '[agent]']);
  // Audit grid rows (the run's tries) and the Result tab's reading of them
  const step = d.steps.find((st) => st.fromLine === 2);
  const grid = closeRecords(step, { claims: {} }, closedOf(), d.checkList);
  assert.deepEqual(grid.map((r) => r.by), ['you', 'you', 'agent']);
  assert.ok(grid.every((r) => !/\[(you|agent)\]/.test(r.text)), 'the page draws the tag from `by`, once');
  assert.deepEqual(grid.map((r) => tagged(r.text, r.by).match(/\[\w+\]$/)[0]), Object.values(expect).map(tagWord));
  // Audit Checks fold: the recorded results are found by the row's part
  const diary = [{ step: step.emits, try: 1, checks: grid }];
  const fold = auditChecksOf(d, diary, null, { lines, csvRoles: ['aging'] });
  assert.deepEqual(fold.checks.map((r) => [r.by, r.result]), [['you', 'passed'], ['you', 'passed'], ['agent', 'passed']]);
});

test('an old plan with no checkList keeps its old words: every sheet check says [agent] (break: tag an unlisted plan by covers)', async () => {
  const { dir } = await csvPlan();
  const d = readJson(dir, 'declaration.json');
  const { checkList: _gone, ...old } = d;
  const { lines } = doors(dir);
  const block = checkedLines(old, { lines, csvRoles: ['aging'] }).find((l) => l.line === 2).sheet;
  assert.ok(block.checked.every((c) => c.text.endsWith('[agent]')), block.checked.map((c) => c.text).join('\n'));
  const grid = closeRecords(old.steps.find((st) => st.fromLine === 2), { claims: {} }, closedOf(), undefined);
  assert.ok(grid.every((r) => r.text.endsWith('[agent]') && r.by === undefined));
});
