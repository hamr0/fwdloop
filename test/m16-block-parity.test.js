// M16 piece 1 parity: fwd's PORT of the check block (src/checkblock.js and the modules it calls) against the F185 POC's vendor copy of bareloop v0.56.0 + f148028e
// (poc/f185-block/vendor/, the whole closure, patterns built from text and all). Same fixtures, same calls, the two must give the same rows, the same close and the same
// questions; the hand-written replacements for the built patterns (the whole-word test, the number test, the month patterns, the limit reader's five patterns, the date finder)
// are compared to the originals on a battery of strings. $0, no key, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSignedText } from '../src/signed-text.js';
import { csvRolesOf, sheetLineBlocks } from '../src/sheetblock.js';
import { CheckBlock } from '../src/checkblock.js';
import * as CL from '../src/checklist.js';
import * as RS from '../src/rubricstep.js';
import * as LS from '../src/labelscan.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '..', 'poc', 'f185-block', 'fixtures');
const VENDOR = path.join(HERE, '..', 'poc', 'f185-block', 'vendor');
const V = {
  block: await import(pathToFileURL(path.join(VENDOR, 'checkblock.js')).href),
  checklist: await import(pathToFileURL(path.join(VENDOR, 'checklist.js')).href),
  rubric: await import(pathToFileURL(path.join(VENDOR, 'rubricstep.js')).href),
  labels: await import(pathToFileURL(path.join(VENDOR, 'labelscan.js')).href),
};
const rd = (p) => fs.readFileSync(path.join(FIX, p), 'utf8');

/** step lines only, in the block's jobLines shape (the F185 POC 2 adapter: fwd's own parser says which lines are ask, send or sheet lines) */
function stepLines(prose, declaration) {
  const p = parseSignedText(prose);
  assert.ok(p.ok, JSON.stringify(p.reds));
  const skip = new Set([...p.arbiter.asks.map((a) => a.line), ...p.arbiter.sends.map((s) => s.line)]);
  const sheet = declaration ? sheetLineBlocks({ declaration, lines: p.lines.map((l) => ({ n: l.n, guardrail: l.guardrail })), csvRoles: csvRolesOf(p.arbiter) }) : [];
  for (const b of sheet) skip.add(b.line);
  return p.lines.filter((l) => !skip.has(l.n)).map((l) => ({ n: l.n, text: l.text, rules: l.guardrail ? l.guardrail.split('; ').map((s) => s.trim()).filter(Boolean) : [] }));
}
const jobs = [
  { id: 'm14-walk-5', prose: rd('m14-walk-5/prose.txt'), texts: { notes: rd('m14-walk-5/notes.md') }, look: null, decl: null },
  { id: 'flights', prose: rd('flights/draft-prose.txt'), texts: { flights: rd('flights/flights.txt') }, look: JSON.parse(rd('flights/page-look.json')), decl: null },
  { id: 'csv', prose: rd('csv/prose.txt'), texts: { file: rd('csv/file.csv') }, look: null, decl: JSON.parse(rd('csv/signed-declaration.json')) },
];
const plain = (x) => JSON.parse(JSON.stringify(x));

// M19 am6 item 4 is the third deliberate difference: a row holds no copy of words (`after`, `grown`, `oneOf`); the vendor's rows do. The parity compares the rows without them.
const noCopy = ({ after: _a, grown: _g, oneOf: _o, ...r }) => r;

function run(Block, j) {
  const b = new Block({ texts: j.texts, labels: Object.keys(j.texts), asks: true, split: true });
  b.fromJob(stepLines(j.prose, j.decl));
  const lk = j.look?.look ?? { facts: [], dropped: [] };
  // fwd's signed R2c (M10 am7 item 2; M17 am4 B3) is the one deliberate difference from the vendor: a grown place's phrases are held by the row and the part. The parity runs on the look without them; the R2c test below holds the rest.
  b.addLook(lk.facts.map((/** @type {any} */ f) => { const { phrases: _p, ...rest } = f; return rest.shape === 'phrase' && rest.words?.length > 1 ? { ...rest, words: [rest.words[0]] } : rest; }), lk.dropped);
  // M19 am5 is the second deliberate difference: a plain phrase fact with several words keeps all of them (any one passes); the vendor keeps the first. The parity runs on the first word; test/m19-am5-phrase-anyof.test.js holds the rest.
  const before = { close: plain(b.reconcile()), rows: plain(b.rows).map(noCopy), open: plain(b.open) };
  b.drive({ answer: (q) => (q.offers.agree ? { choice: 'agree' } : null) });
  const after = { close: plain(b.reconcile()), rows: plain(b.rows).map(noCopy), open: plain(b.open), signed: plain(b.signedRows()) };
  return { before, after };
}

