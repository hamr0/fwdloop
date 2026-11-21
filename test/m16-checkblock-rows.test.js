// borrowed-from: bareloop tests/checkblock-rows.test.js@v0.56.0 (3383cce + f148028e for the agree-follower tests), imports pointed at fwd's files, fixtures under test/fixtures/m16-block/
// The rows of the check block, ported from the tests of the deleted list functions (buildLedger, applyLedger, resolveLedger, ensureCited: tests/checklist.test.js A1/A6-A9).
// Each behaviour that still exists is asserted on the block (src/checkblock.js): the rows' marks, the word proof, a `~` rule that wins, the `$` defaults, the week-only
// refusal, the empty list's record. A behaviour that changed by design says so in a comment (docs/product/ITEM33-BUILD.md "CHECK BLOCK BUILD SPEC" and hamr's rulings of 2026-11-12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CheckBlock, REASON } from '../src/checkblock.js';
import { ledgerRecord, isEmptyList, EMPTY_LIST_WORDS, WEEK_ONLY_WORDS } from '../src/checklist.js';

const TEXT = '## [0.54.1] - 2026-11-04\n### Fixed\n- one\n- two\n';
const jobLines = [{ n: 1, text: 'Summarise the latest release', rule: 'exactly 3 bullets', rules: ['exactly 3 bullets'] }];
const look = { facts: [
  { line: 1, name: 'release heading', shape: 'phrase', source: 'Changelog', words: ['### Fixed'] },
  { line: 1, name: 'invented', shape: 'phrase', source: 'Changelog', words: ['zzz nowhere'] },
  { line: 1, name: 'bullets', shape: 'number', source: 'Changelog', words: [], forRule: 1 },
], dropped: [] };

/** @param {{jobLines?: any[], look?: any, texts?: Record<string, string>, labels?: string[], asks?: boolean}} [o] */
function made({ jobLines: jl = jobLines, look: lk = look, texts = { Changelog: TEXT }, labels = Object.keys(texts), asks = true } = {}) {
  const b = new CheckBlock({ texts, labels, asks });
  b.fromJob(jl);
  b.addLook(lk.facts ?? [], lk.dropped ?? []);
  b.reconcile();
  return b;
}
const by = (/** @type {CheckBlock} */ b, /** @type {string} */ k) => b.rows.find((r) => r.key === k);

test('A1 rows: a ~ rule is by you, a look fact by the agent, the word proof leaves an invented word Not checked, a fact tied to a ~ rule is a LINK on it (design change: it was dropped), every key is unique', () => {
  const b = made();
  assert.equal(by(b, 'L1.~1')?.by, 'you');
  assert.equal(by(b, 'L1.fact.release heading')?.state, 'built');
  assert.equal(by(b, 'L1.fact.release heading')?.by, 'agent');
  assert.equal(by(b, 'L1.fact.invented')?.state, 'not-checked');
  assert.match(String(by(b, 'L1.fact.invented')?.reason), /not in the input/);
  // by design (spec section 3, addLook): a look fact tied to a `~` rule is a link on that row, never a drop and never a second row (a COUNTING rule, "exactly 3 bullets", is the pick path's: its tied fact stays a fact of its own)
  assert.equal(by(b, 'L1.fact.bullets')?.by, 'agent');
  const tied = made({ jobLines: [{ n: 1, text: 'Say it', rules: ['the version must be named'] }], look: { facts: [{ line: 1, name: 'version', shape: 'phrase', source: 'Changelog', words: ['### Fixed'], forRule: 1 }] } });
  assert.equal(by(tied, 'L1.fact.version'), undefined);
  assert.equal(by(tied, 'L1.~1')?.links?.[0].name, 'version');
  assert.equal(new Set(b.rows.map((r) => r.key)).size, b.rows.length);
});

