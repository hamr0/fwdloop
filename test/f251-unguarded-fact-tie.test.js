// F251 (docs/logs/FINDINGS.md): a line with no `~` guardrail of the person's own holds no signable check, and ONE place decides it: the check block (src/checkblock.js). The red it came from: the AI's ledger look suggested a phrase fact on
// the unguarded line 1; the block built its fact part and tied line 2's numbers to it, then the assemble step dropped the part, so `close.numbersFrom: [1]` named a line that checks no quote. The plan is test/support/f251-unguarded-fact-tie
// (the saved red draft, scrubbed), rebuilt through the real path. $0, no AI.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { rebuildBlock } from '../src/planrebuild.js';
import { assembleFromBlock, NO_GUARDRAIL_WORDS } from '../src/blockassemble.js';
import { validateDeclaration } from '../src/declaration.js';
import { loadCatalogue } from '../src/catalogue.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { csvRolesOf } from '../src/sheetblock.js';
import { docRolesOf } from '../src/drafter.js';

const FX = new URL('./support/f251-unguarded-fact-tie/', import.meta.url).pathname;

/** the saved red draft rebuilt through the real path; `withoutLine1Phrase` removes the ledger look's line-1 phrase from the saved answer (the draft that was green) */
function setUp(withoutLine1Phrase = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'f251-'));
  const planDir = path.join(root, 'plan');
  mkdirSync(planDir);
  for (const f of ['picks-record.json', 'not-checked.json', 'declaration.json']) copyFileSync(path.join(FX, f), path.join(planDir, f));
  let log = readFileSync(path.join(FX, 'log.json'), 'utf8');
  if (withoutLine1Phrase) {
    const j = JSON.parse(log);
    for (const r of j.log) if (r.kind === 'ledger-suggest') r.args.extra = r.args.extra.filter((/** @type {any} */ x) => x.line !== 1);
    log = JSON.stringify(j, null, 2);
  }
  writeFileSync(path.join(planDir, 'log.json'), log);
  for (const f of ['prose.txt', 'target.json']) writeFileSync(path.join(planDir, f), readFileSync(path.join(FX, f), 'utf8').replaceAll('__ROOT__', root));
  copyFileSync(path.join(FX, 'research-notes.md'), path.join(root, 'research-notes.md'));
  const b = rebuildBlock({ planDir, asks: true });
  assert.equal(b.ok, true, b.ok ? '' : b.say);
  assert(b.ok);
  const cat = loadCatalogue();
  assert(cat.ok);
  const { checkList: _c, pickedLines: _p, ...rest } = b.declaration;
  const built = assembleFromBlock({ declaration: rest, block: b.block, lines: b.lines, lineSet: b.lineSet, askLines: new Set(b.parsed.arbiter.asks.map((/** @type {any} */ a) => a.line)), sheetRoles: csvRolesOf(b.parsed.arbiter) });
  const v = validateDeclaration(built.declaration, {
    arbiter: b.parsed.arbiter, lines: b.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true,
    pageWords: { texts: b.texts, look: null, docs: docRolesOf(b.parsed.arbiter.sources) },
  });
  return { b, built, v, step2: built.declaration.steps.find((/** @type {any} */ s) => s.fromLine === 2) };
}

test('F251: an AI phrase fact on the unguarded line 1 and a guarded item line 2: the plan passes its own gate, step 2 has no numbersFrom, line 1\'s row is Not checked with the no-guardrail reason', () => {
  const { b, built, v, step2 } = setUp();
  assert.equal(v.ok, true, v.ok ? '' : String(v.reds[0]));
  assert.equal(Object.hasOwn(step2.close, 'numbersFrom'), false);
  assert.equal(step2.close.itemShape.minItems, 4);
  const row = built.declaration.checkList.find((/** @type {any} */ r) => r.key === 'L1.phrase.research notes');
  assert.equal(row.state, 'not-checked');
  assert.equal(row.reason, NO_GUARDRAIL_WORDS);
  assert.deepEqual(built.notChecked, ['line 1: phrase "Research notes"']);
  const c = b.block.reconcile();
  assert.equal(c.map.some((/** @type {any} */ m) => m.line === 1 && c.parts[m.part].class === 'fact'), false, 'the block builds no fact part on a line with no guardrail');
});

test('F251: an unguarded line before a guarded item line with no fact on it gives the rows it always gave (floor only on line 1, no numbers tie)', () => {
  const { built, v, step2 } = setUp(true);
  assert.equal(v.ok, true, v.ok ? '' : String(v.reds[0]));
  assert.equal(Object.hasOwn(step2.close, 'numbersFrom'), false);
  assert.deepEqual(built.declaration.checkList.filter((/** @type {any} */ r) => r.line === 1).map((/** @type {any} */ r) => `${r.key}:${r.state}`), ['L1.$floor:built']);
  assert.equal(step2.close.itemShape.maxItems, 4);
  assert.deepEqual(built.notChecked, []);
});