// M17 am1 (a): before any answer the port equals the v0.56.0 vendor row for row; AFTER an Agree it deliberately does not (bareloop v0.57.0 replaces the asked rule, the v0.56.0 vendor
// appended a follower row), so the after side is held to the new rule instead, and compared to the vendor only where no answer changes a rule (the csv job).
const ruleCount = (rows) => rows.filter((r) => r.kind === 'rule').reduce((m, r) => m.set(r.line, (m.get(r.line) ?? 0) + 1), new Map());
for (const j of jobs) {
  test(`parity: ${j.id}: rows, close and questions before an Agree equal the vendor copy; after it the rule count per line is unchanged (one rule in, one rule out)`, () => {
    const a = run(CheckBlock, j);
    const b = run(V.block.CheckBlock, j);
    assert.ok(a.before.rows.length > 0, 'the fixture builds rows (a test that compares two empty lists proves nothing)');
    assert.deepEqual(a.before, b.before);
    assert.deepEqual(ruleCount(a.after.rows), ruleCount(a.before.rows), 'an Agree replaced rules, it added none');
    assert.ok(a.after.rows.every((r) => r.parent === undefined && r.pairWith === undefined), 'no follower row');
    if (j.id === 'csv') assert.deepEqual(a.after, b.after);
  });
}

test('parity: the Agree path on the flights job replaces the asked rules: the vendor (v0.56.0) grew follower rows there, the port grows none', () => {
  const a = run(CheckBlock, jobs[1]);
  const v = run(V.block.CheckBlock, jobs[1]);
  assert.ok(v.after.rows.some((r) => r.parent !== undefined), 'the v0.56.0 vendor does add follower rows on this job (so the test can fail)');
  assert.equal(a.after.rows.some((r) => r.parent !== undefined), false);
  assert.ok(a.after.rows.some((r) => r.kind === 'rule' && r.state === 'built' && r.pick), 'an answered rule is built with its pick');
});

// ---- the literals against the built patterns they replace -------------------------------------------------------------------------------------------------
const SAMPLES = [
  '', 'Nov 4, 2026', 'released 0.54.1 on Nov 4', '4th May 2025', 'May 2025', '04/11/2026', '2026-11-04', 'v1.2.3 and 12.5% and $4.50', 'Sept. 9, 2026 and 9 Sept 2026',
  'between 07:00 and 09:00', 'from 6:00 to 8:30', 'between 07:00 and 09:00 or between 10:00 and 11:00', 'between 7:00 AM and 9:00 PM', 'not before 06:00',
  'under $450', 'under 450 dollars', 'at most 200 euros', 'between $100 and $200', 'between 100 and 200 dollars', '$300 or less', '300 USD or more', 'over $900 or under $450',
  'no more than 150 US dollars', 'at least £20', 'not over $50', 'around 5 pounds', 'Departure: Nov 4, 2026 at 5:00 PM, 14 March 2026, 1,057.65 EUR',
];
test('parity: weekTokens (three month patterns written as literals) equals the vendor', () => {
  for (const s of SAMPLES) assert.deepEqual(CL.weekTokens(s), V.checklist.weekTokens(s), s);
});
test('parity: the limit reader (five patterns written as literals) equals the vendor, for money and time, with and without a fact', () => {
  const facts = [{}, { currency: ['$'] }, { unit: ['US dollars'] }, { currency: ['€'] }];
  for (const s of SAMPLES) {
    for (const shape of ['money', 'time']) {
      for (const f of facts) assert.deepEqual(RS.readLimit(shape, s, f), V.rubric.readLimit(shape, s, f), `${shape} ${JSON.stringify(f)} ${s}`);
      assert.equal(RS.holdsManyBounds(shape, s), V.rubric.holdsManyBounds(shape, s), `${shape} ${s}`);
    }
  }
});
test('parity: the label scan (the date finder written as a literal) equals the vendor on every fixture text', () => {
  for (const j of jobs) for (const [label, text] of Object.entries(j.texts)) assert.deepEqual(LS.scanLabels(text), V.labels.scanLabels(text), `${j.id}/${label}`);
  for (const s of SAMPLES) assert.deepEqual(LS.scanLabels(`Price from ${s} 12\nDate ${s} 5`), V.labels.scanLabels(`Price from ${s} 12\nDate ${s} 5`), s);
});

// M17 am4 (B3): fwd's R2c at the block: the row and the part of a grown place hold the same phrases (one writer, buildLine), so the card, the plan and the Job tab say the same words
test('B3: a place the look grew to phrases is held by the part, every phrase (M19 am6 item 4: the row holds no copy of them)', () => {
  const j = jobs[1];
  const b = new CheckBlock({ texts: j.texts, labels: Object.keys(j.texts), asks: true, split: true });
  b.fromJob(stepLines(j.prose, j.decl));
  b.addLook(j.look.look.facts, j.look.look.dropped);
  const close = b.reconcile();
  const partPhrases = close.parts.flatMap((p) => (p.class === 'fact' ? p.facts : [])).filter((f) => f.shape === 'phrase').map((f) => f.phrase);
  const place = j.look.look.facts.find((f) => Array.isArray(f.phrases) && f.phrases.length);
  assert.ok(place, 'the fixture has a grown place (so the test can fail)');
  for (const ph of place.phrases) assert.ok(partPhrases.includes(ph), `the part holds ${ph}`);
  assert.ok(b.rows.every((r) => r.grown === undefined && r.oneOf === undefined && r.after === undefined), 'no row holds a copy of the words');
});
