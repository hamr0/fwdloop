// M16 P3 S2-S4 at the drafter: the ledger-suggest call (`add` edits), the answers that ride the redraft (an Agree through the panel's answer shape = the block's own applyAnswer),
// the row-edit turn (a revise only for a refused edit, at most twice; the extra-`}` repair), the page / Tickets / CSV fixtures, and the merged asks. Stub providers, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draft } from '../src/drafter.js';
import { newJobBlock } from '../src/blocklines.js';
import { setUpBlock } from '../src/blockdraft.js';
import { questionsOfBlock, applyChoices } from '../src/blockasks.js';
import { ROW_EDIT_REVISE } from '../src/rowedit.js';
import { RATES, MODEL } from './drafter-fixture.mjs';
import { rd, callOf, textOf, malformedOf, router, walkProse } from './m16-drafter-fixture.mjs';

const run = (/** @type {any} */ provider, /** @type {string} */ proseText, /** @type {any} */ extra = {}) => draft({ proseText, provider, rates: RATES, modelId: MODEL, checkList: true, offerQuestions: false, ...extra });
const EDITS = (/** @type {any[]} */ edits) => callOf('submit_edits', { edits });
const NONE = EDITS([]);
const LEDGER_NONE = callOf('suggest_extra_checks', { extra: [] });
/** an edit the block refuses on its own (the words are not in the input) */
const BAD = { op: 'add', kind: 'phrase', line: 1, name: 'ghost', words: ['a phrase no input holds'], source: 'notes' };
const GOOD = { op: 'add', kind: 'phrase', line: 1, name: 'raised bed', words: ['Raised bed by the fence'], source: 'notes' };
const kinds = (/** @type {any} */ r) => r.log.map((/** @type {any} */ e) => e.kind);

test('(S2) the ledger-suggest call: its extra checks are `add` edits of the block, metered like every round (thinking off, tool forced)', async (t) => {
  const p = router({ suggest_extra_checks: callOf('suggest_extra_checks', { extra: [{ line: 1, kind: 'phrase', phrase: 'Raised bed by the fence', source: 'notes' }] }), submit_edits: NONE });
  const r = await run(p, walkProse(t));
  assert.deepEqual(p.names().slice(0, 2), ['suggest_extra_checks', 'submit_edits'], 'the ledger call comes before the row-edit turn');
  assert.deepEqual(p.calls[0].options.toolChoice, { name: 'suggest_extra_checks' });
  assert.equal(p.calls[0].options.thinkingMode, 'off');
  assert.ok(r.checkRows.some((/** @type {any} */ x) => x.key === 'L1.phrase.raised bed by the fence' && x.by === 'agent' && x.from === 'agent'), r.checkRows.map((/** @type {any} */ x) => x.key).join('|'));
  assert.deepEqual(kinds(r).slice(0, 2), ['ledger-suggest', 'row-edit']);
  assert.ok(r.costUsd > 0 && r.spendComplete === true && r.rounds === r.calls, 'every round metered');
});

test('(S2) a ledger reply that is no count or phrase adds nothing (the block judges, code never trusts the reply)', async (t) => {
  const p = router({ suggest_extra_checks: callOf('suggest_extra_checks', { extra: [{ line: 1, kind: 'phrase', phrase: 'words no input holds', source: 'notes' }] }), submit_edits: NONE });
  const r = await run(p, walkProse(t));
  assert.ok(!r.checkRows.some((/** @type {any} */ x) => x.key.includes('words no input holds') && x.state === 'built'));
});

