// M4e amendment 34: the Job tab holds two blocks. "What you asked" is the human's signed words only; "What the plan does" is read from the signed flow's
// own files (declaration.json for the steps and their checks, the setup.jsonl sign row for "Not checked"). $0. The layout itself is a browser walk.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/index.js';
import { loadCatalogue } from '../src/catalogue.js';
import { getRunJob } from '../src/panel/data.js';
import { NOT_CHECKED_LABEL, checkedLines } from '../src/checked.js';
import { SETUP_FILE } from '../src/setup.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const CAT = loadCatalogue().primitives;
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');

function world(setupRows) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-am34-'));
  const decl = JSON.parse(fixture('job2.m1.declaration.json'));
  const w = writeFlow({
    root, name: 'f', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: decl, signedBy: 'hamr', signedAt: '2026-10-09T12:00:00Z', catalogue: CAT,
  });
  assert.equal(w.ok, true, JSON.stringify(w.reds));
  mkdirSync(path.join(w.dir, 'runs', 'run-1'), { recursive: true });
  if (setupRows) writeFileSync(path.join(w.dir, SETUP_FILE), `${setupRows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return { root, decl, job: () => getRunJob({ root, flow: 'f', runId: 'run-1', catalogue: CAT }) };
}
const SIGN = (items) => ({ kind: 'sign', n: 0, at: '2026-10-09T12:00:00Z', signedBy: 'hamr', hash: 'h', flowHash: 'fh', notChecked: { label: NOT_CHECKED_LABEL, items } });

test('the plan has one row per step: from line, reads, makes, may do, and the check as "Checked" said at sign', () => {
  const x = world([SIGN(['tone'])]);
  const { plan } = x.job();
  assert.equal(plan.steps.length, 5);
  const checked = checkedLines(x.decl, { hasAsk: true });
  plan.steps.forEach((s, i) => {
    assert.equal(s.line, x.decl.steps[i].fromLine);
    assert.deepEqual(s.reads, x.decl.steps[i].reads);
    assert.equal(s.makes, x.decl.steps[i].emits);
    assert.deepEqual(s.check, checked[i].sentences, 'the check is checkedLines, not new wording');
  });
  assert.deepEqual(plan.steps[0].mayDo, ['readDocx']);
  assert.deepEqual(plan.steps[3].mayDo, [], 'the ask step grants nothing: the page says "nothing (pure stop)"');
});

test('the ask step carries its wait; other steps do not', () => {
  const { plan } = world([SIGN([])]).job();
  assert.equal(plan.steps[3].ask, true);
  assert.equal(plan.steps[3].waitMs, 1800000);
  assert.equal(plan.steps.filter((s) => s.ask).length, 1);
});

test('Not checked is read word for word from the setup.jsonl sign row, label always', () => {
  const { plan } = world([SIGN(['tone', 'the JD match'])]).job();
  assert.deepEqual(plan.notChecked, { label: NOT_CHECKED_LABEL, items: ['tone', 'the JD match'], recorded: true });
});

test('a flow signed before amendment 36 says "not recorded", never an empty list', () => {
  for (const rows of [null, [{ kind: 'sign', n: 0, at: 'x', signedBy: 'hamr', hash: 'h' }]]) {
    const { plan } = world(rows).job();
    assert.equal(plan.notChecked.recorded, false);
    assert.equal(plan.notChecked.label, NOT_CHECKED_LABEL);
    assert.deepEqual(plan.notChecked.items, []);
  }
});

test('no Success field any more: the job carries no `success` rows', () => {
  assert.equal('success' in world([SIGN([])]).job(), false);
});

test('the page: two blocks, no Success box, the plan block holds a Not checked label', () => {
  assert.match(PAGE, /What you asked/);
  assert.match(PAGE, /What the plan does/);
  assert.doesNotMatch(PAGE, /details-success/);
  assert.match(PAGE, /Not checked \(the AI's own reading\)/);
  assert.match(PAGE, /nothing \(pure stop\)/);
  assert.match(PAGE, /ASK · waits /);
  assert.match(PAGE, /not recorded \(signed before amendment 34\)/);
});

// ---- the renderer, run against a tiny fake DOM (the real layout is the browser walk) ----
const fn = (name) => {
  const start = PAGE.indexOf(`  function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }\n', start) + 5);
};
function fakeDom() {
  const els = {};
  const mk = () => {
    const e = {
      children: [], className: '', textContent: '', hidden: false, attrs: {},
      appendChild(c) { e.children.push(c); return c; },
      setAttribute(k, v) { e.attrs[k] = v; },
    };
    Object.defineProperty(e, 'innerHTML', { set() { e.children = []; }, get() { return ''; } });
    return e;
  };
  return { getElementById: (id) => (els[id] ??= mk()), createElement: () => mk(), els };
}
function render(job) {
  const document = fakeDom();
  const src = ['duration', 'plainWait', 'textDiv', 'renderRowsField', 'readableDateTime', 'jobStepBox', 'paintJobPlan', 'renderJob'].map(fn).join('\n');
  new Function('document', `${src}\nreturn { renderJob };`)(document).renderJob(job);
  return document;
}
const walk = (e) => [`${e.className}|${e.textContent}`, ...e.children.flatMap(walk)];
const PLAN = {
  steps: [
    { step: 1, line: 1, reads: [], makes: 'resume-text', mayDo: ['readDocx'], check: ['No machine check of the content: you check it at the ask.'], ask: false, waitMs: null },
    { step: 2, line: 3, reads: ['resume-text', 'jd-text'], makes: 'resume-summary', mayDo: ['read'], check: ['The reply is checked as plain text only.', 'The whole output is under 600 words.'], ask: false, waitMs: null },
    { step: 3, line: 3, reads: ['resume-summary'], makes: 'second', mayDo: [], check: ['z'], ask: false, waitMs: null },
    { step: 4, line: 4, reads: ['resume-summary'], makes: 'approved', mayDo: [], check: ['x'], ask: true, waitMs: 5400000 },
  ],
  notChecked: { label: 'l', items: ['tone', 'the JD match'], recorded: true },
};
const JOB = {
  resolved: true, flow: 'f', model: null, modelWhy: 'x',
  prose: [{ line: 1, text: 'a' }, { line: 2, text: 'no step here' }, { line: 3, text: 'c' }, { line: 4, text: 'd' }],
  guardrails: [], asks: [{ line: 4, question: 'q', waitMs: 5400000 }], sends: [], sources: [], capUsd: 0.5, redoCap: 3, signature: null, signatureWhy: 'unsigned', plan: PLAN,
};

