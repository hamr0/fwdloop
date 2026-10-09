// M4e amendment 40: "Not checked" looks like the plan: one folded details.plan-fold with the exact label, items as plan rows (no boxes, no bold head). $0.
// The look itself is a browser walk; these pin the structure and the CSS.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const rule = (sel) => { const m = PAGE.match(new RegExp(`${sel.replace(/[.[\]>#]/g, '\\$&')}\\{([^}]*)\\}`)); return m ? m[1] : ''; };
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
const LABEL = "not checked (the AI's own reading)";
const PLAN = (nc) => ({ steps: [{ step: 1, line: 1, reads: [], makes: 'a', mayDo: [], check: ['x'], checkClass: 'hitl', ask: false, waitMs: null }], notChecked: nc });
const JOB = (nc) => ({
  resolved: true, flow: 'f', model: null, modelWhy: 'x', prose: [{ line: 1, text: 'a' }, { line: 2, text: 'b' }],
  guardrails: [], asks: [], sends: [], sources: [], capUsd: 0.5, redoCap: 3, signature: null, signatureWhy: 'unsigned', plan: PLAN(nc),
});
const tail = (nc, extra) => render({ ...JOB(nc), ...(extra || {}) }).els['details-plan-tail'].children;
const nc = (tl) => tl[tl.length - 1];

test('Not checked is one folded details.plan-fold.plan-notchecked, last in the tail, with the exact lowercase label as its summary', () => {
  const n = nc(tail({ recorded: true, items: ['tone', 'the JD match'] }));
  assert.equal(n.tag, 'details');
  assert.equal(n.className, 'plan-fold plan-notchecked');
  assert.equal(n.children[0].tag, 'summary');
  assert.equal(n.children[0].className, 'plan-sum');
  assert.equal(n.children[0].textContent, LABEL);
  assert.notEqual(n.open, true, 'folded by default');
  assert.equal(n.attrs.open, undefined);
});

test('items are plan rows, one each; no ro-value boxes and no plan-head anywhere in the tail', () => {
  const n = nc(tail({ recorded: true, items: ['tone', 'the JD match'] }));
  assert.deepEqual(n.children.slice(1).map((c) => `${c.className}|${c.textContent}`), ['plan-row|tone', 'plan-row|the JD match']);
  const all = walk({ tag: 'div', className: '', textContent: '', children: tail({ recorded: true, items: ['tone'] }) }).join('\n');
  assert.doesNotMatch(all, /ro-value|plan-head\|Not checked/);
});

test('an empty list and an older flow each show one plan row under the same folded line', () => {
  let n = nc(tail({ recorded: true, items: [] }));
  assert.equal(n.children[0].textContent, LABEL);
  assert.deepEqual(n.children.slice(1).map((c) => `${c.className}|${c.textContent}`), ['plan-row|the AI listed nothing']);
  n = nc(tail({ recorded: false, items: [] }));
  assert.equal(n.children[0].textContent, LABEL);
  assert.deepEqual(n.children.slice(1).map((c) => `${c.className}|${c.textContent}`), ['plan-row|not recorded (signed before amendment 34)']);
});

test('it comes after the last job line (and any stray step fold) and before Ask in the page', () => {
  const d = render(JOB({ recorded: true, items: ['t'] }));
  assert.equal(d.els['details-prose'].children.length, 2);
  const grid = PAGE.slice(PAGE.indexOf('<div id="job-grid"'));
  assert.ok(grid.indexOf('id="details-prose"') < grid.indexOf('id="details-plan-tail"'));
  assert.ok(grid.indexOf('id="details-plan-tail"') < grid.indexOf('id="details-asks"'));
  const stray = tail({ recorded: true, items: [] }, { plan: { ...PLAN({ recorded: true, items: [] }), steps: [{ step: 9, line: null, reads: [], makes: 'z', mayDo: [], check: [], checkClass: 'hitl', ask: false, waitMs: null }] } });
  assert.equal(stray.length, 2);
  assert.equal(stray[0].className, 'plan-fold');
  assert.equal(stray[1].className, 'plan-fold plan-notchecked');
});

test('CSS: same indent as a step fold, a clear gap before Ask, and the bold tail head style is gone', () => {
  assert.doesNotMatch(PAGE, /#details-plan-tail \.plan-head/);
  assert.match(rule('#details-plan-tail'), /margin-bottom:1[4-9]px|margin-bottom:2\dpx/);
  assert.doesNotMatch(rule('.plan-notchecked'), /margin-left/, 'inherits .plan-fold indent');
});

test('the legend is still the last thing in the Job grid', () => {
  const grid = PAGE.slice(PAGE.indexOf('<div id="job-grid"'), PAGE.indexOf('</section>', PAGE.indexOf('<div id="job-grid"')));
  assert.ok(grid.indexOf('plan-legend') > grid.indexOf('id="details-signature"'));
});