test('(S3) the answers ride the redraft: the person\'s Agree (the panel\'s answer shape: a pick + the added ~ line) builds the same rows as the block\'s own applyAnswer', () => {
  const texts = { notes: rd('m14-walk-5/notes.md') };
  const CHECK = { rule: 'listItems', value: 3 };
  // the block's own path: the suggest call's pick pre-edit, then the typed Agree
  const A = newJobBlock({ texts, jobLines: [{ n: 3, text: 'List 3 jobs for this week from the notes', rules: ['exactly 3 bullets'] }] });
  A.reconcile();
  A.applyDelta({ pre: true, edits: [{ op: 'pick', line: 3, rules: [1], check: CHECK }] });
  A.reconcile();
  const asks = questionsOfBlock(A, [{ line: 3, rule: 1 }]);
  assert.deepEqual(asks.map((a) => a.ask), ['check']);
  assert.deepEqual(applyChoices(A, [{ key: asks[0].key, choice: 'agree' }]), []);
  // the panel's path: the redraft's prose holds the added `~` line, and the pick comes back as {line, rule, check, added}
  const B = setUpBlock({
    texts, jobLines: [{ n: 3, text: 'List 3 jobs for this week from the notes', rules: ['exactly 3 bullets', 'exactly 3 list items'] }], look: { facts: [], dropped: [] },
    kept: { picks: [], left: [], askRules: [] }, fresh: { picks: [{ line: 3, rule: 1, check: CHECK, added: 'exactly 3 list items' }], left: [] }, asks: false, countScope: () => true, scoped: [{ line: 3, rule: 1 }, { line: 3, rule: 2 }],
  });
  const byKey = (/** @type {any[]} */ rows) => [...rows].sort((a, b) => a.key.localeCompare(b.key));
  assert.deepEqual(byKey(B.signedRows()), byKey(A.signedRows()), 'the same signed rows');
  assert.deepEqual(byKey(B.reconcile() && B.rows).map((x) => [x.key, x.state, x.text ?? null, x.parent ?? null, x.from]), byKey(A.rows).map((x) => [x.key, x.state, x.text ?? null, x.parent ?? null, x.from]));
  assert.ok(A.rows.some((x) => x.key === 'L3.~2' && x.parent === 'L3.~1' && x.state === 'built'), 'the agreed follower is built and points at its source (am2)');
});

test('(S3) the redraft through draft(): the answered picks are carried into the block (source built, follower built), and no suggest call is paid', async (t) => {
  const prose = walkProse(t, (s) => s.replace('guardrail: exactly 3 bullets', 'guardrail: exactly 3 bullets; exactly 3 list items').replace('guardrail: under 80 words', 'guardrail: under 80 words; at most 80 words'));
  const p = router({ suggest_extra_checks: LEDGER_NONE, submit_edits: NONE });
  const picks = [{ line: 3, rule: 1, check: { rule: 'listItems', value: 3 }, added: 'exactly 3 list items' }, { line: 5, rule: 1, check: { rule: 'maxWords', value: 80 }, added: 'at most 80 words' }];
  const r = await run(p, prose, { checkPicks: picks });
  assert.ok(!p.names().includes('suggest_checks'), 'the redraft pays no suggest call');
  const row = (/** @type {string} */ k) => r.checkRows.find((/** @type {any} */ x) => x.key === k);
  for (const k of ['L3.~1', 'L3.~2', 'L5.~1', 'L5.~2']) assert.equal(row(k)?.state, 'built', k);
});

