// F252: a green list line (itemShape, no cited) states no lead sentence (M19 am11 item 6); the plan card must not draw its first check row as a lead.
// The lead is explicit (`lead` on each checkedLines entry), not "sentences[0]". Break: make the card push sentences[0] again and the first test reds.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { checkedLines } from '../src/checked.js';
import { parseSignedText } from '../src/signed-text.js';
import { fnSrc } from '../scripts/panel-fixtures/fn-src.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '../src/panel/index.html'), 'utf8');
const FIX = path.join(HERE, 'support/f252');
const decl = JSON.parse(readFileSync(path.join(FIX, 'declaration.json'), 'utf8'));
const parsed = parseSignedText(readFileSync(path.join(FIX, 'prose.txt'), 'utf8'));
assert.equal(parsed.ok, true);
const opts = { askLines: parsed.arbiter.asks.map((/** @type {any} */ x) => x.line), lines: parsed.lines };

const planLeads = (/** @type {any[]} */ checked, /** @type {number} */ n) => {
  const ctx = /** @type {any} */ (vm.createContext({}));
  vm.runInContext(`${fnSrc(PAGE, 'sheetBlockLines', '    ')}\n${fnSrc(PAGE, 'planOfState', '    ')}`, ctx);
  const p = ctx.planOfState({ checked, planLines: [{ n, text: 'x', rules: [] }], notChecked: { items: [] }, always: [] }, { rows: [], suggested: [] });
  return JSON.parse(JSON.stringify(p.lines[0].leads));
};

test('a green itemShape line with no cited has lead null and the card draws no lead row (break: card pushes sentences[0])', () => {
  const c = checkedLines(decl, opts).find((x) => x.line === 2);
  assert.ok(c && c.sentences.length > 0, 'the line has check rows');
  assert.equal(/** @type {any} */ (c).lead, null);
  assert.deepEqual(planLeads(checkedLines(decl, opts), 2), []);
});

test('a cited facts line keeps its lead, as sentences[0]', () => {
  const d = { steps: [{ fromLine: 1, goal: 'g', primitives: ['read'], reads: [], emits: 'e', close: { class: 'green', cited: { source: 'page', facts: [] } } }] };
  const c = checkedLines(d, { askLines: [] })[0];
  const lead = 'Each result must be quoted word for word from the saved page "page", and the machine checks every quote, every value and the count against that copy.';
  assert.equal(/** @type {any} */ (c).lead, lead);
  assert.equal(c.sentences[0], lead);
  assert.deepEqual(planLeads([c], 1), [lead]);
});

test('a softgreen line keeps its lead, and a hitl line its words', () => {
  const d = { steps: [
    { fromLine: 1, goal: 'g', primitives: ['read'], reads: [], emits: 'e', close: { class: 'softgreen', shape: { maxWords: 50 } } },
    { fromLine: 2, goal: 'g', primitives: ['read'], reads: [], emits: 'f', close: { class: 'hitl' } },
  ] };
  const [s, h] = checkedLines(d, { askLines: [] });
  assert.equal(/** @type {any} */ (s).lead, 'The reply is checked as plain text only.');
  assert.equal(s.sentences[0], /** @type {any} */ (s).lead);
  assert.deepEqual(planLeads([s], 1), ['The reply is checked as plain text only.']);
  assert.equal(typeof /** @type {any} */ (h).lead, 'string');
  assert.equal(h.sentences[0], /** @type {any} */ (h).lead);
});
