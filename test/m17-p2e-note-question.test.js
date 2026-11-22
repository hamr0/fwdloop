// M17 am1 1(e) (docs/wiki/the-module-ladder.md): the note question for fact lines. A facts-only line is asked ONCE whether it also wants written words; code decides from the typed yes/no.
// $0, fake provider. Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draftToDir, signDraft } from '../src/authoring.js';
import { checkListReds } from '../src/checklistsign.js';
import { rebuildBlock } from '../src/planrebuild.js';
import { assembleFromBlock } from '../src/blockassemble.js';
import { newJobBlock } from '../src/blocklines.js';
import { loadCatalogue } from '../src/catalogue.js';
import { makeLiveModelStep } from '../src/model-step.js';
import { runFlow, makeParkingAskStep } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { noteAnswers, decideNote } from '../src/noteask.js';
import { RATES, MODEL } from './drafter-fixture.mjs';
import { rd, callOf, textOf, router } from './m16-drafter-fixture.mjs';

const NONE = callOf('submit_edits', { edits: [] });
const LEDGER_NONE = callOf('suggest_extra_checks', { extra: [] });
const NOTE = (/** @type {any[]} */ lines) => callOf('answer_note_question', { lines });
const DECL = {
  steps: [
    { primitives: ['read'], reads: [], emits: 's1', fromLine: 1, close: { class: 'hitl' } },
    { primitives: [], reads: [], emits: 's2', fromLine: 2, close: { class: 'green' } },
    { primitives: [], reads: ['s2'], emits: 'a3', fromLine: 3, close: { class: 'hitl' } },
    { primitives: ['read'], reads: ['a3'], emits: 's4', fromLine: 4, close: { class: 'hitl' } },
    { primitives: [], reads: ['s4'], emits: 'a5', fromLine: 5, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['a5'], emits: 'sent', fromLine: 6, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 2: 'green' }, unjudgeable: {}, refused: [],
};
const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+MAD+to+FCO+on+2026-11-25+one+way&hl=en&curr=USD';
const fetchPage = async (/** @type {string} */ u) => ({ ok: true, text: rd('flights/flights.txt'), url: u });

/** the flights job drafted into a plan folder with the given note answer; `picks` = the person's picks (none: line 2 is facts-only) */
async function plan(/** @type {import('node:test').TestContext} */ t, /** @type {any} */ handlers, /** @type {any[]} */ picks = []) {
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m17p2e-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(path.join(home, 'out'));
  mkdirSync(path.join(home, 'flows'));
  const proseFile = path.join(home, 'prose.txt');
  writeFileSync(proseFile, rd('flights/draft-prose.txt').replace('file:/home/user/fwdloop-out', `file:${path.join(home, 'out')}`));
  const mapping = JSON.parse(rd('flights/page-look.json')).pages[0].mapping;
  const p = router({ map: textOf(JSON.stringify(mapping)), suggest_extra_checks: LEDGER_NONE, submit_edits: NONE, emit_declaration: callOf('emit_declaration', DECL), ...handlers });
  const dir = path.join(home, 'draft');
  const r = await draftToDir({ proseFile, dir, root: path.join(home, 'flows'), name: 'flights', provider: p, rates: RATES, modelId: MODEL, env: {}, slot: 'DEEPSEEK_API_KEY', fetchPage, checkPicks: picks, noQuestions: true });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const declaration = JSON.parse(readFileSync(path.join(dir, 'declaration.json'), 'utf8'));
  return { home, dir, p, r, declaration, root: path.join(home, 'flows') };
}
const step2 = (/** @type {any} */ d) => d.steps.find((/** @type {any} */ s) => s.fromLine === 2);

test('a note-plus-fact line (answered yes) gets a $note row, a countable close.picked nonEmpty beside its facts, and a row the sign proof accepts', async (t) => {
  const { declaration: d, p } = await plan(t, { answer_note_question: NOTE([{ line: 2, writtenWords: 'yes' }]) });
  assert.equal(p.names().filter((n) => n === 'answer_note_question').length, 1, 'ONE note turn');
  assert.ok(step2(d).close.cited, 'the facts stay');
  assert.deepEqual(step2(d).close.picked, [{ rule: 'nonEmpty' }]);
  assert.deepEqual(d.pickedLines, [2]);
  const row = d.checkList.find((/** @type {any} */ x) => x.key === 'L2.$note');
  assert.deepEqual([row.kind, row.by, row.state], ['note', 'default', 'built']);
  assert.deepEqual(checkListReds(d), []);
  const call = p.calls.find((c) => c.name === 'answer_note_question');
  assert.deepEqual(call?.options.toolChoice, { name: 'answer_note_question' });
  assert.equal(call?.options.thinkingMode, 'off');
  assert.match(call?.messages[1].content ?? '', /LINE 2: list 3 flights from Madrid to Rome/);
  assert.ok(!/under \$150/.test(call?.messages[1].content ?? ''), 'the AI sees the line text only, never a ~ rule');
});

test('a facts-only line answered no gets no note row and no text part', async (t) => {
  const { declaration: d } = await plan(t, { answer_note_question: NOTE([{ line: 2, writtenWords: 'no' }]) });
  assert.equal(d.checkList.some((/** @type {any} */ x) => x.kind === 'note'), false);
  assert.equal(step2(d).close.picked, undefined);
});

test('a call with no usable answer (text instead of the tool) leaves the line facts-only with a Not checked row; the plan still signs', async (t) => {
  const { declaration: d, p } = await plan(t, { answer_note_question: textOf('yes') });
  assert.equal(p.names().filter((n) => n === 'answer_note_question').length, 2, 'the turn retries once, like every forced turn');
  const row = d.checkList.find((/** @type {any} */ x) => x.key === 'L2.$note');
  assert.deepEqual([row.state, row.reason], ['not-checked', 'could not ask whether line 2 also wants a note']);
  assert.equal(step2(d).close.picked, undefined);
  assert.deepEqual(checkListReds(d), []);
});

test('a facts line that already has a countable part of the person is not asked', async (t) => {
  const picks = [{ line: 2, rule: 3, check: { rule: 'listItems', value: 3 } }, { line: 2, rule: 4, check: { rule: 'maxWords', value: 80 } }];
  const { p, declaration: d } = await plan(t, { answer_note_question: NOTE([{ line: 2, writtenWords: 'yes' }]) }, picks);
  assert.equal(p.names().includes('answer_note_question'), false, 'no turn is paid');
  assert.equal(d.checkList.some((/** @type {any} */ x) => x.kind === 'note'), false);
});

test('the typed reading: every asked line exactly yes or no, else unreadable (no repair)', () => {
  const L = [{ n: 2 }, { n: 4 }];
  assert.equal(decideNote({ lines: [{ line: 2, writtenWords: 'yes' }] }, L), null, 'a line left unanswered');
  assert.equal(decideNote({ lines: [{ line: 2, writtenWords: 'maybe' }, { line: 4, writtenWords: 'no' }] }, L), null);
  assert.equal(decideNote({ lines: [{ line: 2, writtenWords: 'yes' }, { line: 4, writtenWords: 'no' }, { line: 9, writtenWords: 'no' }] }, L), null, 'a line not asked');
  assert.deepEqual([...(decideNote({ lines: [{ line: 4, writtenWords: 'no' }, { line: 2, writtenWords: 'yes' }] }, L) ?? [])], [[4, 'no'], [2, 'yes']]);
  assert.deepEqual(noteAnswers([2, 4], null, L), [{ line: 2, answer: 'failed' }, { line: 4, answer: 'failed' }]);
});

test('replay rebuilds the same plan (the note rides its log entry), and a log with no note entry rebuilds none: an old plan gets no $note row', async (t) => {
  const { dir, declaration: saved } = await plan(t, { answer_note_question: NOTE([{ line: 2, writtenWords: 'yes' }]) });
  const again = (/** @type {any} */ b) => assembleFromBlock({ declaration: { ...b.declaration, checkList: undefined }, block: b.block, lines: b.lines, lineSet: b.lineSet }).declaration;
  const b = rebuildBlock({ planDir: dir, asks: false });
  assert.equal(b.ok, true);
  if (!b.ok) return;
  const rebuilt = again(b);
  assert.deepEqual(rebuilt.checkList, saved.checkList, 'the same signed list');
  assert.deepEqual(rebuilt.steps.map((/** @type {any} */ s) => s.close), saved.steps.map((/** @type {any} */ s) => s.close), 'the same closes');
  // the same plan as the draft saved before this piece: no note entry in its log
  const log = JSON.parse(readFileSync(path.join(dir, 'log.json'), 'utf8'));
  writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ ...log, log: log.log.filter((/** @type {any} */ e) => e.kind !== 'note-ask') }));
  const old = rebuildBlock({ planDir: dir, asks: false });
  assert.equal(old.ok, true);
  if (!old.ok) return;
  assert.equal(old.block.rows.some((r) => r.kind === 'note'), false);
  assert.equal(again(old).checkList.some((/** @type {any} */ x) => x.kind === 'note'), false);
});

