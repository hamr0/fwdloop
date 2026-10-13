// M4d amendment 15 piece B: the Audit tab's Draft group gets one row per try: `try N ✗|✓` with its plain reason, the raw checker text under it
// (`raw`); the free retry reads `try N again`. The tries ride in setup.jsonl's plan rows (written once at sign time from the draft's log.json).
// A draft that is never signed has no run, so no Audit; its history stays in its log.json. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { buildSetupRows, readSetup, SETUP_FILE } from '../src/setup.js';
import { getDraftBlock } from '../src/panel/data.js';

const SECTION_RED = 'declaration: steps[2].close.shape.sections names "How I match" which is not in the job line\'s words';
const LOG = {
  ok: true, rounds: 4, structureRetries: 1, modelId: 'deepseek-flash',
  log: [
    { round: 1, kind: 'first', outcome: 'validator: 1 red(s)', reds: [SECTION_RED] },
    { round: 2, kind: 'revision', outcome: 'validator: 2 red(s)', reds: ['declaration: line 3 is neither served by any step', SECTION_RED] },
    { round: 3, kind: 'revision', outcome: "structure: the tool call's arguments were not valid JSON (position 846)" },
    { round: 4, kind: 'structure-retry', outcome: 'valid' },
  ],
};

function flowWithDraft() {
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-am15b-'));
  const plan = path.join(work, 'draft');
  mkdirSync(plan, { recursive: true });
  writeFileSync(path.join(plan, 'log.json'), JSON.stringify(LOG));
  writeFileSync(path.join(plan, 'spec.hash'), 'abc123\n');
  const flowDir = path.join(work, 'flow');
  const runDir = path.join(flowDir, 'runs', 'run-1');
  mkdirSync(runDir, { recursive: true });
  const rows = buildSetupRows({ planDir: plan, hash: 'abc123', signedBy: 'hamr', signedAt: '2026-10-12T10:00:00Z' });
  writeFileSync(path.join(flowDir, SETUP_FILE), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return { flowDir, runDir, rows };
}

test('setup: the plan row records every try of the draft (label, passed, raw reds, outcome), from the log\'s one function', () => {
  const { rows } = flowWithDraft();
  const d = rows.find((r) => r.kind === 'draft');
  assert.deepEqual(d.tries.map((t) => [t.label, t.passed]), [['try 1', false], ['try 2', false], ['try 3', false], ['try 3 again', true]]);
  assert.deepEqual(d.tries[0].reds, [SECTION_RED]);
  assert.equal(d.tries[2].outcome, 'the reply came back broken; one free retry');
});

test('Audit Draft group: one row per try, "try N ✗/✓" with its plain reason and the raw checker text; the free retry is "try 3 again"', () => {
  const { flowDir, runDir } = flowWithDraft();
  const rows = getDraftBlock(flowDir, runDir).rows.filter((r) => /^try \d/.test(r.action ?? ''));
  assert.deepEqual(rows.map((r) => r.action), ['try 1 ✗', 'try 2 ✗', 'try 3 ✗', 'try 3 again ✓']);
  assert.deepEqual(rows.map((r) => r.verdict), ['red', 'red', 'red', 'green']);
  assert.equal(rows[0].gap, "A section name in the plan's check is not in your job line");
  assert.deepEqual(rows[0].raw, [SECTION_RED]);
  assert.equal(rows[1].gap, 'A line of your job is not covered by any step (and 1 more)');
  assert.equal(rows[1].raw.length, 2);
  assert.equal(rows[2].gap, 'the reply came back broken; one free retry');
  assert.deepEqual(rows[2].raw, ["the tool call's arguments were not valid JSON (position 846)"]);
  assert.equal(rows[3].gap, '');
  assert.ok(rows.every((r) => r.setup === true && r.step === 'drafting'));
});

test('a single try that passed adds no try rows; a flow signed before am15 (no tries recorded) adds none', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-am15b-'));
  const flowDir = path.join(work, 'flow');
  mkdirSync(path.join(flowDir, 'runs', 'run-1'), { recursive: true });
  const plan = (log) => { const d = path.join(work, 'p', String(Math.random())); mkdirSync(d, { recursive: true }); writeFileSync(path.join(d, 'log.json'), JSON.stringify(log)); writeFileSync(path.join(d, 'spec.hash'), 'h\n'); return d; };
  const one = buildSetupRows({ planDir: plan({ ok: true, rounds: 1, log: [{ round: 1, kind: 'first', outcome: 'valid' }] }), hash: 'h', signedBy: 'a', signedAt: '2026-10-12T10:00:00Z' });
  assert.equal(one.find((r) => r.kind === 'draft').tries, undefined);
  writeFileSync(path.join(flowDir, SETUP_FILE), `${one.map((r) => JSON.stringify(r)).join('\n')}\n`);
  assert.equal(getDraftBlock(flowDir, path.join(flowDir, 'runs', 'run-1')).rows.filter((r) => /^try /.test(r.action ?? '')).length, 0);
  assert.equal(readSetup(flowDir).present, true);
});

import { readFileSync } from 'node:fs';
import { HERE } from './m4e-world.mjs';
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const fnOf = (name) => { const a = PAGE.indexOf(`  function ${name}(`); assert.ok(a !== -1, name); return PAGE.slice(a, PAGE.indexOf('\n  }\n', a) + 5); };

test('page: a try row\'s raw text goes under its plain reason in the Gap cell, escaped; a row with none adds nothing', () => {
  const raw = new Function('escapeXml', `${fnOf('auditRawHtml')}\nreturn auditRawHtml;`)((x) => String(x).replace(/</g, '&lt;'));
  assert.equal(raw({}), '');
  assert.equal(raw({ raw: [] }), '');
  assert.equal(raw({ raw: ['declaration: a <b>', 'two'] }), '<div class="audit-raw">declaration: a &lt;b></div><div class="audit-raw">two</div>');
  assert.match(PAGE, /"<td data-label=\\"Gap\\">" \+ escapeXml\(isRejectRow \? "" : auditGapText\(r\)\) \+ auditRawHtml\(r\) \+ "<\/td>"/);
  assert.match(PAGE, /lines\.push\(\["raw", r\.raw\.join/);
});

test('a try row has no cost of its own: the Cost cell reads "—", never "unknown"', () => {
  const cost = new Function('money', 'duration', `${fnOf('auditCostCellText')}\nreturn auditCostCellText;`)(() => 'unknown', () => '');
  assert.equal(cost({ setup: true, tryRow: true, verdict: 'red' }), '—');
  assert.equal(cost({ setup: true, tryRow: true, verdict: 'green' }), '—');
  const { flowDir, runDir } = flowWithDraft();
  assert.ok(getDraftBlock(flowDir, runDir).rows.filter((r) => /^try /.test(r.action ?? '')).every((r) => r.tryRow === true));
});
