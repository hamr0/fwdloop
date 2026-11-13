// M16 P3b (S5-S7, R7) at the drafter: with `checkList: true` the declaration turn is offered no `close.cited`, code assembles the checks of the block's lines from the list
// (the AI's own close checks on those lines are dropped), the list is signed as `checkList`, a check not on it is refused, and a part the block built that fails the gate stops the plan.
// Stub providers, $0. Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDeclarationSchema, buildRoundSchema, buildSystemPrompt } from '../src/drafter.js';
import { wiredMenu } from '../src/primitives.js';
import { parseSignedText } from '../src/signed-text.js';
import { walkProse } from './m16-drafter-fixture.mjs';

const menu = wiredMenu(['core']);
const closeProps = (/** @type {any} */ s) => Object.keys(s.properties.steps.items.properties.close.properties);

test('(S5) the declaration turn is offered no close.cited when the list is on; off, it is offered as before', () => {
  assert.ok(closeProps(buildDeclarationSchema(menu)).includes('cited'));
  assert.ok(!closeProps(buildDeclarationSchema(menu, { noCited: true })).includes('cited'), 'break: drop the noCited branch of buildDeclarationSchema and this reds');
  assert.ok(!closeProps(buildRoundSchema(menu, { noCited: true })).includes('cited'));
});

test('(S5) the prompt of a list job tells nothing of close.cited and shows the count rules of the list lines; off, it is as before', (t) => {
  const prose = walkProse(t, (s) => s.replace('1. Write 3 lines about my garden from the notes', '1. Write 3 lines about my garden from the notes\n   guardrail: exactly 3 bullets'));
  const p = parseSignedText(prose);
  assert.ok(p.ok);
  if (!p.ok) return;
  const args = { menu, lines: p.lines, arbiter: p.arbiter, factsInfo: [] };
  const off = buildSystemPrompt(args);
  assert.ok(off.includes('close.cited'), 'a document input is quoted as before');
  assert.ok(!off.includes('[guardrail: exactly 3 bullets]'), 'count rules are hidden from the AI as before (am27)');
  const on = buildSystemPrompt({ ...args, blockLines: new Set([1, 3, 5]), noCited: true });
  assert.ok(on.includes('[guardrail: exactly 3 bullets]'), 'break: pass the block lines to shownRules and this reds');
  assert.ok(!on.includes('close.cited'));
});

// ---- S6 / S7 through draft(): the m14-walk-5 job with the list on --------------------------------------------------------------------------------------------------
import { draft } from '../src/drafter.js';
import { validateDeclaration } from '../src/declaration.js';
import { loadCatalogue } from '../src/catalogue.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { checkListReds } from '../src/checklistsign.js';
import { CheckBlock } from '../src/checkblock.js';
import { RATES, MODEL } from './drafter-fixture.mjs';
import { callOf, router } from './m16-drafter-fixture.mjs';