test('A1 extra proposals as edits: a count has no words; a phrase must be in the input; a ~ rule that names the number wins; a cited or an unknown input is refused alone', () => {
  const b = made({ look: { facts: [] } });
  const rec = b.applyDelta({ edits: [
    { op: 'add', kind: 'cited', line: 1, source: 'Changelog' },
    { op: 'add', kind: 'count', line: 1, min: 1, max: 1 },
    { op: 'add', kind: 'phrase', line: 1, name: 'fixed heading', source: 'Changelog', words: ['### Fixed'] },
    { op: 'add', kind: 'phrase', line: 1, name: 'absent', source: 'Changelog', words: ['not in the file'] },
    { op: 'add', kind: 'phrase', line: 1, name: 'other', source: 'Nope', words: ['### Fixed'] },
  ] });
  b.reconcile();
  assert.deepEqual(rec.edits.map((e) => e.accepted), [false, true, true, false, false]);
  assert.match(rec.edits[0].refusedBecause, /an add is a fact, a phrase or a count/);
  assert.match(rec.edits[3].refusedBecause, /not in the input/);
  assert.match(rec.edits[4].refusedBecause, /not one of the inputs/);
  assert.equal(b.rows.find((r) => r.kind === 'count')?.state, 'built');
  assert.equal(b.rows.find((r) => r.kind === 'phrase')?.state, 'built');
  // a `~` rule that names the number wins over a count row that repeats it
  const c = made({ look: { facts: [] } });
  c.applyDelta({ edits: [{ op: 'add', kind: 'count', line: 1, max: 3 }] });
  c.reconcile();
  const count = c.rows.find((r) => r.kind === 'count');
  assert.equal(count?.state, 'not-checked');
  assert.match(String(count?.reason), /a ~ rule already says it/);
});

test('an add whose input label is not one of the job inputs is refused ALONE and never reaches the draft gate as a red on code\'s own plan (fail-first: before this guard the plan stopped on rubric-part-source)', () => {
  const b = made({ look: { facts: [] }, jobLines: [{ n: 1, text: 'Summarise', rules: [] }] });
  const rec = b.applyDelta({ edits: [{ op: 'add', kind: 'phrase', line: 1, name: 'x', source: 'Nope', words: ['### Fixed'] }] });
  assert.equal(rec.edits[0].accepted, false);
  const c = b.reconcile();
  assert.ok(c.parts.every((p) => p.source === undefined || p.source === 'Changelog'));
});

test('A1 $ rows: a text line with one input gets a $ cited row (by default, built); a text line after a fact line also gets the numbers tie; the floor is shown, never a real check', () => {
  const textJob = [{ n: 1, text: 'Find the release heading', rules: [] }, { n: 2, text: 'Summarise it', rules: [] }];
  const b = made({ jobLines: textJob, look: { facts: [look.facts[0]] } });
  const c1 = by(b, 'L1.$cited');
  assert.equal(c1?.state, 'not-checked', 'a fact line has no text to quote');
  assert.equal(c1?.reason, REASON.onePerLine);
  const c2 = by(b, 'L2.$cited');
  assert.deepEqual([c2?.by, c2?.from, c2?.state, c2?.source], ['default', 'default', 'built', 'Changelog']);
  const n2 = by(b, 'L2.$numbers');
  assert.deepEqual([n2?.kind, n2?.state], ['numbers', 'built']); // M19 am6 item 4: the row no longer holds the `after` copy; the line numbers are the part's `from`
  assert.equal(by(b, 'L1.$floor')?.kind, 'floor');
  assert.equal(by(b, 'L1.$floor')?.state, 'built');
  assert.equal(new Set(b.rows.map((r) => r.key)).size, b.rows.length);
  assert.equal(b.hasBuiltCheck(), true);
});

test('A1 $ rows: more than one input -> the $ cited row is Not checked with its reason; a fact line owns no text to quote (A9: its $ cited row is Not checked "finds facts")', () => {
  const b = made({ look: { facts: [] }, texts: { A: 'x', B: 'y' }, labels: ['A', 'B'] });
  const c = by(b, 'L1.$cited');
  assert.equal(c?.state, 'not-checked');
  assert.match(String(c?.reason), /more than one input/);
  const f = made({ look: { facts: [look.facts[0]] } });
  assert.match(String(by(f, 'L1.$cited')?.reason), /finds facts/);
});

test('A7 the default cited part is ONE code-made part on a text stage and none on a fact stage; the AI never writes it (zero AI-format parts)', () => {
  const b = made({ look: { facts: [] }, jobLines: [{ n: 1, text: 'Summarise', rules: [] }] });
  const c = b.build();
  const cited = c.parts.filter((p) => p.check === 'cited');
  assert.equal(cited.length, 1);
  assert.equal(cited[0].source, 'Changelog');
  const f = made({ look: { facts: [look.facts[0]] }, jobLines: [{ n: 1, text: 'Find it', rules: [] }] });
  assert.equal(f.build().parts.some((p) => p.check === 'cited'), false);
  // a fact row that cannot be built turns the line into a text line after all: it gets the default
  const g = made({ look: { facts: [look.facts[1]] }, jobLines: [{ n: 1, text: 'Find it', rules: [] }] });
  assert.deepEqual(g.build().parts.map((p) => p.check), ['cited']);
});

