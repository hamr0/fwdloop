// M4e amendments 34 + 37: the Job tab is one column: each signed line, its ~ rows, then its step folded under it (the plan is read from the signed flow's
// own files: declaration.json for the steps and their checks, the setup.jsonl sign row for "Not checked"). $0. The layout itself is a browser walk.
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
    assert.equal(s.checkClass, checked[i].class, 'the typed close class rides along so the page never reads prose');
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

test('the page (am37): one column, no side-by-side grid, no two block headings; the fold is a native details/summary; a plan colour token in both themes', () => {
  assert.doesNotMatch(PAGE, /What you asked/);
  assert.doesNotMatch(PAGE, /What the plan does/);
  assert.doesNotMatch(PAGE, /@container/);
  assert.doesNotMatch(PAGE, /container-type/);
  assert.doesNotMatch(PAGE, /\.jg[-{ ]|jg-asked|jg-plan-side|id="job-grid"[^>]*class="jg"/);
  assert.doesNotMatch(PAGE, /details-success/);
  assert.match(PAGE, /Not checked \(the AI's own reading\)/);
  assert.match(PAGE, /nothing \(pure stop\)/);
  assert.match(PAGE, /ASK · waits /);
  assert.match(PAGE, /not recorded \(signed before amendment 34\)/);
  assert.match(PAGE, /createElement\("details"\)/);
  assert.match(PAGE, /createElement\("summary"\)/);
  const tokens = PAGE.match(/--plan:#[0-9a-fA-F]{3,8}/g) || [];
  assert.ok(tokens.length >= 3, `--plan must be defined for dark, light (media) and light (attr): ${tokens}`);
  assert.match(PAGE, /\.plan-sum::before\{[^}]*color:var\(--plan\)/); // am39: only the marker carries the plan colour
});

// ---- the renderer, run against a tiny fake DOM (the real layout is the browser walk) ----
const fn = (name) => {
  const start = PAGE.indexOf(`  function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }\n', start) + 5);
};
function fakeDom() {
  const els = {};
  const mk = (tag) => {
    const e = {
      tag, children: [], className: '', textContent: '', hidden: false, attrs: {},
      appendChild(c) { e.children.push(c); return c; },
      setAttribute(k, v) { e.attrs[k] = v; },
    };
    Object.defineProperty(e, 'innerHTML', { set() { e.children = []; }, get() { return ''; } });
    return e;
  };
  return { getElementById: (id) => (els[id] ??= mk('div')), createElement: (t) => mk(t), els };
}
function render(job) {
  const document = fakeDom();
  const src = ['duration', 'plainWait', 'textDiv', 'renderRowsField', 'readableDateTime', 'stepSummaryText', 'jobStepFold', 'paintJobPlan', 'renderJob'].map(fn).join('\n');
  new Function('document', `${src}\nreturn { renderJob };`)(document).renderJob(job);
  return document;
}
const walk = (e) => [`${e.tag === 'div' ? '' : `<${e.tag}>`}${e.className}|${e.textContent}`, ...e.children.flatMap(walk)];
const PLAN = {
  steps: [
    { step: 1, line: 1, reads: [], makes: 'resume-text', mayDo: ['readDocx'], check: ['No machine check of the content: you check it at the ask.'], checkClass: 'hitl', ask: false, waitMs: null },
    { step: 2, line: 3, reads: ['resume-text', 'jd-text'], makes: 'resume-summary', mayDo: ['read'], check: ['The reply is checked as plain text only.', 'The whole output is under 600 words.'], checkClass: 'softgreen', ask: false, waitMs: null },
    { step: 3, line: 3, reads: ['resume-summary'], makes: 'summaryResume', mayDo: [], check: ['z'], checkClass: 'softgreen', ask: false, waitMs: null },
    { step: 4, line: 4, reads: ['resume-summary'], makes: 'approved', mayDo: [], check: ['x'], checkClass: 'hitl', ask: true, waitMs: 5400000 },
  ],
  notChecked: { label: 'l', items: ['tone', 'the JD match'], recorded: true },
};
const JOB = {
  resolved: true, flow: 'f', model: null, modelWhy: 'x',
  prose: [{ line: 1, text: 'a' }, { line: 2, text: 'no step here' }, { line: 3, text: 'c' }, { line: 4, text: 'd' }],
  guardrails: [{ line: 3, guardrail: 'g3' }], asks: [{ line: 4, question: 'q', waitMs: 5400000 }], sends: [], sources: [], capUsd: 0.5, redoCap: 3, signature: null, signatureWhy: 'unsigned', plan: PLAN,
};
const lineEls = (d) => d.els['details-prose'].children;

test('one column: each job line is one wrapper holding the line, its ~ rows, then its steps folded; a line with no step is just the line', () => {
  const d = render(JOB);
  assert.equal(lineEls(d).length, 4);
  assert.ok(lineEls(d).every((l) => l.attrs.style === undefined), 'no grid row styling');
  assert.deepEqual(lineEls(d).map((l) => l.children.map((c) => c.tag)), [['div', 'details'], ['div'], ['div', 'div', 'details', 'details'], ['div', 'div', 'details']]);
  assert.equal(d.els['details-plan'], undefined, 'no separate plan block');
});

test('each step\'s fold comes right after its line\'s last ~ row, in step order', () => {
  const l3 = lineEls(render(JOB))[2].children;
  assert.deepEqual(l3.map((c) => c.className), ['ro-value', 'ro-value sub', 'plan-fold', 'plan-fold']);
  assert.equal(l3[1].textContent, '~ g3');
  assert.match(l3[2].children[0].textContent, /step 2 /);
  assert.match(l3[3].children[0].textContent, /step 3 /);
});

test('the summary text: "step N · <may do> → <makes> · machine check | you check"; no grant leaves just "→ makes"', () => {
  const l = lineEls(render(JOB));
  assert.equal(l[0].children[1].children[0].textContent, 'step 1 · readDocx → resume-text · you check');
  assert.equal(l[2].children[2].children[0].textContent, 'step 2 · read → resume-summary · machine check');
  assert.equal(l[2].children[3].children[0].textContent, 'step 3 · → summaryResume · machine check');
});

test('the ask step\'s summary reads "step N · ASK · waits <wait>" in plain units', () => {
  assert.equal(lineEls(render(JOB))[3].children[2].children[0].textContent, 'step 4 · ASK · waits 1h 30m');
});

test('a write step on a line with a signed destination shows "→ <destination>"', () => {
  const j = {
    ...JOB, sends: [{ line: 3, kind: 'file', target: '/tmp/out' }],
    plan: { ...PLAN, steps: PLAN.steps.map((s) => (s.step === 2 ? { ...s, mayDo: ['write'] } : s)) },
  };
  assert.equal(lineEls(render(j))[2].children.find((c) => c.tag === 'details').children[0].textContent, 'step 2 · write → resume-summary → /tmp/out · machine check');
});

test('the fold is a details with a summary first; the plan rows carry the plan-colour classes', () => {
  const fold = lineEls(render(JOB))[2].children[2];
  assert.equal(fold.tag, 'details');
  assert.equal(fold.children[0].tag, 'summary');
  assert.equal(fold.children[0].className, 'plan-sum');
  assert.equal(fold.className, 'plan-fold');
});

test('the open detail shows from line, reads, makes, may do and its check (same values as before)', () => {
  const fold = lineEls(render(JOB))[2].children[2];
  assert.deepEqual(walk(fold).slice(2), [
    'plan-head|step 2 · from line 3', 'plan-row|reads: resume-text, jd-text', 'plan-row|makes: resume-summary', 'plan-row|may do: read',
    'plan-row|check: The reply is checked as plain text only. The whole output is under 600 words.',
  ]);
});

test('no reads reads "nothing"; no grants reads "nothing (pure stop)"; the ask step shows "ASK · waits <wait>" in the check row', () => {
  const l = lineEls(render(JOB));
  assert.ok(walk(l[0].children[1]).includes('plan-row|reads: nothing'));
  assert.ok(walk(l[2].children[3]).includes('plan-row|may do: nothing (pure stop)'));
  assert.ok(walk(l[3].children[2]).includes('plan-row|check: ASK · waits 1h 30m'));
});

test('a step from no listed line goes to the tail, before Not checked', () => {
  const j = { ...JOB, plan: { ...PLAN, steps: [...PLAN.steps, { ...PLAN.steps[0], step: 5, line: null }] } };
  const t = render(j).els['details-plan-tail'].children;
  assert.equal(t[0].tag, 'details');
  assert.equal(t[1].textContent, "Not checked (the AI's own reading)");
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

test('your words and the plan never share an element: no ro-value / sub row carries plan text', () => {
  const rowsOfWords = lineEls(render(JOB)).flatMap((l) => l.children.filter((c) => c.tag === 'div')).flatMap(walk).join('\n');
  assert.doesNotMatch(rowsOfWords, /reads:|makes:|may do:|check:|Not checked|› step/);
});

test('a run with its own signed values shows that run\'s plan (the wait on the ask step follows the job data)', () => {
  const j = { ...JOB, asks: [{ line: 4, question: 'q', waitMs: 1800000 }], plan: { ...PLAN, steps: PLAN.steps.map((s) => (s.ask ? { ...s, waitMs: 1800000 } : s)) } };
  assert.equal(lineEls(render(j))[3].children[2].children[0].textContent, 'step 4 · ASK · waits 30m');
});