test('(S4) the row-edit turn: one forced call, thinking off, bareloop\'s system text and job text unchanged, edits applied alone', async (t) => {
  const p = router({ suggest_extra_checks: LEDGER_NONE, submit_edits: EDITS([GOOD]) });
  const r = await run(p, walkProse(t));
  const call = p.calls.find((c) => c.name === 'submit_edits');
  assert.deepEqual(call?.options.toolChoice, { name: 'submit_edits' });
  assert.equal(call?.options.thinkingMode, 'off');
  assert.match(call?.messages[0].content ?? '', /^You help turn the lines of a job into checks, by sending EDITS to a list of checks that code keeps\./);
  assert.match(call?.messages[1].content ?? '', /^THE JOB \(the person's own words\)\n1\. Write 3 lines about my garden from the notes/);
  assert.ok(!/\n2\. ask 1h/.test(call?.messages[1].content ?? ''), 'an ask line is not shown');
  assert.deepEqual(r.log.find((/** @type {any} */ e) => e.kind === 'row-edit').edits, [{ op: 'add', accepted: true }]);
  assert.equal(p.names().filter((n) => n === 'submit_edits').length, 1, 'nothing refused: no revise');
});

test('(S4) a refused edit costs exactly ONE revise (its own reason + the fixed sentence), the other edit stands, and a clean reply ends it', async (t) => {
  const p = router({ suggest_extra_checks: LEDGER_NONE, submit_edits: [EDITS([BAD, GOOD]), NONE] });
  const r = await run(p, walkProse(t));
  assert.equal(p.names().filter((n) => n === 'submit_edits').length, 2);
  const revise = p.calls.filter((c) => c.name === 'submit_edits')[1].messages;
  assert.equal(revise.length, 4, 'system, job, the reply, the refusals');
  const last = revise.at(-1).content;
  assert.match(last, /^MEASURED EDITS — some of your edits were refused; each refusal is its own and your other edits stand:\n  edit add: the words "a phrase no input holds" are not in the input\n\n/);
  assert.ok(last.endsWith(ROW_EDIT_REVISE));
  assert.deepEqual(kinds(r).filter((k) => k.startsWith('row-edit')), ['row-edit', 'row-edit-revision']);
  assert.ok(r.checkRows.some((/** @type {any} */ x) => x.key === 'L1.phrase.raised bed by the fence'), 'the accepted edit of the first reply stands');
});

test('(S4) never a third revise: a reply refused every time is asked three times in all (the first and two revises), then the draft goes on', async (t) => {
  const p = router({ suggest_extra_checks: LEDGER_NONE, submit_edits: EDITS([BAD]) });
  const r = await run(p, walkProse(t));
  assert.equal(p.names().filter((n) => n === 'submit_edits').length, 3);
  assert.deepEqual(kinds(r).filter((k) => k.startsWith('row-edit')), ['row-edit', 'row-edit-revision', 'row-edit-revision']);
  assert.ok(p.names().includes('emit_declaration'), 'the declaration path still runs');
});

test('(S4) am39: a row-edit reply with an extra } is repaired and used (logged), no structure retry', async (t) => {
  const p = router({ suggest_extra_checks: LEDGER_NONE, submit_edits: malformedOf('submit_edits', `${JSON.stringify({ edits: [GOOD] })}}`) });
  const r = await run(p, walkProse(t));
  assert.equal(p.names().filter((n) => n === 'submit_edits').length, 1);
  const e = r.log.find((/** @type {any} */ x) => x.kind === 'row-edit');
  assert.deepEqual(e.braceRepair, { dropped: '}', used: true });
  assert.equal(e.outcome, 'answered');
  assert.ok(r.checkRows.some((/** @type {any} */ x) => x.key === 'L1.phrase.raised bed by the fence'));
});

test('(S4) am39: a misplaced } is not repaired; a repaired reply the block would refuse as unreadable is not used; both are the structure retry, then a structure stop', async (t) => {
  const bad = (/** @type {string} */ raw) => router({ suggest_extra_checks: LEDGER_NONE, submit_edits: malformedOf('submit_edits', raw) });
  const p1 = bad('{"edits":[}');
  const r1 = await run(p1, walkProse(t));
  assert.equal(p1.names().filter((n) => n === 'submit_edits').length, 3, 'one try and two structure retries');
  assert.equal(r1.stop, 'structure');
  assert.equal(r1.log.find((/** @type {any} */ x) => x.kind === 'row-edit').braceRepair, undefined);
  const p2 = bad(`${JSON.stringify({ edits: [{ nonsense: 1 }] })}}`);
  const r2 = await run(p2, walkProse(t));
  assert.equal(r2.stop, 'structure');
  assert.deepEqual(r2.log.find((/** @type {any} */ x) => x.kind === 'row-edit').braceRepair, { dropped: '}', used: false });
});

test('(S4) every round is metered: a failed (unmetered) row-edit call is never priced as 0', async (t) => {
  const p = router({ suggest_extra_checks: LEDGER_NONE, submit_edits: () => { throw new Error('boom'); } });
  const r = await run(p, walkProse(t));
  assert.equal(r.stop, 'provider-red');
  assert.equal(r.spendComplete, false);
  assert.equal(r.reds[0], 'provider-red: boom');
});

test('flights (page): the block gets the look\'s facts on the step line, the page-look asks come from the block, the page text is the block\'s input', async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m16f-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(path.join(home, 'out'));
  const prose = rd('flights/draft-prose.txt').replace('file:/home/user/fwdloop-out', `file:${path.join(home, 'out')}`);
  const mapping = JSON.parse(rd('flights/page-look.json')).pages[0].mapping;
  const p = router({
    map: textOf(JSON.stringify(mapping)),
    suggest_checks: callOf('suggest_checks', { checks: [{ line: 2, guardrail: 3, rule: 'listItems', value: 3 }, { line: 2, guardrail: 4, rule: 'maxWords', value: 80 }] }),
  });
  const r = await draft({ proseText: prose, provider: p, rates: RATES, modelId: MODEL, checkList: true, draftDir: path.join(home, 'pages'), fetchPage: async (/** @type {string} */ u) => ({ ok: true, text: rd('flights/flights.txt'), url: u }) });
  assert.equal(r.stop, 'look-asks');
  assert.deepEqual(p.names(), ['map', 'suggest_checks']);
  assert.deepEqual(r.questions.map((/** @type {any} */ q) => [q.line, q.ask, q.ruleNo]), [[2, 'check', 3], [2, 'check', 4]]);
  const keys = r.checkRows.map((/** @type {any} */ x) => x.key);
  assert.ok(keys.includes('L2.fact.origin city') && keys.includes('L2.fact.origin airport name'), keys.join('|'));
  assert.ok(r.checkRows.every((/** @type {any} */ x) => ![3, 5, 6].includes(x.line)), 'no row on an ask or send line');
  assert.ok(r.checkRows.filter((/** @type {any} */ x) => x.rowKind === 'cited').length === 0, 'am1');
});

test('Tickets: the block is built over the step line; ticketFilter is still the declaration turn\'s own and reaches the plan untouched', async () => {
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
  const p = router({ submit_edits: NONE, emit_declaration: callOf('emit_declaration', decl) });
  const r = await run(p, prose, { mcpServers: ['github'], flowType: 'tickets', mcp: { ok: true, server: 'github', tools: ['issue_read', 'list_issues', 'create_issue'] }, fetchPage: async () => { throw new Error('a ticket list was fetched at draft'); } });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.deepEqual(r.declaration.ticketFilter, { priority: ['P1', 'P2'] });
  assert.deepEqual([...new Set(r.checkRows.map((/** @type {any} */ x) => x.line))], [1], 'rows only on the step line');
  const sent = p.calls.find((c) => c.name === 'submit_edits');
  assert.equal(sent?.messages[1].content.includes('ticketFilter'), false, 'the row-edit turn is not asked for the ticket filter (it stays the declaration turn\'s)');
  assert.ok(!p.names().includes('suggest_extra_checks'), 'a ticket job has no input text: no ledger call');
});

test('asks merged: a CSV job\'s sheet reading ask and the block\'s can\'t-check asks are one list under one cap', async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m16s-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(path.join(home, 'out'));
  const csv = path.join(home, 'aging.csv');
  writeFileSync(csv, `${['Date,Description,Amount,Tax', ...Array.from({ length: 40 }, (_, i) => `2026-09-01,Office item ${i + 1},${101 + i}.50,${i < 10 ? '1.25' : ''}`)].join('\n')}\n`);
  const prose = (/** @type {string} */ rules) => `1. Add up the price of every invoice,
   guardrail: under 5000
2. Write a short note about it,
   guardrail: ${rules}
3. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
4. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 4 to file:${path.join(home, 'out')}
guardrail: source aging = file:${csv}
`;
  const sheetAns = textOf(JSON.stringify({ facts: [{ from: 'line 1 rule 1', word: 'Price', kind: 'number' }] }));
  const mk = () => router({ map: sheetAns, suggest_checks: callOf('suggest_checks', { checks: [] }) });
  const two = await draft({ proseText: prose('tone is warm; reads kindly'), provider: mk(), rates: RATES, modelId: MODEL, checkList: true });
  assert.equal(two.stop, 'look-asks', two.reds.join('|'));
  assert.deepEqual(two.questions.map((/** @type {any} */ q) => [q.line, q.ask]), [[1, 'reading'], [2, 'cant-check'], [2, 'cant-check']], 'the sheet\'s reading first, then the block\'s');
  const three = await draft({ proseText: prose('tone is warm; reads kindly; no jargon'), provider: mk(), rates: RATES, modelId: MODEL, checkList: true });
  assert.equal(three.stop, 'look-asks-too-many');
  assert.match(three.reds[0], /^Your job has 4 rules I can't check or had to guess\./);
});