test('A8 a look fact or a phrase proposal whose words hold a version or a date: a phrase fits a place rule and is built; a date-shape fact stays Not checked with the week-only words; a ~ rule naming a version is untouched', () => {
  const lk = { facts: [
    { line: 1, name: 'release version', shape: 'phrase', source: 'Changelog', words: ['0.54.1'] },
    { line: 1, name: 'release date', shape: 'date', source: 'Changelog', words: ['2026-11-04'] },
    { line: 1, name: 'heading', shape: 'phrase', source: 'Changelog', words: ['### Fixed'] },
  ], dropped: [] };
  const jl = [{ n: 1, text: 'Summarise', rule: 'must say 0.54.1', rules: ['must say 0.54.1'] }];
  const b = made({ jobLines: jl, look: lk });
  const own = made({ jobLines: jl, look: { facts: [lk.facts[0]] } });
  own.applyDelta({ edits: [{ op: 'add', kind: 'phrase', line: 1, name: 'ship day', source: 'Changelog', words: ['2026-11-04'] }] });
  own.reconcile();
  assert.equal(by(b, 'L1.fact.release version')?.state, 'built');
  assert.equal(by(b, 'L1.fact.release date')?.reason, WEEK_ONLY_WORDS);
  assert.equal(by(b, 'L1.fact.heading')?.state, 'built');
  // an ISO date the input's newest heading carries is kept: a place rule fits it at the draft (it is no longer week-only)
  assert.equal(by(own, 'L1.phrase.2026-11-04')?.state, 'built');
  // the person's own rule is never refused by the week-only reader
  assert.notEqual(by(b, 'L1.~1')?.reason, WEEK_ONLY_WORDS);
  assert.equal(by(b, 'L1.~1')?.by, 'you');
});

test('A9 an empty list (only the floor) is logged as ONE explicit record; a list with a real row is not; a line whose rows are all Not checked still stands as rows', () => {
  const floorOnly = made({ jobLines: [{ n: 1, text: 'x', rules: [] }], look: { facts: [] }, texts: {}, labels: [] });
  assert.ok(floorOnly.rows.every((r) => r.kind === 'floor' || r.kind === 'cited'));
  assert.equal(floorOnly.hasBuiltCheck(), false);
  const rec = ledgerRecord(/** @type {any} */ (floorOnly.rows.filter((r) => r.kind === 'floor')));
  assert.equal(rec.filter((r) => r.rowKind === 'empty').length, 1);
  assert.deepEqual([rec.at(-1)?.state, rec.at(-1)?.reason, rec.at(-1)?.key], ['empty', EMPTY_LIST_WORDS, 'empty']);
  assert.equal(isEmptyList(/** @type {any} */ (floorOnly.rows.filter((r) => r.kind === 'floor'))), true);
  const text = made({ jobLines: [{ n: 1, text: 'x', rules: [] }], look: { facts: [] } });
  assert.equal(ledgerRecord(/** @type {any} */ (text.rows)).some((r) => r.rowKind === 'empty'), false);
});

test('A9 every row ends built or Not checked with a plain reason (no row is dropped, none is left half-way), and the record has one object per row', () => {
  const b = made();
  b.applyDelta({ edits: [{ op: 'add', kind: 'count', line: 1, min: 1, max: 1 }] });
  b.reconcile();
  for (const r of b.rows) {
    assert.ok(['built', 'not-checked'].includes(r.state), r.key);
    assert.ok(r.state === 'built' || (typeof r.reason === 'string' && r.reason !== ''), r.key);
  }
  const rec = ledgerRecord(/** @type {any} */ (b.rows));
  assert.equal(rec.length, b.rows.length + (isEmptyList(/** @type {any} */ (b.rows)) ? 1 : 0));
  assert.ok(rec.every((r) => r.rowKind && r.key && r.by && r.from && r.state));
  // a result count with no fact on its line has nothing to count: Not checked, said plainly
  const c = made({ look: { facts: [] } });
  c.applyDelta({ edits: [{ op: 'add', kind: 'count', line: 1, min: 2 }] });
  c.reconcile();
  assert.equal(c.rows.find((r) => r.kind === 'count')?.reason, REASON.countNeedsFact);
});

