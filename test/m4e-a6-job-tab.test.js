// M4e amendment 6 items 5-6 (negatives (f) (g)): the Job tab reads like the card. renderJob and its helpers are cut out of index.html
// and run against a tiny fake DOM; real rendering at 1280/390/320 px is a browser walk.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const fn = (name) => {
  const start = PAGE.indexOf(`  function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }\n', start) + 5);
};

function fakeDom() {
  const els = {};
  const mk = () => {
    const e = {
      children: [], className: '', textContent: '', hidden: false,
      appendChild(c) { e.children.push(c); return c; },
      setAttribute(k, v) { (e.attrs ??= {})[k] = v; },
    };
    Object.defineProperty(e, 'innerHTML', { set() { e.children = []; }, get() { return ''; } });
    return e;
  };
  return {
    getElementById: (id) => (els[id] ??= mk()),
    createElement: () => mk(),
    els,
  };
}
const rows = (el) => el.children.map((c) => `${c.className}|${c.textContent}`);

function render(job) {
  const document = fakeDom();
  const src = ['duration', 'plainWait', 'textDiv', 'renderRowsField', 'readableDateTime', 'stepSummaryText', 'jobStepFold', 'paintJobPlan', 'renderJob'].map(fn).join('\n');
  const run = new Function('document', `${src}\nreturn { renderJob, plainWait };`)(document);
  run.renderJob(job);
  return { document, plainWait: run.plainWait };
}
const PLAN = {
  steps: [
    { step: 1, line: 1, reads: [], makes: 'resume-text', mayDo: ['readDocx'], check: ['No machine check of the content: you check it at the ask.'], ask: false, waitMs: null },
    { step: 2, line: 3, reads: ['resume-text'], makes: 'resume-summary', mayDo: ['read'], check: ['The reply is checked as plain text only.', 'The whole output is under 600 words.'], ask: false, waitMs: null },
    { step: 3, line: 4, reads: ['resume-summary'], makes: 'resume-summary-approved', mayDo: [], check: ['x'], ask: true, waitMs: 3600000 },
    { step: 4, line: 5, reads: ['resume-summary'], makes: 'out', mayDo: ['write'], check: ['y'], ask: false, waitMs: null },
  ],
  notChecked: { label: 'l', items: ['tone'], recorded: true },
};
const JOB = {
  resolved: true, flow: 'f', model: null, modelWhy: 'x',
  prose: [{ line: 1, text: 'Read my resume,' }, { line: 3, text: 'write me a summary,' }, { line: 4, text: 'check it with me,' }, { line: 5, text: 'and write it out.' }],
  guardrails: [{ line: 3, guardrail: '3 sections, all under 600 words' }, { line: 4, guardrail: 'nothing goes out before I accept' }],
  asks: [{ line: 4, question: 'check it with me', waitMs: 3600000 }],
  sends: [{ line: 5, kind: 'file', target: '/tmp/out' }],
  sources: [], capUsd: 0.5, redoCap: 3, signature: null, signatureWhy: 'unsigned',
  plan: PLAN,
};

// am37: one wrapper per line (no grid rows); only the words rows (the plan folds are <details>) are compared here
const cells = (el) => el.children.map((c) => ({ rows: c.children.filter((r) => r.className !== 'plan-fold').map((r) => `${r.className}|${r.textContent}`) }));

test('(g) each guardrail is a "~" row under its own line, the wait under the ask line, the destination under the send line; one wrapper per line, no grid row', () => {
  const { document } = render(JOB);
  assert.deepEqual(cells(document.els['details-prose']), [
    { rows: ['ro-value|1. Read my resume,'] },
    { rows: ['ro-value|3. write me a summary,', 'ro-value sub|~ 3 sections, all under 600 words'] },
    { rows: ['ro-value|4. check it with me,', 'ro-value sub|~ nothing goes out before I accept', 'ro-value sub|~ waits 1h'] },
    { rows: ['ro-value|5. and write it out.', 'ro-value sub|~ writes out to /tmp/out'] },
  ]);
  assert.equal(rows(document.els['details-asks'])[0], 'ro-value|line 4 · "check it with me" · waits 1h', 'the Ask row uses the same formatter');
});

test('(g) there is no Guardrails block and no Success box; Ask, Source, Destination, Signed stay', () => {
  assert.doesNotMatch(PAGE, /details-guardrails/);
  assert.doesNotMatch(PAGE, /details-success/);
  for (const id of ['details-asks', 'details-sources', 'details-sends', 'details-signature']) assert.match(PAGE, new RegExp(`id="${id}"`));
});

test('(g) waits read in plain units: 1h, 30m, 1h 30m, never 60m00s', () => {
  const { plainWait } = render(JOB);
  assert.equal(plainWait(3600000), '1h');
  assert.equal(plainWait(1800000), '30m');
  assert.equal(plainWait(5400000), '1h 30m');
  assert.equal(plainWait(90000), '1m 30s');
  assert.equal(plainWait(undefined), 'unknown');
  assert.equal(plainWait(0), 'unknown');
});

test('(f) the cap line is "$<cap> per run · <wait> wait · redo up to <n>"; never "time cap"; several asks "waits 1h, 30m"; no ask no wait (M4e amendment 7 item 4)', () => {
  const { document } = render(JOB);
  assert.equal(document.els['details-cap'].textContent, '$0.50 per run · 1h wait · redo up to 3');
  const two = render({ ...JOB, asks: [{ line: 4, question: 'a', waitMs: 3600000 }, { line: 5, question: 'b', waitMs: 1800000 }] });
  assert.equal(two.document.els['details-cap'].textContent, '$0.50 per run · waits 1h, 30m · redo up to 3');
  const none = render({ ...JOB, asks: [] });
  assert.equal(none.document.els['details-cap'].textContent, '$0.50 per run · redo up to 3');
  assert.doesNotMatch(PAGE, /time cap/i);
});
