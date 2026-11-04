// F134 (docs/logs/FINDINGS.md): a .md/.txt/.docx input is never listed in a plain step's reads; the step is granted `read` and reads it by its role.
// The drafter is told that, and the refusal for a doc role in reads says the same.
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
const prose = readFileSync(path.join(HERE, 'fixtures', 'm4d-am8.aging.signed.txt'), 'utf8').replace(/source aging = file:.*/, 'source aging = file:/tmp/aging-notes.md');
const asDrafted = () => JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'm4d-am8.aging.declaration.json'), 'utf8'));
const cat = loadCatalogue();
const parsed = parseSignedText(prose);
assert.equal(parsed.ok, true, JSON.stringify(parsed.reds));

test('the drafter prompt says a document input is never listed in reads: grant read, read it by its role', () => {
  const p = buildSystemPrompt({ menu: cat.primitives.slice(0, 2), lines: parsed.lines, arbiter: parsed.arbiter, factsInfo: [] });
  assert.match(p, /document input \(aging\) is never listed in reads by a step that does not quote it/);
  assert.match(p, /granted "read" \("readDocx" for a \.docx\) and reads it by its role/);
});

test('a doc role in reads of a step that does not quote it is refused with the way out', () => {
  const d = asDrafted(); d.steps[0].reads = ['aging'];
  const r = validateDeclaration(d, { arbiter: parsed.arbiter, lines: parsed.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true });
  assert.ok(r.reds.some((x) => x.includes('reads document input "aging" — leave it out of reads and grant "read" ("readDocx" for .docx); only a step that quotes it lists it')), JSON.stringify(r.reds));
});
