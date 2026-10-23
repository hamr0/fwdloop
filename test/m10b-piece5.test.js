// M10b piece 5 (item 8): the old cell cite retires for CSV. A CSV job's drafter is told no cite form, and a green step that reads a CSV with no
// close.sheet (the old cell-cite close) is refused at $0, naming the line. A page quote and a .docx quote are unchanged. Fake data, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSignedText } from '../src/signed-text.js';
import { validateDeclaration } from '../src/declaration.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { loadCatalogue } from '../src/catalogue.js';
import { buildSystemPrompt, buildDeclarationSchema } from '../src/drafter.js';
import { wiredMenu } from '../src/primitives.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const prose = readFileSync(path.join(HERE, 'fixtures', 'm4d-am8.aging.signed.txt'), 'utf8');
const base = () => JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'm4d-am8.aging.declaration.json'), 'utf8'));
const cat = loadCatalogue();
const parsed = parseSignedText(prose);
assert.equal(parsed.ok, true, JSON.stringify(parsed.reds));
const check = (decl) => validateDeclaration(decl, { arbiter: parsed.arbiter, lines: parsed.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true });
const SHEET = [{ id: 'n', rule: 'cells', table: 'aging', claim: 'n', op: 'count', column: 'Amount', where: [{ column: 'Amount', cmp: 'gt', value: 500 }], covers: [] }];
/** the aging plan with step 2 reading the sheet, and the given close on it */
const withClose = (close) => {
  const d = base();
  d.steps[1].reads = ['aging']; d.steps[2].reads = ['bucket_assignment'];
  d.steps[1].close = close;
  return d;
};

test('(a) a CSV job\'s drafter is told no cite form: not in the prompt, not in the close.columns description', () => {
  const p = buildSystemPrompt({ menu: cat.primitives.slice(0, 2), lines: parsed.lines, arbiter: parsed.arbiter, factsInfo: [] });
  assert.doesNotMatch(p, /\bcite/i, 'no cite word anywhere in a CSV-only prompt');
  assert.match(p, /close\.sheet/, 'it is told the bareguard checks instead');
  const cols = buildDeclarationSchema(wiredMenu(['core'])).properties.steps.items.properties.close.properties.columns;
  assert.doesNotMatch(cols.description, /\bcite/i);
});

test('(b) a CSV draft whose green step has the old cell-cite close (no close.sheet) is refused at $0, naming the line', () => {
  const r = check(withClose({ class: 'green', columns: [{ source: 'aging', column: 'Amount' }] }));
  assert.equal(r.ok, false);
  assert.ok(r.reds.some((x) => x.includes("Line 2's check cannot cite cells any more")), JSON.stringify(r.reds));
  const bare = check(withClose({ class: 'green' }));
  assert.ok(bare.reds.some((x) => x.includes("Line 2's check cannot cite cells any more")), JSON.stringify(bare.reds));
});

test('(b) the same step with close.sheet is not refused for citing', () => {
  const r = check(withClose({ class: 'green', sheet: SHEET }));
  assert.ok(!r.reds.some((x) => x.includes('cannot cite cells')), JSON.stringify(r.reds));
});