test('a failed question replays as the same Not checked row', async (t) => {
  const { dir, declaration: saved } = await plan(t, { answer_note_question: textOf('yes') });
  const b = rebuildBlock({ planDir: dir, asks: false });
  assert.equal(b.ok, true);
  if (!b.ok) return;
  const row = b.block.rows.find((r) => r.key === 'L2.$note');
  assert.deepEqual([row?.state, row?.reason], ['not-checked', 'could not ask whether line 2 also wants a note']);
  assert.deepEqual(saved.checkList.find((/** @type {any} */ x) => x.key === 'L2.$note').state, 'not-checked');
});

test('a note row whose line stops being facts-only (its last fact dropped) is no check any more (pins the existing row loop: the row is not built again, no code of its own)', () => {
  const texts = { notes: rd('m14-walk-5/notes.md') };
  const B = newJobBlock({ texts, // F251: the line has a ~ rule of the person's, so the Add of its fact is a signable check
  jobLines: [{ n: 1, text: 'Find the raised bed and write a note about it', rule: 'must name the raised bed', rules: ['must name the raised bed'] }] });
  B.reconcile();
  B.applyDelta({ edits: [{ op: 'add', kind: 'phrase', line: 1, name: 'raised bed', words: ['Raised bed by the fence'], source: 'notes' }] });
  B.reconcile();
  const key = B.rows.find((r) => r.kind === 'phrase')?.key ?? '';
  assert.deepEqual(B.rowChoice(key, 'add'), { ok: true });
  B.setNotes([{ line: 1, answer: 'yes' }]);
  const note = () => B.rows.find((r) => r.kind === 'note');
  assert.equal(note()?.state, 'built', 'the line is facts-only and was answered yes');
  assert.deepEqual(B.rowChoice(key, 'drop'), { ok: true });
  B.reconcile();
  assert.equal(note()?.state, 'not-checked');
  assert.equal(note()?.part, null);
});

