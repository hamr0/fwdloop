// M4e amendment 10: an Audit group header reads in the step card's status form and words, bold; a step the human stopped reads `[■] stopped`; one decider
// (the server's groupState). Negatives (a)-(d), (f), (g); (e) is the browser walk. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { deriveStepGroupState, deriveAuditGroups, SIGN_WORDS } from '../src/panel/data.js';

const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
const cut = (name) => {
  const start = PAGE.indexOf(`\n  function ${name}(`) + 1;
  assert.ok(start > 0, `${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }\n', start) + 5);
};
const stepSignLine = PAGE.split('\n').find((l) => l.trim().startsWith('var STEP_SIGN ='));
const fns = ['countWord', 'money', 'duration', 'draftFigures', 'draftHumanWord', 'draftCallsWord', 'stateWord', 'draftLineText', 'auditGroupHeaderParts', 'auditGroupHeaderText', 'auditStateClass', 'buildStepBoxes'];
const page = new Function(`var signWords=${JSON.stringify(SIGN_WORDS)};function verdictPassed(v){return v==="green"||v==="hitl";}${stepSignLine}\n${fns.map((n) => { try { return cut(n); } catch { return ''; } }).join('\n')}
return {stateWord, auditStateClass, auditGroupHeaderText, draftLineText, buildStepBoxes, auditGroupHeaderParts: typeof auditGroupHeaderParts === 'undefined' ? null : auditGroupHeaderParts};`)();

const row = (verdict, step = 's1', extra = {}) => ({ step, verdict, class: 'green', wallMs: 1000, usd: 0.005, spendComplete: true, ...extra });
const group = (rows) => deriveAuditGroups(rows)[0];

test('(a) a passed step header reads [✓] passed · step · cost · try N marks, bold', () => {
  const g = group([row('green')]);
  assert.equal(page.auditGroupHeaderText(g), '[✓] passed · s1 · $0.0050 · try 1 ✓');
  assert.match(PAGE, /\.audit-status-header\s*>\s*\.badge[^}]*font-weight:\s*(6|7|8|9)00/);
});

test('(b) waiting reads [·] waiting; a red group reads [✗] failed; never the raw done/stopped', () => {
  assert.match(page.auditGroupHeaderText(group([row('paused')])), /^\[·\] waiting · s1/);
  const red = page.auditGroupHeaderText(group([row('red')]));
  assert.match(red, /^\[✗\] failed · s1/);
  assert.doesNotMatch(red, /\[stopped\]|\[done\]/);
});

test('(c) the Draft header: [✓] passed, at least N model calls for an old flow; not signed plain; no record unchanged', () => {
  const d = { present: true, ended: 'done', timeMs: 155000, cost: '$0.0200', calls: 2, callsAtLeast: true };
  assert.equal(page.draftLineText(d), '[✓] passed · drafting · 2m35s · $0.0200 · at least 2 model calls · human checks unknown ✓');
  assert.equal(page.draftLineText({ ...d, ended: null }), 'not signed · drafting · 2m35s · $0.0200 · at least 2 model calls · human checks unknown');
  assert.equal(page.draftLineText({ present: false, why: 'no draft record' }), 'drafting · no draft record');
});

test('(d) the visible header and its aria carry the same words, step, run and Draft (one parts function)', () => {
  assert.ok(page.auditGroupHeaderParts, 'auditGroupHeaderParts exists');
  const dom = PAGE.slice(PAGE.indexOf('function buildAuditGroupHeaderEl'), PAGE.indexOf('// Grouped view: one section per step'));
  assert.match(dom, /auditGroupHeaderParts\(g\)/);
  assert.doesNotMatch(dom, /g\.state|"call"|countWord|duration\(/, 'the DOM builder writes no words of its own');
  assert.doesNotMatch(cut('draftTailInto'), /countWord|"call"/);
  const run = group([{ step: null, verdict: 'stopped', usd: 0.01, spendComplete: true }]);
  assert.match(page.auditGroupHeaderText(run), /^\[■\] stopped · run · \$0\.0100$/);
});

test('(f) a step the human stopped is user-stopped: [■] stopped, grey, never failed', () => {
  assert.equal(deriveStepGroupState([row('green'), row('stopped')]), 'user-stopped');
  assert.equal(deriveStepGroupState([row('stopped'), row('stop-asked')]), 'user-stopped');
  assert.equal(page.stateWord('user-stopped'), '[■] stopped');
  assert.equal(page.auditStateClass('user-stopped'), 'grey');
  assert.match(page.auditGroupHeaderText(group([row('stopped')])), /^\[■\] stopped · s1/);
  assert.match(PAGE, /state === "user-stopped"[^\n]*grey-dot/);
});

test('(g) a red step with a not-honoured stop row reads failed; a passed step with a stop note reads passed, on the card too', () => {
  assert.equal(deriveStepGroupState([row('red'), row('stop-not-honoured')]), 'stopped');
  assert.equal(deriveStepGroupState([row('green'), row('stop-asked')]), 'done');
  // the step card state is the server's groupState, not a client re-derivation from the attempts (a trailing stop note made it read stopped)
  const attempts = [row('green'), row('stop-asked')];
  const [box] = page.buildStepBoxes([{ emits: 's1', attempts, groupState: 'done' }]);
  assert.equal(box.state, 'done');
  assert.equal(page.stateWord(box.state), '[✓] passed');
  const [red] = page.buildStepBoxes([{ emits: 's1', attempts: [row('red'), row('stop-not-honoured')], groupState: 'stopped' }]);
  assert.equal(page.stateWord(red.state), '[✗] failed');
  const [none] = page.buildStepBoxes([{ emits: 's1', attempts: [], groupState: null }]);
  assert.equal(none.state, 'pending');
});

test('walk fixes: (1) the Draft tail wraps at a phone, (2) the visible header has the dot after the badge from the parts, (3) cost and try count never touch', () => {
  const phone = PAGE.slice(PAGE.indexOf('(l) a phone: the name is the only thing'), PAGE.indexOf('.audit-group.audit-fold table{margin-top'));
  // (1) the tail may wrap and shrink inside the header at a phone
  assert.match(phone, /\.audit-fold-tail\{[^}]*white-space:\s*normal/);
  assert.match(phone, /\.audit-fold-tail\{[^}]*min-width:\s*0/);
  // (2) the dot comes from the parts list (the aria joins with the same p.dot), not a second literal
  const dom = PAGE.slice(PAGE.indexOf('function buildAuditGroupHeaderEl'), PAGE.indexOf('// Grouped view: one section per step'));
  assert.match(dom, /textContent = p\.dot/);
  assert.match(cut('auditGroupHeaderText'), /p\.dot/);
  assert.equal(page.auditGroupHeaderParts({ step: 's1', state: 'done', cost: '$0.0010', tryCount: 1, tryMarks: ['✓'] }).dot, '·');
  assert.doesNotMatch(phone, /\.audit-fold-dot\{[^}]*display:\s*none/);
  // (3) on a phone the word "try" stays (or a visible separator does) with a space before it: cost and count never glue
  assert.doesNotMatch(phone, /audit-fold-try[^{]*\{[^}]*display:\s*none/);
  assert.match(phone, /\.audit-fold-try\{[^}]*margin-left/);
});
