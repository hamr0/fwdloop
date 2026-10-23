// M4d amendment 8 (docs/wiki/the-module-ladder.md): a step whose check is green must read an input with cells (a CSV),
// never only a text output of an earlier step. The plan checker refuses it at $0; the drafter is told; a run reads the input.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSignedText } from '../src/signed-text.js';
import { validateDeclaration } from '../src/declaration.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { loadCatalogue } from '../src/catalogue.js';
import { buildSystemPrompt } from '../src/drafter.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const prose = readFileSync(path.join(HERE, 'fixtures', 'm4d-am8.aging.signed.txt'), 'utf8');
const asDrafted = () => JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'm4d-am8.aging.declaration.json'), 'utf8'));
const cat = loadCatalogue();
assert.equal(cat.ok, true);
const parsed = parseSignedText(prose);
assert.equal(parsed.ok, true, JSON.stringify(parsed.reds));
const check = (decl, p = parsed) => validateDeclaration(decl, { arbiter: p.arbiter, lines: p.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true });
const SENTENCE = "Line 2's check needs cells, but it reads only aging_text. Line 2 must read aging.";

test('(a) the aging-live-1 plan as drafted (green step reads only a text output) is refused at $0 with the sentence', () => {
  const r = check(asDrafted());
  assert.equal(r.ok, false);
  assert.ok(r.reds.some((x) => x.includes(SENTENCE)), JSON.stringify(r.reds));
});

test('(a) a green step that reads nothing is refused too; no cells input signed says what is missing', () => {
  const d = asDrafted(); d.steps[1].reads = [];
  assert.ok(check(d).reds.some((x) => x.includes("Line 2's check needs cells, but it reads nothing. Line 2 must read aging.")));
  const noCsv = parseSignedText(prose.replace(/source aging = file:.*/, 'source aging = file:/tmp/aging.docx'));
  assert.equal(noCsv.ok, true, JSON.stringify(noCsv.reds));
  const r = check(asDrafted(), noCsv);
  assert.ok(r.reds.some((x) => x.includes("Line 2's check needs cells, but it reads only aging_text. Line 2 must read a spreadsheet input, and this job signs none.")), JSON.stringify(r.reds));
});

test('(b) the same plan with step 2 reading `aging` passes the checker', () => {
  const sheet = [{ id: 'n', rule: 'cells', table: 'aging', claim: 'n', op: 'count', column: 'Amount', covers: [] }]; // M10b piece 5: a green step on a CSV carries close.sheet, not the old cell cite
  const d = asDrafted(); d.steps[1].reads = ['aging']; d.steps[1].close = { class: 'green', sheet }; d.steps[2].reads = ['bucket_assignment']; // am9: the ask reads what it asks about
  const r = check(d);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const d2 = asDrafted(); d2.steps[1].reads = ['aging_text', 'aging']; d2.steps[1].close = { class: 'green', sheet }; d2.steps[2].reads = ['bucket_assignment'];
  assert.equal(check(d2).ok, true);
});

test('(b) a read naming an unknown id is still refused; a step output may not share an input id', () => {
  const d = asDrafted(); d.steps[1].reads = ['nope'];
  assert.ok(check(d).reds.some((x) => x.includes('"nope" that no earlier step declared')));
  const e = asDrafted(); e.steps[0].emits = 'aging'; e.steps[1].reads = ['aging'];
  assert.ok(check(e).reds.some((x) => x.includes('"aging" is also a signed input')), JSON.stringify(check(e).reds));
});

test('(d) the drafter prompt tells the rule plainly', () => {
  const p = buildSystemPrompt({ menu: cat.primitives.slice(0, 2), lines: parsed.lines, arbiter: parsed.arbiter, factsInfo: [] });
  assert.match(p, /A step whose line has a "green" guardrail must list the CSV input's role in its reads/);
  assert.match(p, /aging/, 'names the cells input(s) this job signs');
});
