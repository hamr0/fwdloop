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
  const src = ['duration', 'plainWait', 'textDiv', 'renderRowsField', 'readableDateTime', 'renderJob'].map(fn).join('\n');
  const run = new Function('document', `${src}\nreturn { renderJob, plainWait };`)(document);
  run.renderJob(job);
  return { document, plainWait: run.plainWait };
}
const JOB = {
  resolved: true, flow: 'f', model: null, modelWhy: 'x',
  prose: [{ line: 1, text: 'Read my resume,' }, { line: 3, text: 'write me a summary,' }, { line: 4, text: 'check it with me,' }, { line: 5, text: 'and write it out.' }],
  guardrails: [{ line: 3, guardrail: '3 sections, all under 600 words' }, { line: 4, guardrail: 'nothing goes out before I accept' }],
  asks: [{ line: 4, question: 'check it with me', waitMs: 3600000 }],
  sends: [{ line: 5, kind: 'file', target: '/tmp/out' }],
  sources: [], success: [], capUsd: 0.5, redoCap: 3, signature: null, signatureWhy: 'unsigned',
};

test('(g) each guardrail is a "~" row under its own line, the wait under the ask line, the destination under the send line', () => {
  const { document } = render(JOB);
  assert.deepEqual(rows(document.els['details-prose']), [
    'ro-value|1. Read my resume,',
    'ro-value|3. write me a summary,',
    'ro-value sub|~ 3 sections, all under 600 words',
    'ro-value|4. check it with me,',
    'ro-value sub|~ nothing goes out before I accept',
    'ro-value sub|~ waits 1h',
    'ro-value|5. and write it out.',
    'ro-value sub|~ writes out to /tmp/out',
  ]);
  assert.equal(rows(document.els['details-asks'])[0], 'ro-value|line 4 · "check it with me" · waits 1h', 'the Ask row uses the same formatter');
});

test('(g) there is no Guardrails block; Ask, Source, Destination, Success, Signed stay', () => {
  assert.doesNotMatch(PAGE, /details-guardrails/);
  for (const id of ['details-asks', 'details-sources', 'details-sends', 'details-success', 'details-signature']) assert.match(PAGE, new RegExp(`id="${id}"`));
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

test('(f) the cap line is "$<cap> per run · redo up to <n>"; never "time cap"', () => {
  const { document } = render(JOB);
  assert.equal(document.els['details-cap'].textContent, '$0.50 per run · redo up to 3');
  assert.doesNotMatch(PAGE, /time cap/i);
});
