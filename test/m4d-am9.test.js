// M4d amendment 9 (docs/wiki/the-module-ladder.md): an ask step must show you something. Its first read has to be the output
// of an earlier step; the plan checker refuses it at $0 (draft/change/sign only: signed flows still run), the drafter is told.
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
const check = (decl, extra = {}) => validateDeclaration(decl, { arbiter: parsed.arbiter, lines: parsed.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, ...extra });
const fit = (decl) => check(decl, { fitJobLine: true });
// the fixture's green step also needs cells (am8) and, since M10b piece 5, close.sheet instead of the old cell cite; give it so only the ask is in question
const fixed = () => { const d = asDrafted(); d.steps[1].reads = ['aging']; d.steps[1].close = { class: 'green', sheet: [{ id: 'n', rule: 'cells', table: 'aging', claim: 'n', op: 'count', column: 'Amount', covers: [] }] }; return d; };

test('(a) the aging-live-1 ask, as drafted (reads nothing), is refused at $0 with the sentence', () => {
  const r = fit(asDrafted());
  assert.equal(r.ok, false);
  assert.ok(r.reds.some((x) => x.includes('Line 3 asks you to check something, but it reads nothing. Line 3 must read bucket_assignment.')), JSON.stringify(r.reds));
});

test('(a) an ask whose first read is not an earlier step output is refused, same shape', () => {
  const d = fixed(); d.steps[2].reads = ['aging']; // an input role, not an earlier step output
  assert.ok(fit(d).reds.some((x) => x.includes('Line 3 asks you to check something, but its first read, aging, is not made by an earlier step. Line 3 must read bucket_assignment.')), JSON.stringify(fit(d).reds));
  const e = fixed(); e.steps[2].reads = ['human_ok', 'bucket_assignment']; // its own output / a later one is not "earlier"
  assert.ok(fit(e).reds.some((x) => x.includes('Line 3 asks you to check something')));
});

test('(b) the ask reading bucket_assignment, step 2 reading aging: the checker passes', () => {
  const d = fixed(); d.steps[2].reads = ['bucket_assignment'];
  const r = fit(d);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  d.steps[2].reads = ['bucket_assignment', 'aging_text']; // extra reads after the first are fine
  assert.equal(fit(d).ok, true);
});

test('(b) a read on the ask is not a grant: the ask stays a pure stop', () => {
  const d = fixed(); d.steps[2].reads = ['bucket_assignment'];
  assert.equal(fit(d).ok, true);
  d.steps[2].primitives = ['read'];
  assert.ok(fit(d).reds.some((x) => x.includes('is a stop only')));
});

test('(d) the check is draft/change/sign only: without fitJobLine an existing signed flow still validates', () => {
  const r = check(asDrafted());
  assert.equal(r.ok, true, JSON.stringify(r.reds));
});

test('(c) the drafter prompt tells the rule plainly', () => {
  const p = buildSystemPrompt({ menu: cat.primitives.slice(0, 2), lines: parsed.lines, arbiter: parsed.arbiter, factsInfo: [] });
  assert.match(p, /An ask step must read the output of an earlier step, the thing you are asked to check/);
});