// ---- the draft gate's own word checks run per fact on the block (src/factwords.js checkFactWords): a word the gate would refuse makes THIS row Not checked in the gate's plain words, never a red on code's whole plan ----
// Fail-first: before this pre-check each case below was a `plan-red` stop (a code-built plan refused by checkDeclarationWords), e.g. the real run mwdhma1l "12 results returned." counted once for 3 results.
const PAGE = 'Flights\nLeaves Boston at 9 AM. Price: $389 US dollars\nLeaves Boston at 10 AM. Price: $431 US dollars\nLeaves Boston at 11 AM. Price: $512 US dollars\n12 results returned.\n';
function wordBlock(/** @type {any[]} */ edits, /** @type {any} */ look = { facts: [] }) {
  const b = new CheckBlock({ texts: { flights: PAGE }, labels: ['flights'], asks: false });
  b.fromJob([{ n: 1, text: 'List 3 flights', rules: [] }]);
  b.addLook(look.facts, look.dropped);
  b.applyDelta({ edits });
  b.reconcile();
  return b;
}
const add = (/** @type {any} */ o) => ({ op: 'add', kind: 'fact', line: 1, source: 'flights', ...o });

test('words found fewer times than the line\'s result count: the fact is Not checked in the gate\'s words (M4/M1), the count and the other facts stay', () => {
  const b = wordBlock([add({ kind: 'phrase', name: 'results returned', words: ['12 results returned.'] }), add({ kind: 'phrase', name: 'leaves', words: ['Leaves Boston'] }), { op: 'add', kind: 'count', line: 1, min: 3, max: 3 }]);
  const row = (/** @type {string} */ n) => b.rows.find((r) => r.name === n);
  assert.equal(row('results returned')?.state, 'not-checked');
  assert.match(String(row('results returned')?.reason), /only 1 time, but this line asks for 3 results/);
  assert.equal(row('leaves')?.state, 'built');
  assert.equal(b.rows.find((r) => r.kind === 'count')?.state, 'built');
});

test('a unit or a sign that is not on the page: the add is Not checked ("the unit ... is not in the input"), a unit that is there is built', () => {
  const b = wordBlock([add({ name: 'price', shape: 'money', words: ['Price:'], unit: ['zorkmids'] })]);
  assert.match(String(b.rows.find((r) => r.name === 'price')?.reason), /the unit "zorkmids" is not in the input "flights"/);
  assert.equal(wordBlock([add({ name: 'price', shape: 'money', words: ['Price:'], unit: ['US dollars'] })]).rows.find((r) => r.name === 'price')?.state, 'built');
  assert.match(String(wordBlock([add({ name: 'price', shape: 'money', words: ['Price:'], currency: ['£'] })]).rows.find((r) => r.name === 'price')?.reason), /the currency "£" is not in the input/);
});

test('a label the look dropped or never kept is not used by an add: Not checked in the look\'s own plain words, and the look\'s kept label still builds', () => {
  const look = { facts: [{ line: 1, name: 'price', shape: 'money', source: 'flights', words: ['Price:'], unit: ['US dollars'] }], dropped: [{ line: 1, fact: 'Stops', word: 'Leaves', reason: 'no-value', source: 'flights' }] };
  const b = wordBlock([add({ name: 'stops', shape: 'number', words: ['Leaves'] })], look);
  const row = b.rows.find((r) => r.name === 'stops');
  assert.equal(row?.state, 'not-checked');
  assert.match(String(row?.reason), /the label "Leaves" cannot be used\./);
  assert.equal(b.rows.find((r) => r.name === 'price')?.state, 'built');
  // a label that is on the page but that the look did not keep is picked from the look's list, never typed
  const typed = wordBlock([add({ name: 'time', shape: 'time', words: ['Leaves Boston at'] })], look);
  assert.match(String(typed.rows.find((r) => r.name === 'time')?.reason), /is not one of the labels the page words for "flights" kept/);
});

test('a missing source is filled by code when the job has exactly ONE input, and refused (never guessed) when it has two (ported from r10-sourcefill: fill/merge guards)', () => {
  const one = made({ look: { facts: [] }, jobLines: [{ n: 1, text: 'Say it', rules: [] }] });
  const r1 = one.applyDelta({ edits: [{ op: 'add', kind: 'phrase', line: 1, name: 'heading', words: ['### Fixed'] }] });
  one.reconcile();
  assert.equal(r1.edits[0].accepted, true);
  assert.equal(one.closeCache.parts.find((p) => p.class === 'fact')?.source, 'Changelog');
  const two = made({ look: { facts: [] }, jobLines: [{ n: 1, text: 'Say it', rules: [] }], texts: { Changelog: TEXT, Readme: 'readme' } });
  const r2 = two.applyDelta({ edits: [{ op: 'add', kind: 'phrase', line: 1, name: 'heading', words: ['### Fixed'] }] });
  assert.equal(r2.edits[0].accepted, false);
  assert.match(r2.edits[0].refusedBecause, /names no input; the job has 2: "Changelog", "Readme"/);
  assert.equal(two.rows.some((r) => r.kind === 'phrase'), false);
});