const NONE = callOf('submit_edits', { edits: [] });
const LEDGER_NONE = callOf('suggest_extra_checks', { extra: [] });
const PICKS = [{ line: 3, rule: 1, check: { rule: 'listItems', value: 3 }, added: 'exactly 3 list items' }, { line: 5, rule: 1, check: { rule: 'maxWords', value: 80 }, added: 'at most 80 words' }];
const WALK = (/** @type {string} */ s) => s.replace('guardrail: exactly 3 bullets', 'guardrail: exactly 3 bullets; exactly 3 list items').replace('guardrail: under 80 words', 'guardrail: under 80 words; at most 80 words');
/** the declaration an AI sends for the walk job, with checks of its own on lines 3 and 5 (which code must drop) */
const aiDecl = () => ({
  steps: [
    { primitives: ['read'], reads: [], emits: 's1', fromLine: 1, close: { class: 'hitl' } },
    { primitives: [], reads: ['s1'], emits: 'a2', fromLine: 2, close: { class: 'hitl' } },
    { primitives: ['read'], reads: [], emits: 's3', fromLine: 3, close: { class: 'green', cited: { source: 'notes', facts: [{ name: 'job', shape: 'phrase', phrase: 'the AI wrote this' }] } } },
    { primitives: [], reads: ['s3'], emits: 'a4', fromLine: 4, close: { class: 'hitl' } },
    { primitives: ['read'], reads: [], emits: 's5', fromLine: 5, close: { class: 'softgreen', shape: { maxWords: 5 } } },
    { primitives: [], reads: ['s5'], emits: 'a6', fromLine: 6, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['a6'], emits: 'sent', fromLine: 7, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 3: 'green', 5: 'softgreen' }, unjudgeable: {}, refused: [],
});
const go = (/** @type {any} */ p, /** @type {string} */ prose, /** @type {any} */ extra = {}) => draft({ proseText: prose, provider: p, rates: RATES, modelId: MODEL, checkList: true, offerQuestions: false, checkPicks: PICKS, ...extra });
const handlers = (/** @type {any} */ decl) => ({ suggest_extra_checks: LEDGER_NONE, submit_edits: NONE, emit_declaration: callOf('emit_declaration', decl) });

test('(S6) the AI\'s own close checks on the list lines are dropped: the plan carries the block\'s picks (softgreen shape.picked), never the AI\'s cited / maxWords; the list is signed as checkList', async (t) => {
  const r = await go(router(handlers(aiDecl())), walkProse(t, WALK));
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const step = (/** @type {number} */ n) => r.declaration.steps.find((/** @type {any} */ s) => s.fromLine === n);
  assert.deepEqual(step(3).close, { class: 'softgreen', shape: { picked: [{ rule: 'listItems', value: 3 }] } }, 'break: stop dropping close.cited in assembleFromBlock and this reds');
  assert.deepEqual(step(5).close, { class: 'softgreen', shape: { picked: [{ rule: 'maxWords', value: 80 }] } });
  assert.deepEqual(step(1).close, { class: 'hitl' });
  assert.deepEqual(r.declaration.guardrailClasses, { 3: 'softgreen', 5: 'softgreen' });
  assert.ok(Array.isArray(r.declaration.checkList) && r.declaration.checkList.some((/** @type {any} */ x) => x.key === 'L3.~1' && x.state === 'built' && x.part.part === 0));
  assert.deepEqual(checkListReds(r.declaration), []);
  assert.equal(r.log.at(-1).args.steps[2].close.cited.facts[0].phrase, 'the AI wrote this', 'the AI\'s own reply is kept in the log as sent');
});

test('(S6) the plan with the list passes the validator and is refused when a check is not on the list: at sign and at run start (the same gate), $0, naming the line', async (t) => {
  const r = await go(router(handlers(aiDecl())), walkProse(t, WALK));
  const p = parseSignedText(walkProse(t, WALK));
  assert.ok(p.ok);
  if (!p.ok) return;
  const ctx = { arbiter: p.arbiter, lines: p.lines, catalogue: loadCatalogue().primitives, wired: WIRED_VERBS };
  assert.equal(validateDeclaration(r.declaration, ctx).ok, true);
  const forged = structuredClone(r.declaration);
  forged.steps.find((/** @type {any} */ s) => s.fromLine === 5).close.shape.picked.push({ rule: 'maxWords', value: 999 });
  const v = validateDeclaration(forged, ctx);
  assert.equal(v.ok, false, 'break: drop checkListReds from validateDeclaration and this greens');
  assert.match(v.ok ? '' : v.reds.join('|'), /checkList line 5: the picked check 2 \(close\.picked\) is in the close but has no row on the list/);
  const rowless = structuredClone(r.declaration);
  rowless.checkList = rowless.checkList.filter((/** @type {any} */ x) => !(x.part && x.part.line === 3)); // the source row and its agreed follower both point at the part
  assert.match(validateDeclaration(rowless, ctx).ok ? '' : /** @type {any} */ (validateDeclaration(rowless, ctx)).reds.join('|'), /checkList line 3: the picked check 1 \(close\.picked\) is in the close but has no row on the list/);
  const phantom = structuredClone(r.declaration);
  phantom.steps.find((/** @type {any} */ s) => s.fromLine === 3).close = { class: 'hitl' };
  phantom.guardrailClasses[3] = 'hitl';
  phantom.unjudgeable = { 3: 'x' };
  assert.match(validateDeclaration(phantom, ctx).ok ? '' : /** @type {any} */ (validateDeclaration(phantom, ctx)).reds.join('|'), /checkList line 3: a row points at a check the close does not run \(L3\.~1\)/);
});

test('(S7) a part the block built that fails the gate stops the plan: plan-red in plain words, no further provider call, the AI is never asked to fix it', async (t) => {
  const proto = CheckBlock.prototype;
  const real = proto.reconcile;
  // the block builds a pick the validator cannot read: the break is in what the block built, not in anything the AI sent
  proto.reconcile = function patched(...a) {
    const c = real.apply(this, a);
    for (const part of c.parts) if (part.class === 'countable' && part.check === 'maxWords') part.check = 'notARule';
    return c;
  };
  try {
    const p = router(handlers(aiDecl()));
    const r = await go(p, walkProse(t, WALK));
    assert.equal(r.stop, 'plan-red');
    assert.equal(r.ok, false);
    assert.match(r.reds[0], /^The plan code built from your checks did not pass its own gate \(.*close\.shape.*\)\. That is a fault in the build, not in your job: nothing was spent on a close\.$/);
    assert.equal(p.names().filter((n) => n === 'emit_declaration').length, 1, 'exactly one declaration turn: no revise, no further call');
    assert.equal(r.revisions, 0);
    assert.equal(r.log.at(-1).outcome, 'plan-red');
  } finally { proto.reconcile = real; }
});

test('(S7) a red on something the AI wrote (a softgreen line granted write) is still a revise of the declaration turn, not a build fault', async (t) => {
  const bad = aiDecl();
  bad.steps[2].primitives = ['write'];
  const good = aiDecl();
  const p = router({ ...handlers(good), emit_declaration: [callOf('emit_declaration', bad), callOf('emit_declaration', good)] });
  const r = await go(p, walkProse(t, WALK));
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(r.revisions, 1);
  assert.equal(p.names().filter((n) => n === 'emit_declaration').length, 2);
});

test('(R4) the AI\'s own notChecked is not kept for the lines of the list: the Not-checked list is the rows\'', async (t) => {
  const p = router(handlers({ ...aiDecl(), notChecked: ['the garden is pretty'] }));
  const r = await go(p, walkProse(t, WALK));
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.ok(!r.notChecked.includes('the garden is pretty'), 'break: keep cleanNotChecked(rawNotChecked) on the list path and this reds');
});

// ---- Tickets, CSV and the m14-walk-5 accepted output, with the list on ---------------------------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { closeByClass } from '../src/closers.js';
import { textOf, rd } from './m16-drafter-fixture.mjs';

test('m14-walk-5 (am1): the accepted run-5 outputs pass the checks the block built for lines 3 and 5, and a breaking output does not', async (t) => {
  const r = await go(router(handlers(aiDecl())), walkProse(t, WALK));
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const step = (/** @type {number} */ n) => r.declaration.steps.find((/** @type {any} */ s) => s.fromLine === n);
  const out = (/** @type {string} */ f) => JSON.parse(rd(`m14-walk-5/run-5/${f}`));
  const ctx = { reads: {}, businessDate: '2026-11-13' };
  assert.equal((await closeByClass(step(3), out('week_jobs.json'), ctx)).verdict, 'green');
  assert.equal((await closeByClass(step(5), out('neighbour_note.json'), ctx)).verdict, 'green');
  assert.equal((await closeByClass(step(3), { text: '1. one\n2. two' }, ctx)).verdict, 'red', 'the check can fail: two bullets are not exactly 3');
  assert.equal((await closeByClass(step(5), { text: 'word '.repeat(90) }, ctx)).verdict, 'red');
});

test('Tickets: the plan with the list is the ticket job as before (same ticketFilter, same closes on the step lines), and it validates', async () => {
  const prose = `1. Read the ticket and say what is broken,
   guardrail: priority P1 or P2 only
2. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
3. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source issues = page:https://github.com/flutter/flutter/issues
`;
  const decl = {
    steps: [
      { primitives: ['read'], reads: ['issues'], emits: 'ticket_note', fromLine: 1, close: { class: 'hitl' } },
      { primitives: [], reads: ['ticket_note'], emits: 'ask_check', fromLine: 2, close: { class: 'hitl' } },
      { primitives: ['write'], reads: ['ask_check'], emits: 'written', fromLine: 3, close: { class: 'hitl' } },
    ],
    guardrailClasses: { 1: 'hitl', 2: 'hitl' }, unjudgeable: {}, refused: [], ticketFilter: { priority: ['P1', 'P2'] },
  };
  const mk = () => router({ submit_edits: NONE, emit_declaration: callOf('emit_declaration', decl) });
  const base = { flowType: 'tickets', mcpServers: ['github'], mcp: { ok: true, server: 'github', tools: ['issue_read', 'list_issues', 'create_issue'] }, fetchPage: async () => { throw new Error('a ticket list was fetched at draft'); } };
  const on = await go(mk(), prose, { ...base, checkPicks: [] });
  const off = await draft({ proseText: prose, provider: mk(), rates: RATES, modelId: MODEL, ...base });
  assert.equal(on.ok, true, JSON.stringify(on.reds));
  assert.equal(off.ok, true, JSON.stringify(off.reds));
  assert.deepEqual(on.declaration.ticketFilter, off.declaration.ticketFilter);
  assert.deepEqual(on.declaration.steps.map((/** @type {any} */ s) => s.close), off.declaration.steps.map((/** @type {any} */ s) => s.close), 'the same closes on every line');
  assert.deepEqual(on.declaration.guardrailClasses, off.declaration.guardrailClasses);
  assert.ok(Array.isArray(on.declaration.checkList) && on.declaration.checkList.every((/** @type {any} */ x) => x.line === 1), 'rows only on the step line');
});

test('CSV: the sheet line stays on the sheet path (same close.sheet and close.columns as the signed job), and the plan with the list validates', async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m16c-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(path.join(home, 'out'));
  const csv = path.join(home, 'base.csv');
  writeFileSync(csv, rd('csv/file.csv'));
  const prose = rd('csv/prose.txt').replace('file:/home/user/fwdloop-out', `file:${path.join(home, 'out')}`).replace('file:/home/user/work/base.csv', `file:${csv}`);
  const signed = JSON.parse(rd('csv/signed-declaration.json'));
  const { goal: _g, ...rest } = signed;
  const decl = { ...rest, steps: signed.steps.map((/** @type {any} */ s) => { const { goal: _x, ...st } = s; return st; }) };
  delete decl.inputFacts;
  const sheetAns = textOf(JSON.stringify({ facts: [{ from: 'line 2 rule 1', word: 'Price', kind: 'number' }] }));
  const mk = () => router({ map: sheetAns, submit_edits: NONE, suggest_checks: callOf('suggest_checks', { checks: [] }), emit_declaration: callOf('emit_declaration', decl) });
  const on = await go(mk(), prose, { checkPicks: [] });
  const off = await draft({ proseText: prose, provider: mk(), rates: RATES, modelId: MODEL, offerQuestions: false });
  assert.equal(off.ok, true, JSON.stringify(off.reds));
  assert.equal(on.ok, true, JSON.stringify(on.reds));
  assert.deepEqual(on.declaration.steps.map((/** @type {any} */ s) => s.close), off.declaration.steps.map((/** @type {any} */ s) => s.close), 'the same closes, the sheet line untouched');
  assert.ok(on.declaration.checkList.every((/** @type {any} */ x) => x.line !== 2), 'the sheet line has no row');
});
