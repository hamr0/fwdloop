// M19 am15 and am15a (docs/wiki/the-module-ladder.md, end of M19; F256-F258): on a job with a `~` elsewhere, a step with no `~` of its own gets its `!` and `$` checks as on any line.
//   am15: an Added `!` row is a real check (the step runs with its class); Drop returns it to hitl; a `$` row is built and is code's own; a shape row still needs a `~`.
//   am15a: a `!` row code builds from the step's own words is built with no Add.
//   Unchanged: a class the drafter writes with no code-built row behind it is a red.
// The plan is test/support/f251-unguarded-fact-tie (a saved plan, scrubbed): line 1 has no `~`, line 2 has four. $0, no AI, no key. The saved declaration is re-assembled by the current code first (the way a new draft saves it),
// then the panel's own row-edit route (`rowEditPlan`) is run on it. Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { rebuildBlock, rowEditPlan } from '../src/planrebuild.js';
import { assembleFromBlock } from '../src/blockassemble.js';
import { validateDeclaration } from '../src/declaration.js';
import { loadCatalogue } from '../src/catalogue.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { csvRolesOf } from '../src/sheetblock.js';
import { withSheetRows } from '../src/sheetrows.js';
import { withTicketRows } from '../src/ticketrows.js';
import { docRolesOf } from '../src/drafter.js';
import { newJobBlock } from '../src/blocklines.js';

const FX = new URL('./support/f251-unguarded-fact-tie/', import.meta.url).pathname;
// the fixture's own phrase is in line 1's words ("Read the research notes."), so code builds it from them (am15a); this one is not, so it is Suggested and needs an Add (am15)
const SUGGESTED_PHRASE = 'Battery recycling study';
const SUGGESTED_KEY = 'L1.phrase.battery recycling study';
const OWN_KEY = 'L1.phrase.research notes';

const cat = loadCatalogue();
assert(cat.ok);
const dj = (/** @type {unknown} */ o) => `${JSON.stringify(o, null, 2)}\n`;

/** a plan folder from the fixture; `phrase` swaps the AI's line-1 phrase; `blank` removes it. The declaration is saved the way the current code saves a draft. */
function plan({ phrase = null, blank = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'm19-am15-'));
  const planDir = path.join(root, 'plan');
  mkdirSync(planDir);
  for (const f of ['picks-record.json', 'not-checked.json', 'declaration.json']) copyFileSync(path.join(FX, f), path.join(planDir, f));
  const log = JSON.parse(readFileSync(path.join(FX, 'log.json'), 'utf8'));
  for (const r of log.log) {
    if (r.kind !== 'ledger-suggest') continue;
    if (blank) r.args.extra = r.args.extra.filter((/** @type {any} */ x) => x.line !== 1);
    else if (phrase) r.args.extra.find((/** @type {any} */ x) => x.line === 1).phrase = phrase;
  }
  writeFileSync(path.join(planDir, 'log.json'), dj(log));
  for (const f of ['prose.txt', 'target.json']) writeFileSync(path.join(planDir, f), readFileSync(path.join(FX, f), 'utf8').replaceAll('__ROOT__', root));
  writeFileSync(path.join(planDir, 'input-facts.json'), dj({ notes: [] }));
  copyFileSync(path.join(FX, 'research-notes.md'), path.join(root, 'research-notes.md'));
  save(planDir);
  return planDir;
}

/** the declaration as a draft made now would save it (the same assembly `rowEditPlan` re-runs) */
function save(/** @type {string} */ planDir) {
  const b = rebuildBlock({ planDir, asks: true });
  assert(b.ok, b.ok ? '' : b.say);
  const { checkList: _c, pickedLines: _p, ...rest } = b.declaration;
  const built = assembleFromBlock({ declaration: rest, block: b.block, lines: b.lines, lineSet: b.lineSet, askLines: new Set(b.parsed.arbiter.asks.map((/** @type {any} */ a) => a.line)), sheetRoles: csvRolesOf(b.parsed.arbiter) });
  const withSheet = withSheetRows({ declaration: built.declaration, lines: b.lines, csvRoles: csvRolesOf(b.parsed.arbiter) });
  writeFileSync(path.join(planDir, 'declaration.json'), dj(withTicketRows({ declaration: withSheet.declaration, lines: b.lines }).declaration));
}

/** the plan checks, as a person's Sign would meet them, on a plan folder */
function verdict(/** @type {string} */ planDir, /** @type {any} */ declaration = JSON.parse(readFileSync(path.join(planDir, 'declaration.json'), 'utf8'))) {
  const b = rebuildBlock({ planDir, asks: true });
  assert(b.ok, b.ok ? '' : b.say);
  return validateDeclaration(declaration, {
    arbiter: b.parsed.arbiter, lines: b.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true,
    pageWords: { texts: b.texts, look: null, docs: docRolesOf(b.parsed.arbiter.sources) },
  });
}