/** the schema and the brief the model step of line 2 gets in a real run of the signed plan */
async function modelStepSeen(/** @type {import('node:test').TestContext} */ t, /** @type {string} */ answer) {
  const { dir, root, home } = await plan(t, { answer_note_question: NOTE([{ line: 2, writtenWords: answer }]) });
  const hash = readFileSync(path.join(dir, 'spec.hash'), 'utf8').trim();
  const s = signDraft({ dir, approve: hash, signedBy: 'hamr', signedAt: '2026-11-15T10:00:00Z' });
  assert.equal(s.ok, true, JSON.stringify(s.reds));
  /** @type {{schema: any, brief: any}[]} */
  const seen = [];
  const provider = {
    generate: async (/** @type {any[]} */ messages, /** @type {any[]} */ tools) => {
      const user = JSON.parse(messages.find((m) => m.role === 'user').content);
      if (user.quoting) seen.push({ schema: tools[0].parameters, brief: user });
      return { text: null, toolCalls: [{ id: 'e', name: 'emit_artifact', arguments: { results: [], done: true } }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'tool_calls', model: 'deepseek-flash' };
    },
  };
  const catalogue = loadCatalogue().primitives;
  const modelStep = makeLiveModelStep({ spendPath: path.join(home, 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
  await runFlow({ root, name: 'flights', runId: 'run-1', catalogue, modelStep, askStep: makeParkingAskStep(), sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-11-18', sources: [{ id: 'flights', path: ADDRESS }], fetchPage });
  return seen;
}

test('through the run: a signed note-plus-fact line is offered a `text` box and told to write it; a facts-only line is not', async (t) => {
  const yes = await modelStepSeen(t, 'yes');
  assert.ok(yes.length >= 1, 'the fact step reached the provider');
  assert.ok(yes[0].schema.properties.text && yes[0].schema.required.includes('text'));
  assert.match(String(yes[0].brief.alsoWrite), /Also give "text"/);
  const no = await modelStepSeen(t, 'no');
  assert.ok(no.length >= 1);
  assert.equal('text' in no[0].schema.properties, false);
  assert.equal('alsoWrite' in no[0].brief, false);
});
