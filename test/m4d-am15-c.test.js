// M4d amendment 15 applies to EVERY line of the Chat list: the revise lines and the redraft after answers are one line, facts joined by " · ", no details, folds or raw text;
// a red one has one plain reason and a Fix line; while a question is open the plan-checks line is not red and has no Fix. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draftStepList, reviseStepList } from '../src/draft-steps.js';
import { buildSetupRows } from '../src/setup.js';
import { RULES_PRELUDE } from './plan-check-rules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const fn = (name) => { const a = PAGE.indexOf(`    function ${name}(`); assert.ok(a !== -1, name); return PAGE.slice(a, PAGE.indexOf('\n    }\n', a) + 7); };
const steps = new Function(`${RULES_PRELUDE}\n${fn('plainPlanCheck')}\n${fn('failedDetails')}\n${fn('stepsFor')}\nreturn stepsFor;`)();
const SECTION_RED = 'declaration: steps[2].close.shape.sections names "How I match" which is not in the job line\'s words';
const log = (extra = {}) => ({ ok: true, rounds: 2, costUsd: 0.0016, spendComplete: true, modelId: 'deepseek-flash', log: [{ round: 1, kind: 'first', outcome: 'valid' }], ...extra });
const redLog = () => log({ ok: false, reds: [SECTION_RED], rounds: 2, log: [{ round: 1, kind: 'first', outcome: 'validator: 1 red(s)', reds: [SECTION_RED] }, { round: 2, kind: 'revision', outcome: 'validator: 1 red(s)', reds: [SECTION_RED] }] });

test('1: a green revise is one line with its facts; one that needed tries says "fixed by the AI after N tries"', () => {
  assert.deepEqual(reviseStepList({ log: log(), name: 'revise 1' }).map((l) => [l.status, l.label]), [['done', 'revise 1 · deepseek-flash · 2 rounds · $0.0016']]);
  const fixed = log({ rounds: 3, log: [{ round: 1, kind: 'first', outcome: 'validator: 1 red(s)', reds: [SECTION_RED] }, { round: 2, kind: 'revision', outcome: 'validator: 1 red(s)', reds: [SECTION_RED] }, { round: 3, kind: 'revision', outcome: 'valid' }] });
  assert.equal(reviseStepList({ log: fixed, name: 'drafted again with your answers' })[0].label, 'drafted again with your answers · deepseek-flash · 3 rounds · $0.0016 · fixed by the AI after 2 tries');
});

test('1: a red revise is ONE plain reason on its ✗ line and ONE Fix line; no details, no raw text', () => {
  const l = reviseStepList({ log: redLog(), name: 'revise 2' });
  assert.deepEqual(l.map((x) => [x.id, x.status, x.label, x.note === true]), [
    ['plan', 'failed', "revise 2 · A section name in the plan's check is not in your job line", false],
    ['plan-fix', 'done', 'Fix: Change the job line to use the section words you want.', true],
  ]);
  assert.ok(l.every((x) => x.details.length === 0));
  assert.doesNotMatch(JSON.stringify(l), /declaration:/);
  assert.equal(reviseStepList({ log: null, name: 'revise 1' }), null);
});

test('1 (page): the revise and redraft lines are the server\'s lines, never details, a fold or raw text', () => {
  const rv = (n, kind, phase, name, lines) => ({ n, kind, phase, name, lines, reds: [SECTION_RED] });
  const s = steps({ phase: 'green', card: {}, stepList: [{ id: 'drafted', label: 'drafted · m · 1 round · $0.0001', status: 'done', details: [] }], revises: [
    rv(1, 'revise', 'red', 'revise 1', reviseStepList({ log: redLog(), name: 'revise 1' })),
    rv(2, 'answers', 'green', 'drafted again with your answers', reviseStepList({ log: log(), name: 'drafted again with your answers' })),
  ] }, { model: 'm', starting: false, signClicked: false });
  const rows = s.filter((x) => x.id.startsWith('revise-'));
  assert.deepEqual(rows.map((x) => `${x.status}${x.note ? ':note' : ''}:${x.label}`), [
    "failed:revise 1 · A section name in the plan's check is not in your job line",
    'done:note:Fix: Change the job line to use the section words you want.',
    'done:drafted again with your answers · deepseek-flash · 2 rounds · $0.0016',
  ]);
  for (const r of rows) { assert.deepEqual(r.details, []); assert.equal(r.raw, undefined); }
});

test('2: while a question is open the plan-checks line is "plan checks · a question for you", not red, with no Fix', () => {
  const l = draftStepList({ log: redLog(), declaration: { steps: [] }, questionOpen: true });
  const checks = l.find((x) => x.id === 'checks');
  assert.deepEqual([checks.status, checks.label], ['waiting', 'plan checks · a question for you']);
  assert.ok(!l.some((x) => x.id === 'checks-fix'));
  assert.ok(!l.some((x) => x.status === 'failed'), 'nothing red: the draft has not ended');
  const ended = draftStepList({ log: redLog(), declaration: { steps: [] } });
  assert.equal(ended.find((x) => x.id === 'checks').status, 'failed', 'a draft that ENDED red keeps its red line');
});

test('2 (page): a "waiting" list line is drawn amber with no ✓/✗, not as done', () => {
  const s = steps({ phase: 'questions-open', card: {}, revises: [], openK: 1, total: 1, stepList: [{ id: 'checks', label: 'plan checks · a question for you', status: 'waiting', details: [] }] }, { model: 'm', starting: false });
  assert.deepEqual(s.map((x) => `${x.id}:${x.status}`), ['checks:waiting', 'question:waiting']);
});

test('the Audit tries already cover revise and redraft plan rows (setup.jsonl keeps each plan folder\'s tries)', () => {
  const s = mkdtempSync(path.join(tmpdir(), 'fwdloop-am15c-'));
  const mk = (rel, lg) => { mkdirSync(path.join(s, rel), { recursive: true }); writeFileSync(path.join(s, rel, 'log.json'), JSON.stringify(lg)); writeFileSync(path.join(s, rel, 'spec.hash'), 'h\n'); };
  writeFileSync(path.join(s, 'card.json'), '{}'); writeFileSync(path.join(s, 'card-1.json'), '{}'); writeFileSync(path.join(s, 'card-2.json'), '{}'); writeFileSync(path.join(s, 'redraft-2.json'), '{}');
  const withTries = log({ rounds: 2, log: [{ round: 1, kind: 'first', outcome: 'validator: 1 red(s)', reds: [SECTION_RED] }, { round: 2, kind: 'revision', outcome: 'valid' }] });
  mk('draft', log()); mk('draft-1', withTries); mk('draft-2', withTries);
  const rows = buildSetupRows({ sessionDir: s, planDir: path.join(s, 'draft-2'), hash: 'h', signedBy: 'a', signedAt: '2026-10-12T10:00:00Z' });
  assert.deepEqual(rows.filter((r) => ['draft', 'revise', 'redraft'].includes(r.kind)).map((r) => [r.kind, Array.isArray(r.tries)]), [['draft', false], ['revise', true], ['redraft', true]]);
});