/** the NEW plan folder a row edit returned, written beside the old one */
function applied(/** @type {string} */ planDir, /** @type {'add'|'drop'} */ op, /** @type {string} */ key) {
  const r = rowEditPlan({ planDir, op, key });
  assert(r.ok, r.ok ? '' : r.say);
  const next = `${planDir}-${op}`;
  mkdirSync(next);
  for (const f of ['prose.txt', 'target.json', 'input-facts.json', 'picks-record.json']) copyFileSync(path.join(planDir, f), path.join(next, f));
  for (const [f, text] of Object.entries(r.files)) writeFileSync(path.join(next, f), text);
  return { next, declaration: JSON.parse(r.files['declaration.json']) };
}
const stepOf = (/** @type {any} */ d, /** @type {number} */ n) => d.steps.find((/** @type {any} */ s) => s.fromLine === n);
const rowOf = (/** @type {any} */ d, /** @type {string} */ key) => d.checkList.find((/** @type {any} */ r) => r.key === key);

test('(a) am15 item 1, 2: Add of a `!` fact on a no-~ step, through the real row-edit route: built, the plan validates, the step is not hitl, guardrailClasses holds its class (break: the F251 gate, the class tie in declaration.js)', () => {
  const planDir = plan({ phrase: SUGGESTED_PHRASE });
  const before = JSON.parse(readFileSync(path.join(planDir, 'declaration.json'), 'utf8'));
  assert.equal(stepOf(before, 1).close.class, 'hitl', 'before the Add the step is hitl');
  assert.equal(rowOf(before, SUGGESTED_KEY)?.state, 'dropped', 'a Suggested row is held off the plan until it is Added');
  const { next, declaration } = applied(planDir, 'add', SUGGESTED_KEY);
  const cls = stepOf(declaration, 1).close.class;
  assert.notEqual(cls, 'hitl');
  assert.equal(declaration.guardrailClasses['1'], cls);
  const row = rowOf(declaration, SUGGESTED_KEY);
  assert.deepEqual([row.by, row.state], ['agent', 'built']);
  const v = verdict(next);
  assert.equal(v.ok, true, v.ok ? '' : String(v.reds[0]));
});

test('(b) am15 item 1: Drop of the Added row returns the step to hitl and the guardrailClasses key is gone (break: assembleFromBlock keeps the key)', () => {
  const planDir = plan({ phrase: SUGGESTED_PHRASE });
  const added = applied(planDir, 'add', SUGGESTED_KEY);
  const dropped = applied(added.next, 'drop', SUGGESTED_KEY);
  assert.equal(stepOf(dropped.declaration, 1).close.class, 'hitl');
  assert.equal(Object.hasOwn(dropped.declaration.guardrailClasses ?? {}, '1'), false);
  assert.equal(rowOf(dropped.declaration, SUGGESTED_KEY).state, 'dropped');
  const v = verdict(dropped.next);
  assert.equal(v.ok, true, v.ok ? '' : String(v.reds[0]));
});

test('(c) am15 item 4, am15a item 3: a class the drafter writes on a no-~ step with no code-built row behind it is a red, with or without a guardrailClasses key, and a forged built `by: agent` row in its own list does not help (break: addedLines reads the drafter\'s list without checkListReds)', () => {
  const planDir = plan({ phrase: SUGGESTED_PHRASE }); // nothing Added: no code-built row on line 1
  const d = JSON.parse(readFileSync(path.join(planDir, 'declaration.json'), 'utf8'));
  assert.equal(verdict(planDir, d).ok, true, 'control: the saved plan is green');
  const withClass = (/** @type {boolean} */ key, /** @type {boolean} */ forged) => {
    const x = structuredClone(d);
    stepOf(x, 1).close = { ...stepOf(x, 1).close, class: 'softgreen' };
    if (key) x.guardrailClasses = { ...x.guardrailClasses, 1: 'softgreen' };
    if (forged) x.checkList = [...x.checkList, { key: 'L1.phrase.forged', line: 1, from: 'agent', by: 'agent', kind: 'phrase', state: 'built', facts: ['Research notes'] }];
    return verdict(planDir, x);
  };
  const a = withClass(false, false);
  assert.equal(a.ok, false);
  assert.ok(a.reds.some((/** @type {unknown} */ r) => /does not match "hitl"/.test(String(r))), a.reds.map(String).join(' | '));
  assert.equal(withClass(true, false).ok, false);
  assert.equal(withClass(true, true).ok, false, 'a forged built row in the drafter\'s own list is still red');
  assert.equal(withClass(false, true).ok, false);
});