test('the plan renders one cell per job line, on that line\'s grid row; a line with no step leaves its cell empty; two steps on one line stack', () => {
  const d = render(JOB);
  const cells = d.els['details-plan'].children;
  assert.deepEqual(cells.map((c) => c.attrs.style), ['--r:2', '--r:3', '--r:4', '--r:5']);
  assert.deepEqual(cells.map((c) => c.children.length), [1, 0, 2, 1]);
  assert.deepEqual(d.els['details-prose'].children.map((c) => c.attrs.style), ['--r:2', '--r:3', '--r:4', '--r:5'], 'the same rows as the job lines');
});

test('a step box shows from line, reads, makes, may do and its check', () => {
  const box = render(JOB).els['details-plan'].children[2].children[0];
  assert.deepEqual(walk(box).slice(1), [
    'plan-head|step 2 · from line 3', 'plan-row|reads: resume-text, jd-text', 'plan-row|makes: resume-summary', 'plan-row|may do: read',
    'plan-row|check: The reply is checked as plain text only. The whole output is under 600 words.',
  ]);
});

test('no reads reads "nothing"; no grants reads "nothing (pure stop)"; the ask step shows "ASK · waits <wait>" in plain units', () => {
  const d = render(JOB);
  const first = walk(d.els['details-plan'].children[0].children[0]);
  assert.ok(first.includes('plan-row|reads: nothing'));
  const second = walk(d.els['details-plan'].children[2].children[1]);
  assert.ok(second.includes('plan-row|may do: nothing (pure stop)'));
  const ask = walk(d.els['details-plan'].children[3].children[0]);
  assert.ok(ask.includes('plan-row|check: ASK · waits 1h 30m'), ask.join('\n'));
});

test('Not checked always carries its label; items one row each; an older flow says it is not recorded', () => {
  let t = walk(render(JOB).els['details-plan-tail']);
  assert.ok(t.includes("plan-head|Not checked (the AI's own reading)"), t.join('\n'));
  assert.ok(t.includes('ro-value|tone') && t.includes('ro-value|the JD match'));
  t = walk(render({ ...JOB, plan: { ...PLAN, notChecked: { label: 'l', items: [], recorded: false } } }).els['details-plan-tail']);
  assert.ok(t.includes("plan-head|Not checked (the AI's own reading)"));
  assert.ok(t.includes('hint|not recorded (signed before amendment 34)'), t.join('\n'));
  t = walk(render({ ...JOB, plan: { ...PLAN, notChecked: { label: 'l', items: [], recorded: true } } }).els['details-plan-tail']);
  assert.ok(t.includes("plan-head|Not checked (the AI's own reading)"));
});

test('"What you asked" holds no plan text: its cells carry only the signed lines, guardrails, waits and destinations', () => {
  const d = render(JOB);
  const text = d.els['details-prose'].children.flatMap(walk).join('\n');
  assert.doesNotMatch(text, /reads:|makes:|may do:|check:|Not checked/);
});

test('a run with its own signed values shows that run\'s plan (the wait on the ask step follows the job data)', () => {
  const j = { ...JOB, asks: [{ line: 4, question: 'q', waitMs: 1800000 }], plan: { ...PLAN, steps: PLAN.steps.map((s) => (s.ask ? { ...s, waitMs: 1800000 } : s)) } };
  assert.ok(walk(render(j).els['details-plan'].children[3].children[0]).includes('plan-row|check: ASK · waits 30m'));
});