test('(d) am15 item 1: a `$` numbers row on a no-~ step is built, and its Drop is refused as code\'s own (break: buildLine clears the rows of a no-~ line again)', () => {
  const notes = 'Tomatoes by the fence. Raised bed by the fence needs soil.';
  const jobLines = [
    { n: 1, text: 'List 3 jobs for this week from the notes', rule: 'must name the jobs', rules: ['must name the jobs'] },
    { n: 2, text: 'Write a short closing note to my neighbour', rules: [] },
  ];
  const block = newJobBlock({ texts: { notes }, jobLines });
  block.applyDelta({ label: 'pre:ledger-suggest', pre: true, edits: [{ op: 'add', kind: 'phrase', line: 1, name: 'raised bed', words: ['Raised bed by the fence'], source: 'notes' }] });
  block.reconcile();
  assert.equal(block.rowChoice('L1.phrase.raised bed by the fence', 'add').ok, true);
  const numbers = block.rows.find((r) => r.kind === 'numbers' && r.line === 2);
  assert.ok(numbers, JSON.stringify(block.rows.map((r) => [r.key, r.state])));
  assert.equal(numbers.state, 'built');
  const drop = block.rowChoice(numbers.key, 'drop');
  assert.equal(drop.ok, false);
  assert.match(String(drop.why), /code's own and stays/);
});

test('(e) am15 item 5: a shape row is not offered on a line with no ~ of the person\'s, even when a shape is handed to the block for it (break: isShapeLine without the rule test)', () => {
  const jobLines = [
    { n: 1, text: 'Read the notes', rule: 'must name the jobs', rules: ['must name the jobs'] },
    { n: 2, text: 'List the items', rules: [] },
  ];
  const block = newJobBlock({ texts: { notes: 'Tomatoes by the fence.' }, jobLines });
  block.setShape({ built: { 2: { line: 2, ok: true, fields: [{ name: 'title', kind: 'text', required: true, bounds: {}, rule: null, by: 'agent', held: false }], itemCount: null, rows: [], refused: [], reservedChecked: true } }, notChecked: {}, refused: [] });
  block.reconcile();
  assert.deepEqual(block.rows.filter((r) => r.kind === 'shape' && r.line === 2), []);
});

test('(f) am15a: a `!` row code builds from the no-~ step\'s own words is built with no Add, its step runs with the check\'s class, the plan validates, and its Drop returns the step to hitl (break: match() holds every `!` row of a no-~ line)', () => {
  const planDir = plan(); // the fixture's own phrase "Research notes" is in line 1's words
  const d = JSON.parse(readFileSync(path.join(planDir, 'declaration.json'), 'utf8'));
  const row = rowOf(d, OWN_KEY);
  assert.deepEqual([row.by, row.state], ['agent', 'built']);
  const cls = stepOf(d, 1).close.class;
  assert.notEqual(cls, 'hitl');
  assert.equal(d.guardrailClasses['1'], cls);
  const v = verdict(planDir);
  assert.equal(v.ok, true, v.ok ? '' : String(v.reds[0]));
  // line 2's numbers are tied to a line that now checks quotes, so the plan signs whole
  assert.deepEqual(stepOf(d, 2).close.numbersFrom, [1]);
  const dropped = applied(planDir, 'drop', OWN_KEY);
  assert.equal(stepOf(dropped.declaration, 1).close.class, 'hitl');
  assert.equal(Object.hasOwn(dropped.declaration.guardrailClasses ?? {}, '1'), false);
  assert.equal(rowOf(dropped.declaration, OWN_KEY).state, 'dropped');
  assert.equal(Object.hasOwn(stepOf(dropped.declaration, 2).close, 'numbersFrom'), false);
  const v2 = verdict(dropped.next);
  assert.equal(v2.ok, true, v2.ok ? '' : String(v2.reds[0]));
});

test('(f2) am15 item 2: a no-~ step with no added check and no check built from its own words stays hitl, with no class entry', () => {
  const planDir = plan({ blank: true });
  const d = JSON.parse(readFileSync(path.join(planDir, 'declaration.json'), 'utf8'));
  assert.equal(stepOf(d, 1).close.class, 'hitl');
  assert.equal(Object.hasOwn(d.guardrailClasses ?? {}, '1'), false);
  assert.equal(verdict(planDir).ok, true);
});

test('(g) am15 item 3: no source file and no page text holds "no guardrail of yours" (break: the F251 words are put back)', () => {
  const hits = [];
  const walk = (/** @type {string} */ dir) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/no guardrail of yours/i.test(readFileSync(p, 'utf8'))) hits.push(p);
    }
  };
  walk(new URL('../src/', import.meta.url).pathname);
  assert.deepEqual(hits, []);
});
